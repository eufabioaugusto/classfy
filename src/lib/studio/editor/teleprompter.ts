export type ScriptToken = { index: number; text: string; normalized: string; start: number; end: number; punctuation: string };
export type SpeechTranscript = { text: string; final: boolean; confidence: number | null; segmentId: string };
export type SpeechFollowerStatus = { state: 'connecting' | 'listening' | 'error' | 'unsupported'; reason?: string };
export type ScriptMatch = { index: number; offset: number; matched: boolean; confidence: number };
const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '').toLocaleLowerCase('pt-BR');
export function tokenizeScript(script: string): ScriptToken[] {
  const words = [...script.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
  return words.map((word, index) => ({ index, text: word[0], normalized: normalize(word[0]), start: word.index!, end: word.index! + word[0].length, punctuation: script.slice(word.index! + word[0].length, words[index + 1]?.index ?? script.length) }));
}
const common = new Set('a o as os um uma uns umas de da do das dos e é em na no nas nos por para pra com sem que se eu tu ele ela eles elas nós nos você voces meu minha seu sua isso isto esse essa aqui ali já mais mas muito bem então hoje vamos sobre ao à às aos não sim como quando porque foi ser está tem ter'.split(' ').map(normalize));
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1) return 0;
  // A single small substitution/inflection is useful for ASR; short common words require exact matches.
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return 0;
    if (a.length >= b.length) i++; if (b.length >= a.length) j++;
  }
  edits += a.length - i + b.length - j; return edits <= 1 ? .82 : 0;
}
type Alignment = { score: number; matches: number; exact: number; distinct: number; lastMatched: boolean };
/** A bounded local alignment follows revisions of one interim segment from the same frozen origin. */
export function createScriptMatcher(script: string, initialIndex = 0) {
  const tokens = tokenizeScript(script); let index = Math.max(0, Math.min(tokens.length, Math.floor(Number.isFinite(initialIndex) ? initialIndex : 0))), segment: string | null = null, base = index, consumedSpeech = 0;
  const finalized = new Set<string>();
  const position = (matched = false, confidence = 0): ScriptMatch => ({ index, offset: tokens[index]?.start ?? script.length, matched, confidence });
  return {
    tokens,
    reset(next = 0) { index = Math.max(0, Math.min(tokens.length, Math.floor(Number.isFinite(next) ? next : 0))); base = index; consumedSpeech = 0; segment = null; finalized.clear(); return position(); },
    follow(update: { text: string; final?: boolean; confidence?: number | null; segmentId?: string }): ScriptMatch {
      if (update.segmentId !== undefined) {
        if (finalized.has(update.segmentId)) return position();
        if (update.final) {
          finalized.add(update.segmentId);
          // The adapter drops the whole immutable final prefix; this bounded history also protects direct callers.
          if (finalized.size > 128) finalized.delete(finalized.values().next().value!);
        }
      }
      if (!tokens.length || index === tokens.length) return position();
      if (update.segmentId !== undefined && segment !== update.segmentId) { segment = update.segmentId; base = index; consumedSpeech = 0; }
      if (update.segmentId === undefined) { base = index; consumedSpeech = 0; }
      const allSpoken = tokenizeScript(update.text).map(token => token.normalized); if (allSpoken.length < 2) return position();
      if (update.final && update.confidence !== null && update.confidence !== undefined && update.confidence > 0 && update.confidence < .35) return position();
      let progressed = false, acceptedConfidence = 0;
      // Keep four recognized words as context instead of arbitrarily dropping the beginning of a cumulative result.
      // Up to eight bounded windows handle unusually long final results without matching the whole script.
      for (let window = 0; window < 8; window++) {
      const speechOffset = Math.max(0, consumedSpeech - 4), spoken = allSpoken.slice(speechOffset, speechOffset + 64);
      if (spoken.length < 2) break;
      const alignmentBase = speechOffset > 0 ? index : base;
      let best: { end: number; spokenEnd: number; quality: number; rank: number } | null = null;
      const lower = Math.max(0, alignmentBase - 4), upper = Math.min(tokens.length - 1, alignmentBase + 5);
      for (let start = lower; start <= upper; start++) {
        const count = Math.min(tokens.length - start, spoken.length + 4, 68);
        let previous: Alignment[] = Array.from({ length: count + 1 }, (_, n) => ({ score: -n * .7, matches: 0, exact: 0, distinct: 0, lastMatched: false }));
        for (let m = 1; m <= spoken.length; m++) {
          const row: Alignment[] = [{ score: -m * .65, matches: 0, exact: 0, distinct: 0, lastMatched: false }];
          for (let n = 1; n <= count; n++) {
            const word = tokens[start + n - 1].normalized, match = similarity(spoken[m - 1], word), informative = !common.has(word);
            const diagonal = { score: previous[n - 1].score + (match ? match * (informative ? 1.4 : .7) : -1), matches: previous[n - 1].matches + (match ? 1 : 0), exact: previous[n - 1].exact + (match === 1 ? 1 : 0), distinct: previous[n - 1].distinct + (match && informative ? 1 : 0), lastMatched: !!match };
            const insertion = { ...previous[n], score: previous[n].score - .65, lastMatched: false }, omission = { ...row[n - 1], score: row[n - 1].score - .7, lastMatched: false };
            row[n] = [diagonal, insertion, omission].reduce((a, b) => b.score > a.score ? b : a);
            const value = row[n], quality = value.matches / Math.max(m, n), end = start + n;
            const shortExact = value.exact === 2 && n === 2 && m === 2 && start <= alignmentBase + 1;
            const commonPhrase = n >= 4 && m === n && value.exact === n && start >= alignmentBase - 1 && start <= alignmentBase + 1;
            const anchoredShortPhrase = n === 3 && m === n && value.exact === n && start === alignmentBase && (!update.final || (update.confidence ?? 0) >= .6);
            if (!value.lastMatched || value.distinct < 2 && !commonPhrase && !anchoredShortPhrase || value.matches < (shortExact ? 2 : 3) || quality < (update.final ? .64 : .74)) continue;
            // Prefer a longer, well-supported phrase near the current line; a common isolated word can never jump ahead.
            const rank = value.score + value.matches * .12 - Math.abs(start - alignmentBase) * .3;
            if (!best || rank > best.rank + .001) best = { end, spokenEnd: m, quality, rank };
          }
          previous = row;
        }
      }
      if (!best || best.end <= index) break;
      index = Math.max(index, best.end); consumedSpeech = Math.max(consumedSpeech, speechOffset + best.spokenEnd); progressed = true; acceptedConfidence = best.quality;
      if (speechOffset + spoken.length >= allSpoken.length || index === tokens.length) break;
      }
      return position(progressed, acceptedConfidence);
    },
  };
}

type RecognitionResult = { isFinal: boolean; [index: number]: { transcript: string; confidence?: number } };
type Recognition = {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  start(track: MediaStreamTrack): void; abort(): void;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
};
type RecognitionConstructor = new () => Recognition;
let followerSequence = 0;
function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === 'undefined') return undefined;
  const speechWindow = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}
/** No safe reflective test exists for the audioTrack overload (start.length is also zero without it).
 * Restrict to the desktop engines documented by MDN BCD, rather than probing start() and accidentally opening the default mic.
 * https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start
 * https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json
 */
export function speechFollowerSupport(): { supported: boolean; reason?: string } {
  const unavailable = { supported: false, reason: 'Este navegador não reconhece a voz do microfone selecionado. Use Chrome ou Edge atualizado no computador, ou escolha a rolagem automática.' };
  if (typeof navigator === 'undefined' || !recognitionConstructor() || window.isSecureContext === false) return unavailable;
  const ua = navigator.userAgent, version = /(?:Chrome|Chromium)\/(\d+)/.exec(ua);
  const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  if (!version || Number(version[1]) < 135 || /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(ua) || ipad) return unavailable;
  return { supported: true };
}
function speechError(code: string) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'O navegador não autorizou o reconhecimento de voz. Confira a permissão e tente novamente, ou use a rolagem automática.';
  if (code === 'network') return 'O serviço de reconhecimento do navegador está indisponível. Confira a conexão e tente novamente, ou use a rolagem automática.';
  if (code === 'audio-capture') return 'O reconhecimento perdeu o microfone selecionado. Confira a entrada antes de tentar novamente.';
  if (code === 'language-not-supported') return 'O serviço do navegador não oferece reconhecimento em português do Brasil nesta configuração.';
  if (code === 'aborted') return 'O reconhecimento foi interrompido. Ative o acompanhamento de voz novamente quando estiver pronto.';
  return 'O navegador interrompeu o reconhecimento de voz. Tente novamente ou use a rolagem automática.';
}
/** Owns only the recognition service. The microphone belongs to capture and is never stopped, cloned or reconfigured here. */
export function createSpeechFollower({ track, onTranscript, onStatus }: { track: MediaStreamTrack; onTranscript: (event: SpeechTranscript) => void; onStatus: (status: SpeechFollowerStatus) => void }) {
  const instance = ++followerSequence;
  let closed = false, running = false, generation = 0, current: Recognition | null = null, serial = 0, restartCount = 0, restartWindow = 0;
  let restartTimer: ReturnType<typeof setTimeout> | null = null, startTimer: ReturnType<typeof setTimeout> | null = null, listening = false;
  const live = (expected: number, recognition?: Recognition) => !closed && running && generation === expected && (!recognition || current === recognition);
  const clearTimers = () => { if (restartTimer !== null) clearTimeout(restartTimer); if (startTimer !== null) clearTimeout(startTimer); restartTimer = null; startTimer = null; };
  const detach = () => { const owned = current; current = null; if (owned) { owned.onstart = owned.onresult = owned.onerror = owned.onend = null; try { owned.abort(); } catch { /* The service may have already ended. */ } } };
  const stop = (reason: string) => { generation++; running = false; listening = false; clearTimers(); detach(); if (!closed) onStatus({ state: 'error', reason }); };
  const hidden = () => { if (document.visibilityState === 'hidden' && running) stop('O acompanhamento de voz foi pausado ao sair desta aba. Ative-o novamente para continuar.'); };
  const ended = () => { if (running) stop('O microfone selecionado foi desconectado. Escolha a entrada e ative a voz novamente.'); };
  const muted = () => { if (running && track.muted) stop('O microfone selecionado foi interrompido. Ative a voz novamente após recuperar a entrada.'); };
  let attached = false;
  const attach = () => { if (attached) return; attached = true; document.addEventListener('visibilitychange', hidden); track.addEventListener('ended', ended); track.addEventListener('mute', muted); };
  const detachListeners = () => { if (!attached) return; attached = false; document.removeEventListener('visibilitychange', hidden); track.removeEventListener('ended', ended); track.removeEventListener('mute', muted); };
  const open = (expected: number) => {
    if (!live(expected)) return;
    if (document.visibilityState === 'hidden' || track.kind !== 'audio' || track.readyState !== 'live' || !track.enabled || track.muted) { stop('Ative o microfone selecionado nesta aba antes de acompanhar a voz.'); return; }
    const Constructor = recognitionConstructor(); if (!Constructor) { stop('O reconhecimento de voz não está disponível neste navegador.'); return; }
    let recognition: Recognition;
    try { recognition = new Constructor(); } catch { stop('O navegador não conseguiu abrir o serviço de reconhecimento de voz.'); return; }
    current = recognition; const session = ++serial; let finalIndex = -1;
    recognition.lang = 'pt-BR'; recognition.interimResults = true; recognition.continuous = true; recognition.maxAlternatives = 1;
    recognition.onstart = () => { if (!live(expected, recognition)) return; listening = true; if (startTimer) clearTimeout(startTimer); startTimer = null; onStatus({ state: 'listening' }); };
    recognition.onresult = event => {
      if (!live(expected, recognition) || !listening) return;
      for (let i = Math.max(0, event.resultIndex); i < event.results.length; i++) {
        // Final results form an immutable prefix, even when resultIndex points back to an earlier result.
        if (i <= finalIndex) continue;
        const result = event.results[i], alternative = result?.[0]; if (!alternative?.transcript.trim()) continue;
        if (result.isFinal) finalIndex = i;
        onTranscript({ text: alternative.transcript, final: result.isFinal, confidence: Number.isFinite(alternative.confidence) ? alternative.confidence! : null, segmentId: `${instance}:${session}:${i}` });
        if (!live(expected, recognition)) break;
      }
    };
    recognition.onerror = event => { if (!live(expected, recognition)) return; if (event.error === 'no-speech') return; stop(speechError(event.error)); };
    recognition.onend = () => {
      if (!live(expected, recognition)) return; listening = false; clearTimers(); detach();
      if (Date.now() - restartWindow >= 60000) { restartCount = 0; restartWindow = Date.now(); }
      if (++restartCount > 3) { stop('O serviço de voz foi interrompido várias vezes. Tente novamente ou use a rolagem automática.'); return; }
      onStatus({ state: 'connecting', reason: 'Reconectando ao serviço de voz do navegador…' });
      if (!live(expected)) return;
      restartTimer = setTimeout(() => { restartTimer = null; open(expected); }, 500);
    };
    onStatus({ state: 'connecting' });
    if (!live(expected, recognition)) return;
    startTimer = setTimeout(() => { if (live(expected, recognition)) stop('O serviço do navegador não iniciou o reconhecimento. Tente novamente ou use a rolagem automática.'); }, 15000);
    try { recognition.start(track); } catch (error) { if (live(expected, recognition)) stop((error as Error).name === 'InvalidStateError' ? 'O navegador não aceitou o microfone selecionado para reconhecer a voz.' : speechError((error as Error).name)); }
  };
  return {
    start() {
      if (closed) return; if (running) return;
      const support = speechFollowerSupport(); if (!support.supported) { onStatus({ state: 'unsupported', reason: support.reason }); return; }
      clearTimers(); detach(); generation++; running = true; restartCount = 0; restartWindow = Date.now(); attach(); open(generation);
    },
    dispose() { if (closed) return; closed = true; running = false; generation++; clearTimers(); detach(); detachListeners(); },
  };
}
