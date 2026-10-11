import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, Circle, Layers3, Mic, MicOff, Monitor, Square, X } from 'lucide-react';
import type { StudioCaptureState } from '@/lib/studio/editor/capture';
import directorCSS from '@/styles/studio-scene-director.css?inline';

type Scene = 'camera' | 'screen' | 'screen-camera';
type DirectorOptions = {
  scope: string;
  state: StudioCaptureState;
  blocked?: boolean;
  onScene: (scene: Scene) => void;
  onStop: () => void;
  onMicrophone: (enabled: boolean) => void;
  onStart?: () => void;
};
type DocumentPiP = { requestWindow(options: { width: number; height: number }): Promise<Window> };
const api = () => (window as Window & { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;
const sceneOptions = [
  { id: 'camera' as const, label: 'Câmera', Icon: Camera },
  { id: 'screen' as const, label: 'Tela', Icon: Monitor },
  { id: 'screen-camera' as const, label: 'Tela + você', Icon: Layers3 },
];
const time = (elapsed: number) => {
  const seconds = Math.max(0, Math.floor(Number.isFinite(elapsed) ? elapsed : 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** One owned PiP window. Closing it leaves the recording running in the Studio. */
export function useStudioSceneDirector(options: DirectorOptions) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const owned = useRef<Window | null>(null), windowScope = useRef<string | null>(null);
  const pending = useRef<Promise<Window> | null>(null), generation = useRef(0), mounted = useRef(false);
  const latest = useRef(options); latest.current = options;
  const supported = typeof window !== 'undefined' && typeof api()?.requestWindow === 'function';
  const hasScenes = !!options.state.scenes;
  const close = useCallback(() => {
    ++generation.current; pending.current = null;
    const previous = owned.current; owned.current = null; windowScope.current = null;
    if (previous && !previous.closed) previous.close();
    if (mounted.current) { setTarget(null); setActionError(null); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; close(); };
  }, [close]);
  useEffect(() => { close(); }, [options.scope, close]);
  useEffect(() => {
    if (!hasScenes || !options.state.stream || !['ready', 'recording'].includes(options.state.phase)) close();
  }, [hasScenes, options.state.stream, options.state.phase, close]);

  const open = useCallback(async () => {
    const current = latest.current;
    if (!mounted.current || current.blocked || !current.state.scenes || !current.state.stream || !['ready', 'recording'].includes(current.state.phase)) return;
    if (owned.current && !owned.current.closed) { owned.current.focus(); return; }
    if (pending.current) return;
    const documentPiP = api();
    if (typeof documentPiP?.requestWindow !== 'function') throw new Error('Este navegador não oferece o controle flutuante. Use os controles do Studio.');
    const expected = ++generation.current, scope = current.scope;
    // requestWindow must run on the button's original user gesture, before awaits.
    const opening = documentPiP.requestWindow({ width: 430, height: 380 }); pending.current = opening;
    try {
      const opened = await opening;
      const fresh = latest.current;
      if (!mounted.current || expected !== generation.current || fresh.scope !== scope || fresh.blocked || !fresh.state.stream || !['ready', 'recording'].includes(fresh.state.phase)) { opened.close(); return; }
      const doc = opened.document;
      doc.documentElement.lang = 'pt-BR'; doc.title = 'Classfy · Controle de gravação';
      const style = doc.createElement('style'); style.textContent = directorCSS; doc.head.append(style);
      const host = doc.createElement('main'); host.className = 'se-director-host'; doc.body.append(host);
      owned.current = opened; windowScope.current = scope; setActionError(null); setTarget(host);
      opened.addEventListener('pagehide', () => {
        if (owned.current !== opened) return;
        owned.current = null; windowScope.current = null;
        if (mounted.current) { setTarget(null); setActionError(null); }
      }, { once: true });
    } catch (cause) {
      if (!mounted.current || expected !== generation.current || latest.current.scope !== scope) return;
      throw new Error(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Abra o controle flutuante pelo botão do Studio e permita a janela neste navegador.'
        : 'Não foi possível abrir o controle flutuante. A gravação continua disponível no Studio.');
    } finally { if (pending.current === opening) pending.current = null; }
  }, []);

  const sceneAvailable = (scene: Scene, state = latest.current.state) => !!state.scenes && (scene === 'camera' ? state.scenes.cameraReady : scene === 'screen' ? state.scenes.screenReady : state.scenes.cameraReady && state.scenes.screenReady);
  const act = (action: (current: DirectorOptions) => void) => {
    const current = latest.current;
    if (!mounted.current || current.scope !== windowScope.current || current.blocked || !current.state.stream || !['ready', 'recording'].includes(current.state.phase)) return;
    try { setActionError(null); action(current); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Não foi possível concluir esta ação. Use os controles do Studio.'); }
  };
  const select = (scene: Scene) => act(current => { if (sceneAvailable(scene, current.state)) current.onScene(scene); });
  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (latest.current.blocked || event.altKey || event.ctrlKey || event.metaKey || event.repeat || (event.target as HTMLElement).matches('input, select, textarea, [contenteditable="true"]')) return;
    const item = sceneOptions[Number(event.key) - 1];
    if (item && sceneAvailable(item.id)) { event.preventDefault(); event.stopPropagation(); select(item.id); }
  };
  const state = options.state, recording = state.phase === 'recording', unavailable = !!options.blocked || !['ready', 'recording'].includes(state.phase);
  const level = state.levels[0], average = !state.microphoneEnabled || !level ? -60 : Math.max(-60, Math.min(0, level.averageDb));
  const portal = target && createPortal(<section className="se-director" aria-label="Controle flutuante de gravação" onKeyDown={shortcut}>
    <header><span><img src={`${window.location.origin}/brand/classfy-simbolo-vermelho.svg`} alt="" width="22" height="22" /> <strong>Suas cenas</strong></span><button type="button" className="se-director-close" aria-label="Fechar controle flutuante" title="Fechar esta janela mantém a gravação" onClick={close}><X size={17} /></button></header>
    <div className="se-director-status"><span className={recording ? 'is-recording' : ''}><Circle size={8} fill="currentColor" />{recording ? 'GRAVANDO' : 'PRONTO PARA GRAVAR'}</span><time>{time(state.elapsed)}</time></div>
    <div className="se-director-scenes" role="group" aria-label="Alternar cena">
      {sceneOptions.map(({ id, label, Icon }, index) => <button type="button" key={id} aria-label={`Cena ${index + 1}: ${label}`} aria-pressed={state.scenes?.selected === id} disabled={unavailable || !sceneAvailable(id, state)} onClick={() => select(id)}>
        <span className={`se-director-thumbnail se-director-thumbnail--${id}`}><Icon size={22} /><small>{index + 1}</small>{state.scenes?.selected === id && <Check size={13} className="se-director-selected" />}{id === 'screen-camera' && <i />}</span><span>{label}</span>
      </button>)}
    </div>
    <div className="se-director-microphone"><button type="button" aria-label={state.microphoneEnabled ? 'Silenciar microfone' : 'Ativar microfone'} aria-pressed={!state.microphoneEnabled} disabled={unavailable || !state.input} onClick={() => act(current => current.onMicrophone(!current.state.microphoneEnabled))}>{state.microphoneEnabled ? <Mic size={17} /> : <MicOff size={17} />}</button><div><span>{state.input?.name ?? 'Microfone fechado'}</span><div role="meter" aria-label="Nível do microfone" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={average}><i style={{ width: `${(average + 60) / 60 * 100}%`, background: level && level.peakDb > -3 ? '#ff685d' : undefined }} /></div></div></div>
    {actionError && <p className="se-director-error" role="alert">{actionError}</p>}
    <button type="button" className="se-director-record" disabled={unavailable || !recording && !options.onStart} onClick={() => act(current => current.state.phase === 'recording' ? current.onStop() : current.onStart?.())}>{recording ? <Square size={13} fill="currentColor" /> : <Circle size={13} fill="currentColor" />}{recording ? 'Parar e salvar take' : 'Gravar take'}</button>
    <p className="se-director-note">Ao compartilhar a tela inteira, esta janela também pode aparecer. Prefira compartilhar uma janela ou aba.</p>
  </section>, target);
  return { supported, isOpen: !!target, open, close, portal };
}
