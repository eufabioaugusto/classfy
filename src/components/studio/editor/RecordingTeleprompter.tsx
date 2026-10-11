import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Pause, Play, RotateCcw } from 'lucide-react';
import { createScriptMatcher, createSpeechFollower, speechFollowerSupport, type SpeechFollowerStatus } from '@/lib/studio/editor/teleprompter';
import type { RecordingGuides } from './StudioRecordingTools';

type ReadingStatus = SpeechFollowerStatus | { state: 'idle' | 'paused' | 'complete'; reason?: string };
type Props = {
  guides: RecordingGuides; recording: boolean; active: boolean; microphoneEnabled: boolean; inputKey: string;
  getMicrophoneTrack(): MediaStreamTrack | null;
  onGuides(patch: Partial<RecordingGuides>): void;
};

/** A reading aid only: neither the overlay nor the recognition service owns the recorded media. */
export const RecordingTeleprompter = memo(function RecordingTeleprompter({ guides, recording, active, microphoneEnabled, inputKey, getMicrophoneTrack, onGuides }: Props) {
  const matcher = useMemo(() => createScriptMatcher(guides.script), [guides.script]);
  const support = useMemo(() => speechFollowerSupport(), []);
  const [cursor, setCursor] = useState(0), [playing, setPlaying] = useState(false), [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(document.visibilityState !== 'hidden');
  const [status, setStatus] = useState<ReadingStatus>({ state: 'idle' });
  const [hasStarted, setHasStarted] = useState(false);
  const recordingNow = useRef(recording); recordingNow.current = recording;
  const text = useRef<HTMLDivElement>(null), position = useRef(0), previousRecording = useRef(false), previousInput = useRef(inputKey);
  const speech = useRef<ReturnType<typeof createSpeechFollower> | null>(null), generation = useRef(0);
  const enabled = guides.scriptEnabled && matcher.tokens.length > 0;
  const allowed = enabled && active && visible && (guides.scriptMode !== 'voice' || microphoneEnabled);
  const running = useRef(false); running.current = playing && allowed;

  const stopSpeech = useCallback(() => {
    ++generation.current; const owned = speech.current; speech.current = null; owned?.dispose();
  }, []);
  const pause = useCallback((reason = 'Leitura pausada') => {
    running.current = false; stopSpeech(); setPlaying(false); setStatus({ state: 'paused', reason });
  }, [stopSpeech]);
  const advance = useCallback((index: number) => {
    position.current = Math.max(0, Math.min(matcher.tokens.length, index)); setCursor(position.current);
  }, [matcher]);
  const rewind = useCallback(() => {
    stopSpeech(); matcher.reset(); advance(0); if (text.current) text.current.scrollTop = 0;
  }, [stopSpeech, matcher, advance]);
  const play = () => {
    if (!allowed) return;
    if (position.current >= matcher.tokens.length) rewind();
    setHasStarted(true); setStatus({ state: guides.scriptMode === 'voice' ? 'connecting' : 'listening' });
    setAttempt(value => value + 1); setPlaying(true);
  };

  useEffect(() => {
    rewind(); setPlaying(recordingNow.current); setHasStarted(recordingNow.current); setStatus({ state: 'idle' });
  }, [rewind]);
  useEffect(() => {
    if (recording && !previousRecording.current) {
      rewind(); setHasStarted(true); setPlaying(true); setAttempt(value => value + 1);
    } else if (!recording && previousRecording.current) pause();
    previousRecording.current = recording;
  }, [recording, rewind, pause]);
  useEffect(() => {
    if (previousInput.current !== inputKey) pause('Entrada alterada. Retome a leitura quando estiver pronto.');
    previousInput.current = inputKey;
  }, [inputKey, pause]);
  useEffect(() => {
    if (!playing) return;
    if (!active || !enabled) pause('Aguarde a captura ficar pronta para retomar.');
    else if (guides.scriptMode === 'voice' && !microphoneEnabled) pause('Microfone desativado. Ative-o para retomar.');
  }, [active, enabled, microphoneEnabled, guides.scriptMode, playing, pause]);
  useEffect(() => {
    if (!enabled) return;
    const visibility = () => {
      const foreground = document.visibilityState !== 'hidden'; setVisible(foreground);
      if (!foreground) pause('Leitura pausada ao sair da aba.');
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { document.removeEventListener('visibilitychange', visibility); stopSpeech(); };
  }, [enabled, pause, stopSpeech]);

  useEffect(() => {
    if (!playing || !allowed || guides.scriptMode !== 'voice') return;
    const track = getMicrophoneTrack();
    if (!track || track.kind !== 'audio' || track.readyState !== 'live' || track.enabled === false) {
      setStatus({ state: 'error', reason: 'O microfone selecionado não está pronto. Confira a entrada e tente novamente.' }); setPlaying(false); return;
    }
    matcher.reset(position.current);
    const ownedGeneration = ++generation.current;
    const current = () => generation.current === ownedGeneration && running.current;
    const owned = createSpeechFollower({
      track,
      onTranscript: event => {
        if (!current()) return;
        const match = matcher.follow(event);
        if (!match.matched) return;
        advance(match.index);
        if (match.index >= matcher.tokens.length) {
          running.current = false; stopSpeech(); setPlaying(false); setStatus({ state: 'complete' });
        }
      },
      onStatus: value => {
        if (!current()) return;
        setStatus(value);
        if (value.state === 'error' || value.state === 'unsupported') { running.current = false; setPlaying(false); }
      },
    });
    speech.current = owned;
    owned.start();
    return () => { if (speech.current === owned) stopSpeech(); else owned.dispose(); };
  }, [playing, allowed, guides.scriptMode, matcher, inputKey, getMicrophoneTrack, attempt, recording, advance, stopSpeech]);

  useEffect(() => {
    if (!playing || !allowed || guides.scriptMode !== 'timed') return;
    setStatus({ state: 'listening' });
    let live = true, frame = 0, last = performance.now(), elapsed = 0;
    const tick = (now: number) => {
      if (!live || !running.current) return;
      elapsed += Math.min(Math.max(0, now - last), 100); last = now;
      const word = matcher.tokens[position.current];
      const pauseFactor = /[.!?]/.test(word?.punctuation ?? '') ? 1.7 : /[,;:]/.test(word?.punctuation ?? '') ? 1.3 : 1;
      const duration = 60000 / Math.max(60, Math.min(240, guides.scriptSpeed)) * pauseFactor;
      if (elapsed >= duration) { elapsed -= duration; advance(position.current + 1); }
      if (position.current >= matcher.tokens.length) { running.current = false; setPlaying(false); setStatus({ state: 'complete' }); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => { live = false; cancelAnimationFrame(frame); };
  }, [playing, allowed, guides.scriptMode, guides.scriptSpeed, matcher, attempt, recording, advance]);

  useEffect(() => {
    const element = text.current, word = element?.querySelector<HTMLElement>(`[data-word-index="${cursor}"]`);
    if (!element || !word) return;
    const top = Math.max(0, word.offsetTop - element.clientHeight * .2);
    if (typeof element.scrollTo === 'function') element.scrollTo({ top, behavior: 'smooth' }); else element.scrollTop = top;
  }, [cursor, matcher]);

  if (!enabled) return null;
  const unsupported = guides.scriptMode === 'voice' && !support.supported;
  const failure = guides.scriptMode === 'voice' && (unsupported || status.state === 'error' || status.state === 'unsupported');
  const reason = unsupported ? support.reason : status.reason;
  const label = status.state === 'complete' ? 'Roteiro concluído' : !playing ? hasStarted ? 'Leitura pausada' : guides.scriptMode === 'voice' ? 'Acompanhar voz' : 'Rolagem automática' : guides.scriptMode === 'timed' ? 'Rolagem automática' : status.state === 'listening' ? 'Aguardando sua voz' : 'Conectando à voz…';
  let end = 0;
  const words = matcher.tokens.map(token => {
    const space = guides.script.slice(end, token.start); end = token.end;
    return <span key={token.index}>{space}<span data-word-index={token.index} className={token.index < cursor ? 'is-read' : token.index === cursor ? 'is-current' : undefined}>{token.text}</span></span>;
  });
  return <section className="se-recording-teleprompter" aria-label="Teleprompter" data-mode={guides.scriptMode} data-playing={playing}>
    <header className="se-recording-reading-toolbar">
      <div className="se-recording-reading-status"><Mic size={13} aria-hidden="true" /><span role="status">{label}</span><small aria-label="Progresso da leitura">{Math.min(cursor, matcher.tokens.length)} / {matcher.tokens.length}</small></div>
      <div className="se-recording-reading-actions">
        <button aria-label={playing ? 'Pausar leitura' : hasStarted ? 'Retomar leitura' : 'Ensaiar leitura'} title={playing ? 'Pausar leitura' : hasStarted ? 'Retomar leitura' : 'Ensaiar leitura'} disabled={!playing && !allowed} onClick={() => playing ? pause() : play()}>{playing ? <Pause size={15} /> : <Play size={15} />}</button>
        <button aria-label="Reiniciar leitura" title="Reiniciar leitura" disabled={!allowed} onClick={() => { rewind(); setHasStarted(true); setPlaying(true); setAttempt(value => value + 1); }}><RotateCcw size={14} /></button>
      </div>
    </header>
    {failure ? <div className="se-recording-reading-notice"><p>{reason}</p><div>{!unsupported && <button disabled={!allowed} onClick={play}>Tentar voz novamente</button>}<button onClick={() => { pause(); onGuides({ scriptMode: 'timed' }); }}>Usar rolagem automática</button></div></div> : reason && !playing ? <p className="se-recording-reading-hint">{reason}</p> : null}
    <div ref={text} className="se-recording-script" aria-label="Texto do roteiro">{words}{guides.script.slice(end)}</div>
  </section>;
});
