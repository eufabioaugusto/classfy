import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingTeleprompter } from './RecordingTeleprompter';
import type { RecordingGuides } from './StudioRecordingTools';

/** Browser recognition is the boundary; the component, follower and matcher stay real. */
class Recognition {
  static instances: Recognition[] = [];
  lang = ''; continuous = false; interimResults = false;
  onstart: null | (() => void) = null; onresult: null | ((event: unknown) => void) = null;
  onerror: null | ((event: { error: string }) => void) = null; onend: null | (() => void) = null;
  track: MediaStreamTrack | undefined;
  results: { isFinal: boolean; 0: { transcript: string; confidence: number } }[] = [];
  constructor() { Recognition.instances.push(this); }
  start = vi.fn((track?: MediaStreamTrack) => { this.track = track; queueMicrotask(() => this.onstart?.()); });
  abort = vi.fn(); stop = vi.fn();
  transcript(text: string, final = true, index = 0) {
    if (this.results[index]?.isFinal && this.results[index][0].transcript !== text) throw new Error('A fronteira Web Speech não permite revisar resultado final.');
    this.results[index] = { isFinal: final, 0: { transcript: text, confidence: .98 } };
    this.onresult?.({ resultIndex: index, results: [...this.results] });
  }
}
class Microphone extends EventTarget {
  kind = 'audio'; readyState: MediaStreamTrackState = 'live'; enabled = true; muted = false;
  constructor(public id = 'mic-1') { super(); }
  stop = vi.fn(() => { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')); });
}
type Props = Parameters<typeof RecordingTeleprompter>[0];
let root: Root, host: HTMLDivElement, track: Microphone, props: Props;
let getMicrophoneTrack: ReturnType<typeof vi.fn>, onGuides: ReturnType<typeof vi.fn>, getUserMedia: ReturnType<typeof vi.fn>;
let frames: Map<number, FrameRequestCallback>, frameId: number;
async function render(patch: Partial<Props> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(<StrictMode><RecordingTeleprompter {...props} /></StrictMode>));
}
function button(label: string) { return [...host.querySelectorAll('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.trim() === label); }
async function click(label: string) { const target = button(label); expect(target, label).toBeTruthy(); await act(async () => target!.click()); }
async function hidden(value: boolean) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value ? 'hidden' : 'visible');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Recognition.instances = []; track = new Microphone(); frames = new Map(); frameId = 0;
  vi.stubGlobal('SpeechRecognition', Recognition); vi.stubGlobal('webkitSpeechRecognition', undefined);
  vi.stubGlobal('isSecureContext', true);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  getUserMedia = vi.fn(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  getMicrophoneTrack = vi.fn(() => track as unknown as MediaStreamTrack); onGuides = vi.fn();
  const guides: RecordingGuides = { grid: false, mirrored: false, delay: 0, script: 'Hoje vamos aprender sobre luz. Agora observamos a sombra e depois praticamos juntos.', scriptEnabled: true, scriptSpeed: 140, scriptMode: 'voice' };
  props = { guides, recording: false, active: true, microphoneEnabled: true, inputKey: 'owner/mic-1', getMicrophoneTrack, onGuides };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('teleprompter real com reconhecimento na fronteira do navegador', () => {
  it('ensaio exige gesto explícito e usa somente a pista física existente; pausa não altera a gravação', async () => {
    await render(); expect(Recognition.instances).toHaveLength(0); expect(getUserMedia).not.toHaveBeenCalled();
    await click('Ensaiar leitura'); const recognition = Recognition.instances.at(-1)!;
    expect(recognition.start).toHaveBeenCalledWith(track); expect(getUserMedia).not.toHaveBeenCalled();
    await click('Pausar leitura'); expect(recognition.abort).toHaveBeenCalled(); expect(track.stop).not.toHaveBeenCalled(); expect(track.enabled).toBe(true);
    await click('Retomar leitura'); expect(Recognition.instances.at(-1)!.start).toHaveBeenCalledWith(track); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('REC inicia voz uma vez; amostras do monitor e nova renderização não reiniciam reconhecimento', async () => {
    await render(); await render({ recording: true }); const recognition = Recognition.instances.at(-1)!;
    expect(recognition.start).toHaveBeenCalledTimes(1); const count = Recognition.instances.length;
    await render(); await render({ guides: { ...props.guides } });
    expect(Recognition.instances).toHaveLength(count); expect(recognition.start).toHaveBeenCalledTimes(1);
    await click('Pausar leitura'); await render(); expect(Recognition.instances).toHaveLength(count);
    expect(track.stop).not.toHaveBeenCalled(); expect(track.enabled).toBe(true);
  });

  it('ocultar a aba cancela follow e voltar exige retomada explícita mesmo durante REC', async () => {
    await render(); await render({ recording: true }); const recognition = Recognition.instances.at(-1)!; const late = recognition.onresult;
    await hidden(true); expect(recognition.abort).toHaveBeenCalled(); const before = host.innerHTML;
    await act(async () => late?.({ resultIndex: 0, results: [Object.assign([{ transcript: props.guides.script, confidence: .99 }], { isFinal: true })] }));
    expect(host.innerHTML).toBe(before);
    const count = Recognition.instances.length; await hidden(false); expect(Recognition.instances).toHaveLength(count);
    await click('Retomar leitura'); expect(Recognition.instances).toHaveLength(count + 1); expect(track.stop).not.toHaveBeenCalled();
  });

  it('mute e troca de entrada rejeitam callbacks antigos; follow retomado usa o novo microfone', async () => {
    await render(); await render({ recording: true }); const old = Recognition.instances.at(-1)!; const late = old.onresult;
    track.enabled = false; await render({ microphoneEnabled: false }); expect(old.abort).toHaveBeenCalled();
    const newTrack = new Microphone('mic-2'); track = newTrack;
    await render({ active: false, inputKey: 'owner/mic-2' }); await render({ active: true, microphoneEnabled: true });
    const before = host.innerHTML; await act(async () => late?.({ resultIndex: 0, results: [Object.assign([{ transcript: props.guides.script, confidence: .99 }], { isFinal: true })] }));
    expect(host.innerHTML).toBe(before);
    await click('Retomar leitura'); expect(Recognition.instances.at(-1)!.start).toHaveBeenCalledWith(newTrack); expect(newTrack.stop).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('browser indisponível mantém modo voz e oferece mudança explícita para automático', async () => {
    vi.stubGlobal('SpeechRecognition', undefined); await render(); await render({ recording: true });
    expect(Recognition.instances).toHaveLength(0); expect(frames.size).toBe(0); expect(onGuides).not.toHaveBeenCalled();
    await click('Usar rolagem automática'); expect(onGuides).toHaveBeenCalledWith(expect.objectContaining({ scriptMode: 'timed' })); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('erro real de reconhecimento pausa e retry explícito não destrói a pista da captura', async () => {
    await render(); await render({ recording: true }); const old = Recognition.instances.at(-1)!;
    await act(async () => old.onerror?.({ error: 'network' })); expect(host.textContent).toMatch(/voz|conexão|reconhecimento/i);
    expect(onGuides).not.toHaveBeenCalled(); expect(track.stop).not.toHaveBeenCalled();
    await click('Tentar voz novamente'); expect(Recognition.instances.at(-1)!.start).toHaveBeenCalledWith(track); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('desmontagem encerra reconhecimento e resultados já enfileirados não publicam nem param microfone', async () => {
    await render(); await render({ recording: true }); const recognition = Recognition.instances.at(-1)!; const late = recognition.onresult;
    await act(async () => root.unmount()); expect(recognition.abort).toHaveBeenCalled();
    await act(async () => late?.({ resultIndex: 0, results: [Object.assign([{ transcript: props.guides.script, confidence: .99 }], { isFinal: true })] }));
    expect(host.innerHTML).toBe(''); expect(onGuides).not.toHaveBeenCalled(); expect(track.stop).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
  });

  it('mount StrictMode durante REC inicia follow apesar da verificação dupla de efeitos', async () => {
    await render({ recording: true }); expect(Recognition.instances.length).toBeGreaterThan(0);
    expect(Recognition.instances.at(-1)!.start).toHaveBeenCalledWith(track);
  });

  it('voz avança palavras compatíveis, conserva progresso em silêncio/interim repetido e conclui sem relógio automático', async () => {
    await render(); await render({ recording: true }); const recognition = Recognition.instances.at(-1)!;
    const read = () => host.querySelectorAll('[data-word-index].is-read').length;
    expect(read()).toBe(0); expect(frames.size).toBe(0);
    await act(async () => recognition.transcript('Hoje vamos aprender sobre luz', false)); expect(read()).toBe(5);
    await act(async () => recognition.transcript('Hoje vamos aprender sobre luz', false)); expect(read()).toBe(5);
    await act(async () => recognition.transcript('dispositivo inesperado completamente diferente', true)); expect(read()).toBe(5);
    await render(); expect(read()).toBe(5); expect(frames.size).toBe(0);
    await act(async () => recognition.transcript('Agora observamos a sombra e depois praticamos juntos', true, 1));
    expect(host.textContent).toContain('Roteiro concluído'); expect(host.querySelectorAll('.is-current')).toHaveLength(0);
    expect(read()).toBe(host.querySelectorAll('[data-word-index]').length); expect(recognition.abort).toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled(); expect(track.enabled).toBe(true);
  });

  it('modo automático respeita pausa de pontuação, pausa/reinicia manualmente e não abre reconhecimento', async () => {
    await render({ guides: { ...props.guides, scriptMode: 'timed', script: 'Aprender. Praticar', scriptSpeed: 240 } });
    expect(frames.size).toBe(0); await click('Ensaiar leitura'); const baseline = performance.now();
    const frame = async (n: number) => { const [id, callback] = [...frames][0]; frames.delete(id); await act(async () => callback(baseline + n * 100)); };
    for (let n = 1; n <= 4; n++) await frame(n);
    expect(host.querySelectorAll('.is-read')).toHaveLength(0); await frame(5); expect(host.querySelectorAll('.is-read')).toHaveLength(1);
    await click('Pausar leitura'); expect(frames.size).toBe(0); expect(host.querySelectorAll('.is-read')).toHaveLength(1);
    await click('Reiniciar leitura'); expect(host.querySelectorAll('.is-read')).toHaveLength(0); expect(frames.size).toBe(1);
    await hidden(true); expect(frames.size).toBe(0); await hidden(false); expect(frames.size).toBe(0);
    expect(Recognition.instances).toHaveLength(0); expect(getMicrophoneTrack).not.toHaveBeenCalled(); expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('troca explícita após falha remove aviso de voz e usa automático sem reiniciar reconhecimento', async () => {
    await render(); await render({ recording: true }); const recognition = Recognition.instances.at(-1)!;
    await act(async () => recognition.onerror?.({ error: 'network' })); expect(button('Tentar voz novamente')).toBeTruthy();
    await click('Usar rolagem automática'); const patch = onGuides.mock.calls.at(-1)![0];
    await render({ guides: { ...props.guides, ...patch } });
    expect(button('Tentar voz novamente')).toBeUndefined(); expect(host.querySelector('.se-recording-reading-notice')).toBeNull();
    expect(Recognition.instances).toHaveLength(1); expect(frames.size).toBe(0);
    await click('Retomar leitura'); expect(frames.size).toBe(1); expect(getUserMedia).not.toHaveBeenCalled();
  });
});
