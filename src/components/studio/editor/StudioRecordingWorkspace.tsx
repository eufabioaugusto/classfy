import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, Check, ChevronDown, ChevronUp, Crown, Film, Layers3, Loader2, Maximize2, Mic, MicOff, Minimize2, Monitor, Play, Radio, Palette, Timer, FileText, ZoomIn, Settings2, ShieldCheck, Square, X } from 'lucide-react';
import { createStudioCapture, type StudioCaptureController, type StudioCaptureMode, type StudioCaptureState } from '@/lib/studio/editor/capture';
import { studioScenesSupport, type StudioCaptureScene, type StudioSceneConfigurationPatch } from '@/lib/studio/editor/sceneTypes';
import { createStudioRecordingSession } from '@/lib/studio/editor/recording';
import { getAsset } from '@/lib/studio/editor/storage';
import { formatStudioEditorTime, formatStudioDuration, studioTakeDuration, type StudioKind, type StudioProject, type StudioTake } from '../../../../shared/studio';
import { StudioRecordingTools, type RecordingGuides } from './StudioRecordingTools';
import { RecordingTeleprompter } from './RecordingTeleprompter';
import { useStudioExitGuard } from './useStudioExitGuard';
import { useStudioConfirmation } from './useStudioConfirmation';
import { StudioTakePlayer, type StudioTakePlayerHandle } from './StudioTakePlayer';
import { StudioSceneControls } from './StudioSceneControls';
import { useStudioSceneDirector } from './useStudioSceneDirector';
import '@/styles/studio-recording.css';

type RecordingSession = ReturnType<typeof createStudioRecordingSession>;
type Candidate = { file: File; operationId: string; session: RecordingSession; token: number; work: Promise<boolean> | null; saved: boolean; notice: string | null };
const idleCapture = (): StudioCaptureState => ({ phase: 'idle', stream: null, elapsed: 0, file: null, error: null, input: null, levels: [], camera: null, devices: { cameras: [], microphones: [] }, microphoneEnabled: true });
const initialRecordingGuides = (): RecordingGuides => ({ grid: false, mirrored: false, delay: 0, script: '', scriptEnabled: false, scriptSpeed: 140, scriptMode: 'voice' });
const kindName = (kind: StudioKind) => kind === 'aula' ? 'Aula' : kind === 'short' ? 'Short' : 'Podcast';
const defaultTitle = (kind: StudioKind) => kind === 'aula' ? 'Nova aula' : kind === 'short' ? 'Novo short' : 'Novo podcast';

function TakeThumbnail({ owner, project, take }: { owner: string; project: StudioProject; take: StudioTake }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let active = true, ownedURL: string | undefined;
    setUrl(undefined);
    if (take.assetId) void getAsset(owner, project.id, `${take.assetId}:thumbnail`).then(blob => {
      if (!active || !blob) return; ownedURL = URL.createObjectURL(blob); setUrl(ownedURL);
    }).catch(() => undefined);
    return () => { active = false; if (ownedURL) URL.revokeObjectURL(ownedURL); };
  }, [owner, project.id, take.assetId]);
  return url ? <img src={url} alt="" /> : <div className="se-recording-take-placeholder">{take.kind === 'audio' ? <Mic size={22} /> : <Film size={22} />}</div>;
}

function DeviceSelector({ label, current, devices, disabled, onChange }: { label: 'Câmera' | 'Microfone'; current: { id: string; name: string } | null; devices: { id: string; name: string }[]; disabled: boolean; onChange: (id: string) => void }) {
  const options = current && !devices.some(device => device.id === current.id) ? [current, ...devices] : devices;
  return <label className="se-recording-device"><span>{label === 'Câmera' ? <Camera size={16} /> : <Mic size={16} />}<span>{label}</span></span><select aria-label={label} value={current?.id ?? ''} disabled={disabled || !options.length} onChange={event => onChange(event.target.value)}>
    {!current && <option value="">{options.length ? 'Escolha uma entrada' : 'Autorize o acesso primeiro'}</option>}
    {options.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
  </select><ChevronDown size={13} aria-hidden="true" /></label>;
}

function AudioMonitor({ state }: { state: StudioCaptureState }) {
  const muted = state.microphoneEnabled === false, level = muted ? undefined : state.levels[0], average = level ? Math.max(-60, Math.min(0, level.averageDb)) : -60;
  return <div className="se-recording-monitor" aria-label={state.input ? `Microfone em uso: ${state.input.name}` : 'Microfone fechado'}>
    <div>{muted ? <MicOff size={14} /> : <Mic size={14} />}<span>{state.input?.name ?? 'Captura encerrada'}</span></div>
    {state.input && <><div className="se-recording-meter" role="meter" aria-label="Nível real do microfone" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={average}><i style={{ width: `${(average + 60) / 60 * 100}%`, background: level && level.peakDb > -3 ? '#ff685d' : undefined }} /></div><small>{muted ? 'Microfone desativado' : level ? `${level.averageDb.toFixed(1)} dBFS` : 'Aguardando amostra'}</small></>}
  </div>;
}

/** Private production stage. No device or draft is opened before an explicit gesture. */
export function StudioRecordingWorkspace({ owner, initialKind = 'aula', initialTitle = '', projectId, canUseScenes = false, onUpgradeScenes }: { owner: string; initialKind?: StudioKind; initialTitle?: string; projectId?: string; canUseScenes?: boolean; onUpgradeScenes?: () => void }) {
  const navigate = useNavigate(), location = useLocation();
  const [stage, setStage] = useState<'setup' | 'production'>('setup'), [kind, setKind] = useState<StudioKind>(initialKind);
  const [liveSelected, setLiveSelected] = useState(false), [toolsOpen, setToolsOpen] = useState(false), [guides, setGuides] = useState(initialRecordingGuides);
  const [toolsTab, setToolsTab] = useState<'image' | 'record' | 'script'>('image');
  const openTools = (tab: 'image' | 'record' | 'script') => { if (confirmationOperation.current || exitIntent.current) return; setToolsTab(tab); setToolsOpen(true); };
  const closeTools = useCallback(() => setToolsOpen(false), []);
  const [countdown, setCountdown] = useState<number | null>(null), countdownRef = useRef<number | null>(null);
  const [title, setTitle] = useState(initialTitle), [mode, setMode] = useState<'camera' | 'screen' | 'scenes'>('camera');
  const [project, setProject] = useState<StudioProject | null>(null), [loading, setLoading] = useState(!!projectId);
  const [captureState, setCaptureState] = useState<StudioCaptureState>(idleCapture), [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [selectedTake, setSelectedTake] = useState<string>();
  const [reviewURL, setReviewURL] = useState<string>(), [leaving, setLeaving] = useState(false);
  const [takesExpanded, setTakesExpanded] = useState(true), [changingDevice, setChangingDevice] = useState(false);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false), [fullscreen, setFullscreen] = useState(false);
  const capture = useRef<StudioCaptureController | null>(null), session = useRef<RecordingSession | null>(null), candidate = useRef<Candidate | null>(null);
  const getMicrophoneTrack = useCallback(() => capture.current?.getMicrophoneTrack() ?? null, []);
  const updateGuides = useCallback((patch: Partial<RecordingGuides>) => setGuides(value => ({ ...value, ...patch })), []);
  const captureSnapshot = useRef(idleCapture()), projectSnapshot = useRef<StudioProject | null>(null), mounted = useRef(false), epoch = useRef(0), currentOwner = useRef(owner);
  const saveBusy = useRef(false), mutationWork = useRef<Promise<boolean> | null>(null), exitWork = useRef<Promise<boolean> | null>(null), exitIntent = useRef(false), attempted = useRef(new WeakSet<File>());
  const deviceWork = useRef<Promise<boolean> | null>(null), workspace = useRef<HTMLDivElement>(null);
  const screenWork = useRef<{ controller: StudioCaptureController; token: number; work: Promise<boolean> } | null>(null);
  const [confirmationScope, setConfirmationScope] = useState(projectId ?? 'new');
  const confirmationSerial = useRef(0), confirmationOperation = useRef<object | null>(null);
  const { confirm, pending: confirmationPending, dialog, cancel: cancelConfirmation } = useStudioConfirmation(`${owner}:${confirmationScope}`);
  const video = useRef<HTMLVideoElement>(null), reviewPlayer = useRef<StudioTakePlayerHandle>(null);
  const latest = useRef({ kind, title, location, canUseScenes, onUpgradeScenes }); latest.current = { kind, title, location, canUseScenes, onUpgradeScenes }; currentOwner.current = owner;
  const live = (token: number) => mounted.current && token === epoch.current && currentOwner.current === owner;
  const makeSession = (format: StudioKind, name: string, id?: string) => {
    const token = epoch.current;
    const owned = createStudioRecordingSession({ owner, kind: format, title: name.trim() || defaultTitle(format), projectId: id, isCurrent: () => live(token) && session.current === owned });
    session.current = owned; setConfirmationScope(`${id ?? 'new'}:${++confirmationSerial.current}`); return owned;
  };
  const ask = async (options: Parameters<typeof confirm>[0]): Promise<boolean> => {
    if (!mounted.current || confirmationOperation.current) return false;
    const operation = {}, token = epoch.current; confirmationOperation.current = operation;
    try { return await confirm(options) && live(token) && confirmationOperation.current === operation; }
    catch { return false; }
    finally { if (confirmationOperation.current === operation) confirmationOperation.current = null; }
  };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++epoch.current; }; }, []);
  useEffect(() => {
    // The first durable save replaces only the URL query. Keep the same session,
    // File receipts and controller when that project id comes back as a prop.
    if (session.current?.current()?.id === projectId && projectSnapshot.current?.ownerId === owner) return;
    const token = ++epoch.current; cancelConfirmation(); confirmationOperation.current = null; capture.current?.cancel(); candidate.current = null; attempted.current = new WeakSet(); exitIntent.current = false; exitWork.current = null; mutationWork.current = null; deviceWork.current = null; screenWork.current = null; saveBusy.current = false;
    projectSnapshot.current = null; setProject(null); setSelectedTake(undefined); setError(null); setNotice(null); setBusy(null); setLeaving(false); setChangingDevice(false); setTakesExpanded(true); setStage('setup'); setLiveSelected(false); setToolsOpen(false); countdownRef.current = null; setCountdown(null); setGuides(initialRecordingGuides()); setKind(initialKind); setTitle(initialTitle); setMode('camera'); setLoading(!!projectId);
    const owned = makeSession(initialKind, initialTitle, projectId); let active = true;
    if (projectId) void owned.loadExisting().then(value => {
      if (!active || !live(token) || session.current !== owned) return;
      if (!value) throw new Error('Esta gravação não está disponível neste navegador.');
      projectSnapshot.current = value; setProject(value); setKind(value.kind); setTitle(value.title); setSelectedTake(value.takes.at(-1)?.id);
    }).catch(cause => { if (active && live(token)) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a gravação.'); })
      .finally(() => { if (active && live(token)) setLoading(false); });
    return () => { active = false; };
    // initialKind/title seed a new session, rather than reconfiguring a running one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, projectId]);

  const captureMode: StudioCaptureMode = kind === 'podcast' ? 'audio' : mode;
  useEffect(() => {
    const owned = createStudioCapture({ mode: captureMode, aspectRatio: kind === 'short' ? '9:16' : '16:9' }); capture.current = owned;
    deviceWork.current = null; screenWork.current = null; setChangingDevice(false);
    const unsubscribe = owned.subscribe(value => {
      if (!mounted.current || currentOwner.current !== owner || capture.current !== owned) return;
      captureSnapshot.current = value; setCaptureState(value);
    });
    return () => { if (capture.current === owned) capture.current = null; unsubscribe(); owned.dispose(); };
  }, [owner, captureMode, kind]);
  useEffect(() => {
    setFullscreenAvailable(typeof workspace.current?.requestFullscreen === 'function');
    const changed = () => setFullscreen(document.fullscreenElement === workspace.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  useEffect(() => {
    const element = video.current;
    if (element) { element.srcObject = captureState.stream; if (captureState.stream) void element.play().catch(() => undefined); }
    return () => { if (element) { element.pause(); element.srcObject = null; } };
  }, [captureState.stream, stage]);
  const take = project?.takes.find(value => value.id === selectedTake);
  useEffect(() => {
    let active = true, url: string | undefined; setReviewURL(undefined);
    if (project && take?.assetId && !captureState.stream) void getAsset(owner, project.id, take.assetId).then(blob => {
      if (!active || !blob) return; url = URL.createObjectURL(blob); setReviewURL(url);
    }).catch(() => { if (active) setError('O original deste take não está disponível neste navegador.'); });
    // The player owns and pauses its media on unmount before this URL is released.
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [owner, project?.id, take?.assetId, captureState.stream]);

  const remember = (file: File): Candidate => {
    if (candidate.current?.file === file) return candidate.current;
    if (candidate.current && !candidate.current.saved) throw new Error('Salve ou descarte o trecho pendente antes de continuar.');
    if (!session.current) throw new Error('A sessão de gravação não está pronta.');
    const value: Candidate = { file, operationId: crypto.randomUUID(), session: session.current, token: epoch.current, work: null, saved: false, notice: captureSnapshot.current.error };
    candidate.current = value; return value;
  };
  const saveCandidate = (file: File): Promise<boolean> => {
    const entry = remember(file); if (entry.saved) return Promise.resolve(true); if (entry.work) return entry.work;
    const ownedCapture = capture.current; saveBusy.current = true; setBusy('save'); setError(null);
    const active = () => live(entry.token) && candidate.current === entry && session.current === entry.session;
    const work = (async () => {
      try {
        const saved = await entry.session.append(file, { operationId: entry.operationId, isCurrent: active });
        if (!active()) return false;
        entry.saved = true; projectSnapshot.current = saved; setProject(saved); setSelectedTake(saved.takes.at(-1)?.id); setNotice(entry.notice);
        if (capture.current === ownedCapture) ownedCapture?.cancel(); candidate.current = null;
        const params = new URLSearchParams(latest.current.location.search); params.set('project', saved.id); params.set('kind', saved.kind);
        navigate({ pathname: '/studio/record', search: `?${params}` }, { replace: true }); return true;
      } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : 'O trecho ainda não foi salvo. Tente novamente.'); return false; }
      finally { if (live(entry.token) && session.current === entry.session) { saveBusy.current = false; setBusy(null); } }
    })(); entry.work = work; void work.finally(() => { if (entry.work === work) entry.work = null; }); return work;
  };
  const saveRef = useRef(saveCandidate); saveRef.current = saveCandidate;
  useEffect(() => {
    if (captureState.phase !== 'recorded' || !captureState.file || attempted.current.has(captureState.file)) return;
    attempted.current.add(captureState.file); void saveRef.current(captureState.file);
  }, [captureState.phase, captureState.file]);

  const hasRisk = () => !!confirmationOperation.current || countdownRef.current !== null || ['preparing', 'recording', 'stopping'].includes(captureSnapshot.current.phase) || saveBusy.current || !!deviceWork.current || !!screenWork.current || captureSnapshot.current.scenes?.preparingScreen === true || !!candidate.current && !candidate.current.saved || !!captureSnapshot.current.file || captureSnapshot.current.pendingRecovery === true;
  const prepareExit = (): Promise<boolean> => {
    if (exitWork.current) return exitWork.current;
    if (confirmationOperation.current) return Promise.resolve(false);
    const token = epoch.current, owned = capture.current, ownedSession = session.current;
    const current = () => live(token) && capture.current === owned && session.current === ownedSession;
    const work = (async () => {
      try {
        if (mutationWork.current && !await mutationWork.current) return false;
        if (!current()) return false;
        let state = captureSnapshot.current, saveApproved = false;
        if (screenWork.current || state.scenes?.preparingScreen) {
          if (!await ask({ title: 'Cancelar o compartilhamento?', description: 'Vamos fechar as fontes desta sessão. Seus takes salvos continuam no projeto.', confirmLabel: 'Sair', tone: 'accent', icon: 'exit' }) || !current()) return false;
          if (['recording', 'stopping'].includes(captureSnapshot.current.phase) || candidate.current || captureSnapshot.current.file) return false;
          owned?.cancel(); screenWork.current = null;
        }
        if (countdownRef.current !== null) {
          if (!await ask({ title: 'Cancelar a contagem?', description: 'Nenhum take será gravado. Você voltará aos seus projetos.', confirmLabel: 'Sair da gravação', tone: 'accent', icon: 'exit' }) || !current()) return false;
          countdownRef.current = null; setCountdown(null);
        }
        state = captureSnapshot.current;
        if (['recording', 'stopping'].includes(state.phase)) {
          if (!await ask({ title: 'Salvar e sair?', description: 'Vamos encerrar a gravação e salvar este take antes de voltar aos seus projetos.', confirmLabel: 'Salvar e sair', tone: 'accent', icon: 'exit' }) || !current()) return false;
          saveApproved = true;
        } else if (state.phase === 'preparing') {
          if (!await ask({ title: 'Cancelar a abertura?', description: 'A câmera e o microfone serão fechados. Seus takes salvos permanecem no projeto.', confirmLabel: 'Sair', tone: 'accent', icon: 'exit' }) || !current()) return false;
          if (['recording', 'stopping'].includes(captureSnapshot.current.phase) || candidate.current || captureSnapshot.current.file) return false;
          owned?.cancel(); deviceWork.current = null; setChangingDevice(false);
        } else if (!candidate.current && (state.file || state.pendingRecovery)) {
          if (!await ask({ title: 'Salvar o trecho antes de sair?', description: 'Vamos tentar recuperar e salvar o original. Se o salvamento falhar, você continuará aqui com o trecho disponível.', confirmLabel: 'Salvar e sair', tone: 'accent', icon: 'exit' }) || !current()) return false;
          saveApproved = true;
        }
        // The browser may stop and autosave a partial take while the dialog is open.
        // Act only on this session's current risk, sharing any write already in flight.
        state = captureSnapshot.current;
        if (['recording', 'stopping'].includes(state.phase)) {
          if (!saveApproved || !owned) return false;
          const file = await owned.stop(); if (!current() || !await saveCandidate(file)) return false;
        } else if (candidate.current && !candidate.current.saved) {
          const entry = candidate.current; if (entry.session !== ownedSession || !await (entry.work ?? saveCandidate(entry.file))) return false;
        } else if (state.file || state.pendingRecovery) {
          if (!saveApproved || !owned) return false;
          const file = state.phase === 'error' || state.pendingRecovery ? await owned.stop() : state.file!;
          if (!current() || !await saveCandidate(file)) return false;
        }
        if (!current()) return false; owned?.cancel(); return true;
      } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'O trecho permanece disponível para tentar novamente.'); return false; }
    })(); exitWork.current = work; void work.finally(() => { if (exitWork.current === work) exitWork.current = null; }); return work;
  };
  const riskRef = useRef(hasRisk), exitRef = useRef(prepareExit); riskRef.current = hasRisk; exitRef.current = prepareExit;
  useStudioExitGuard({ enabled: true, hasRisk: () => riskRef.current(), prepare: () => exitRef.current() });
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (riskRef.current()) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', before); return () => window.removeEventListener('beforeunload', before);
  }, []);

  const report = (cause: unknown, token: number) => { if (live(token)) setError(cause instanceof Error ? cause.message : 'Não foi possível concluir esta ação.'); };
  const reportCapture = (cause: unknown, token: number, owned: StudioCaptureController) => {
    if (!live(token) || capture.current !== owned) return;
    if (cause instanceof Error && cause.name === 'AbortError') return;
    const denied = cause instanceof DOMException && cause.name === 'NotAllowedError';
    setError(captureSnapshot.current.error ?? (denied ? 'Permita câmera e microfone nas permissões deste site e tente novamente.' : cause instanceof Error ? cause.message : 'Não foi possível abrir esta entrada.'));
  };
  const authorizeScenes = () => {
    if (mode !== 'scenes' || latest.current.kind === 'podcast') return true;
    if (!latest.current.canUseScenes) { latest.current.onUpgradeScenes?.(); return false; }
    const support = studioScenesSupport();
    if (!support.supported) { setError(support.reason ?? 'Este navegador não oferece gravação contínua com cenas.'); return false; }
    return true;
  };
  const chooseMode = (next: 'camera' | 'screen' | 'scenes') => {
    if (!mounted.current || loading || confirmationOperation.current || exitIntent.current || document.visibilityState === 'hidden') return;
    if (next === 'scenes') {
      if (latest.current.kind === 'podcast') return;
      if (!latest.current.canUseScenes) { latest.current.onUpgradeScenes?.(); return; }
      const support = studioScenesSupport();
      if (!support.supported) { setError(support.reason ?? 'Este navegador não oferece gravação contínua com cenas.'); return; }
    }
    setError(null); setMode(next);
  };
  const openCapture = () => {
    if (loading || confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || candidate.current || captureSnapshot.current.pendingRecovery || countdownRef.current !== null || ['recording', 'stopping', 'preparing'].includes(captureSnapshot.current.phase)) return;
    const token = epoch.current, owned = capture.current; if (!owned || !authorizeScenes()) return;
    if (!projectSnapshot.current && !session.current?.current()) makeSession(latest.current.kind, latest.current.title);
    reviewPlayer.current?.pause(); setError(null); setNotice(null); setStage('production');
    // Keep getDisplayMedia/getUserMedia on the original user gesture.
    void owned.prepare().catch(cause => reportCapture(cause, token, owned));
  };
  const beginRecording = () => { if (confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || captureSnapshot.current.pendingRecovery || captureSnapshot.current.phase !== 'ready' || !authorizeScenes()) return; setError(null); setNotice(null); setToolsOpen(false); try { capture.current?.start(); } catch (cause) { report(cause, epoch.current); } };
  const start = () => {
    if (confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || captureSnapshot.current.pendingRecovery || countdownRef.current !== null || captureSnapshot.current.phase !== 'ready') return;
    if (!authorizeScenes()) return;
    setToolsOpen(false);
    if (guides.delay) { countdownRef.current = guides.delay; setCountdown(guides.delay); } else beginRecording();
  };
  const startRef = useRef(beginRecording); startRef.current = beginRecording;
  useEffect(() => {
    if (countdown === null || confirmationPending) return;
    const token = epoch.current;
    const timer = setTimeout(() => {
      if (!mounted.current || token !== epoch.current || currentOwner.current !== owner || confirmationOperation.current || countdownRef.current === null) return;
      if (document.visibilityState === 'hidden' || captureSnapshot.current.phase !== 'ready') { countdownRef.current = null; setCountdown(null); return; }
      const next = countdownRef.current - 1;
      countdownRef.current = next > 0 ? next : null; setCountdown(next > 0 ? next : null);
      if (next <= 0) startRef.current();
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, owner, confirmationPending]);
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'hidden') { if (countdownRef.current !== null) { countdownRef.current = null; setCountdown(null); } return; }
      if (video.current && captureSnapshot.current.stream) void video.current.play().catch(() => undefined);
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);
  const configureVideo = (patch: Parameters<StudioCaptureController['configureVideo']>[0]) => {
    if (confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || candidate.current || countdownRef.current !== null || captureSnapshot.current.phase !== 'ready') return;
    const token = epoch.current, owned = capture.current; if (!owned) return;
    setChangingDevice(true); setError(null);
    const work = owned.configureVideo(patch).then(() => true, cause => { reportCapture(cause, token, owned); return false; });
    deviceWork.current = work;
    void work.finally(() => { if (deviceWork.current === work) { deviceWork.current = null; if (live(token) && capture.current === owned) setChangingDevice(false); } });
  };
  const prepareScreen = () => {
    if (mode !== 'scenes' || confirmationOperation.current || exitWork.current || exitIntent.current || saveBusy.current || deviceWork.current || screenWork.current || candidate.current || countdownRef.current !== null || captureSnapshot.current.phase !== 'ready' || !authorizeScenes() || document.visibilityState === 'hidden') return;
    const token = epoch.current, owned = capture.current; if (!owned?.prepareScreen) return;
    setError(null); setToolsOpen(false);
    // Keep the display picker on the explicit sharing gesture. Exiting invalidates
    // this reservation without waiting for the browser's picker to settle.
    const operation = { controller: owned, token, work: Promise.resolve(false) };
    screenWork.current = operation;
    try {
      operation.work = owned.prepareScreen().then(() => true, cause => {
        if (screenWork.current === operation) reportCapture(cause, token, owned);
        return false;
      });
      void operation.work.finally(() => { if (screenWork.current === operation) screenWork.current = null; });
    } catch (cause) { if (screenWork.current === operation) { screenWork.current = null; reportCapture(cause, token, owned); } }
  };
  const sceneBlocked = () => !mounted.current || confirmationOperation.current !== null || exitWork.current !== null || exitIntent.current || saveBusy.current || deviceWork.current !== null || screenWork.current !== null || candidate.current !== null || countdownRef.current !== null || !['ready', 'recording'].includes(captureSnapshot.current.phase);
  const selectScene = (scene: StudioCaptureScene) => {
    if (mode !== 'scenes' || sceneBlocked()) return;
    const state = captureSnapshot.current.scenes;
    if (!state || state.preparingScreen || (scene === 'camera' ? !state.cameraReady : scene === 'screen' ? !state.screenReady : !state.cameraReady || !state.screenReady)) return;
    try { capture.current?.selectScene?.(scene); } catch (cause) { report(cause, epoch.current); }
  };
  const configureScene = (patch: StudioSceneConfigurationPatch) => {
    if (mode !== 'scenes' || sceneBlocked() || captureSnapshot.current.scenes?.preparingScreen) return;
    try { capture.current?.configureScene?.(patch); } catch (cause) { report(cause, epoch.current); }
  };
  const selectDevice = (selection: { cameraId?: string; microphoneId?: string }) => {
    if (confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || candidate.current || countdownRef.current !== null || !['ready', 'idle', 'error'].includes(captureSnapshot.current.phase) || captureSnapshot.current.file || captureSnapshot.current.pendingRecovery) return;
    const token = epoch.current, owned = capture.current; if (!owned) return;
    setChangingDevice(true); setError(null);
    const work = owned.selectDevices(selection).then(() => true, cause => { reportCapture(cause, token, owned); return false; });
    deviceWork.current = work;
    void work.finally(() => { if (deviceWork.current === work) { deviceWork.current = null; if (live(token) && capture.current === owned) setChangingDevice(false); } });
  };
  const toggleMicrophone = () => {
    if (confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || candidate.current || countdownRef.current !== null || captureSnapshot.current.phase !== 'ready') return;
    try { capture.current?.setMicrophoneEnabled(!captureSnapshot.current.microphoneEnabled); } catch (cause) { report(cause, epoch.current); }
  };
  const setSceneMicrophone = (enabled: boolean) => {
    if (mode !== 'scenes' || sceneBlocked() || !captureSnapshot.current.input) return;
    try { capture.current?.setMicrophoneEnabled(enabled); } catch (cause) { report(cause, epoch.current); }
  };
  const toggleFullscreen = () => {
    const token = epoch.current;
    const work = document.fullscreenElement === workspace.current ? document.exitFullscreen() : workspace.current?.requestFullscreen();
    void work?.catch(() => { if (live(token)) setError('Não foi possível abrir a tela cheia neste navegador. Você pode continuar gravando aqui.'); });
  };
  const stop = () => { if (confirmationOperation.current || exitWork.current) return; const token = epoch.current; setError(null); void capture.current?.stop().then(file => { if (live(token)) return saveCandidate(file); }).catch(cause => report(cause, token)); };
  const retry = () => { if (confirmationOperation.current || exitWork.current || saveBusy.current) return; const state = captureSnapshot.current; if (candidate.current) void saveCandidate(candidate.current.file); else if (state.file || state.pendingRecovery) stop(); };
  const discard = async () => {
    if (confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current) return;
    const token = epoch.current, owned = capture.current, ownedSession = session.current, entry = candidate.current, file = entry?.file ?? captureSnapshot.current.file, recoveryPending = captureSnapshot.current.pendingRecovery === true; if (!file && !recoveryPending) return;
    if (!await ask({ title: 'Descartar trecho?', description: 'Este trecho ainda não foi salvo e será descartado. Os takes já salvos continuam no projeto.', confirmLabel: 'Descartar trecho', tone: 'danger', icon: 'discard' })) return;
    if (!live(token) || capture.current !== owned || session.current !== ownedSession || candidate.current !== entry || (entry?.file ?? captureSnapshot.current.file) !== file || (captureSnapshot.current.pendingRecovery === true) !== recoveryPending || saveBusy.current || deviceWork.current || screenWork.current || entry?.saved || entry?.work) return;
    candidate.current = null; owned?.cancel(); setError(null); setNotice(null);
  };
  const downloadOriginal = () => {
    const file = candidate.current?.file ?? captureSnapshot.current.file; if (!file) return;
    const url = URL.createObjectURL(file), link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
    // The click starts the browser download; release only its temporary URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const leave = async (editor = false) => {
    if (confirmationOperation.current || exitIntent.current || loading) return; const token = epoch.current; exitIntent.current = true; setLeaving(true);
    const allowed = await prepareExit(); if (live(token) && allowed) { const saved = projectSnapshot.current; navigate(editor && saved?.takes.length ? `/studio/projects/${saved.id}` : '/studio/projects'); }
    else if (live(token)) { exitIntent.current = false; setLeaving(false); }
  };
  const remove = async (id: string, number: number) => {
    if (confirmationOperation.current || exitWork.current || exitIntent.current || saveBusy.current || mutationWork.current || busy || hasRisk()) return;
    const token = epoch.current, owned = session.current, ownedCapture = capture.current, target = projectSnapshot.current;
    if (!owned || !target?.takes.some(item => item.id === id)) return;
    if (!await ask({ title: `Excluir take ${number}?`, description: 'Este take será removido da gravação. Os demais takes permanecem no projeto.', confirmLabel: 'Excluir take', tone: 'danger', icon: 'delete' })) return;
    const current = () => live(token) && session.current === owned && capture.current === ownedCapture && projectSnapshot.current?.id === target.id;
    if (!current() || projectSnapshot.current !== target || !projectSnapshot.current.takes.some(item => item.id === id) || saveBusy.current || mutationWork.current || exitWork.current || exitIntent.current || hasRisk()) return;
    setBusy('remove'); saveBusy.current = true; setError(null);
    const work = (async () => {
      try { const updated = await owned.remove(id, { isCurrent: current }); if (!current()) return false; projectSnapshot.current = updated; setProject(updated); setSelectedTake(value => value === id ? updated.takes.at(-1)?.id : value); return true; }
      catch (cause) { report(cause, token); return false; } finally { if (current()) { saveBusy.current = false; setBusy(null); } }
    })(); mutationWork.current = work; void work.finally(() => { if (mutationWork.current === work) mutationWork.current = null; });
  };
  const reviewing = !!reviewURL && !captureState.stream, recording = captureState.phase === 'recording';
  const occupied = confirmationPending || loading || !!busy || changingDevice || leaving || countdown !== null || captureState.scenes?.preparingScreen === true || captureState.videoControls?.busy === true || captureState.phase === 'preparing' || captureState.phase === 'stopping';
  const pendingFile = !!candidate.current || captureState.phase === 'error' && (!!captureState.file || captureState.pendingRecovery === true);
  const total = project?.takes.reduce((sum, item) => sum + studioTakeDuration(item), 0) ?? 0;
  const captureCTA = kind === 'podcast' ? 'Ativar microfone' : mode === 'screen' ? 'Gravar tela' : mode === 'scenes' ? 'Abrir produção com cenas' : 'Abrir câmera';
  const permissionCard = !captureState.stream && !reviewing && !pendingFile;
  const permissionError = permissionCard && !occupied && (error || captureState.error);
  const permissionDenied = !!permissionError && /permit|permiss|negou|acesso.*bloque/i.test(error ?? captureState.error ?? '');
  const ready = captureState.phase === 'ready';
  const displayTitle = project?.title ?? (title.trim() || defaultTitle(kind));
  const aspectLabel = kind === 'aula' ? '16:9' : kind === 'short' ? '9:16' : 'Áudio';
  const director = useStudioSceneDirector({ scope: `${owner}:${confirmationScope}:${epoch.current}`, state: captureState, blocked: occupied || pendingFile, onScene: selectScene, onStop: stop, onMicrophone: setSceneMicrophone, onStart: start });
  const openDirector = () => { const token = epoch.current; void director.open().catch(cause => report(cause, token)); };

  return <div ref={workspace} className={`se-recording${recording ? ' is-recording' : ''}${mode === 'scenes' && kind !== 'podcast' ? ' has-scenes' : ''}`} data-stage={stage} onKeyDown={event => {
    if (mode !== 'scenes' || event.altKey || event.ctrlKey || event.metaKey || event.repeat || (event.target as HTMLElement).closest('input,select,textarea,[contenteditable="true"],[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
    const target = (['camera', 'screen', 'screen-camera'] as const)[Number(event.key) - 1];
    if (target) { event.preventDefault(); selectScene(target); }
  }}>
    {stage === 'setup' && <header className="se-recording-header"><div className="se-recording-brand"><button className="se-recording-icon" aria-label="Voltar aos projetos" disabled={leaving || confirmationPending} onClick={() => void leave()}><ArrowLeft size={20} /></button><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" /><span>Studio</span><i /><strong>Gravar</strong></div><span className="se-recording-header-note"><ShieldCheck size={15} />Seu espaço privado</span></header>}
    {stage === 'setup' ? <main className="se-recording-setup"><div className="se-recording-heading"><span>SEU ESPAÇO DE PRODUÇÃO</span><h1>Grave seu próximo conteúdo.</h1><p>Escolha o formato, enquadre e grave. A edição vem depois.</p></div>
      <div className="se-recording-formats" role="group" aria-label="Formato da gravação">{(['aula', 'short', 'podcast'] as const).map(format => <button key={format} disabled={loading || !!project} aria-pressed={!liveSelected && kind === format} onClick={() => { setLiveSelected(false); setKind(format); }} className={!liveSelected && kind === format ? 'selected' : ''}><div className={`se-recording-format-visual ${format}`}>{format === 'podcast' ? <Mic size={32} /> : <span><Play size={format === 'short' ? 18 : 24} fill="currentColor" /></span>}</div><strong>{kindName(format)}</strong><small>{format === 'aula' ? '16:9 · Para ir mais fundo' : format === 'short' ? '9:16 · Direto ao ponto' : 'Áudio · Sua voz em destaque'}</small>{!liveSelected && kind === format && <Check className="se-recording-format-check" size={17} />}</button>)}<button disabled={loading || !!project} aria-pressed={liveSelected} onClick={() => setLiveSelected(true)} className={liveSelected ? 'selected' : ''}><div className="se-recording-format-visual live"><Radio size={34} /></div><strong>Live</strong><small>Ao vivo · Conecte-se com seu público</small>{liveSelected && <Check className="se-recording-format-check" size={17} />}</button></div>
      {liveSelected ? <div className="se-recording-setup-controls"><p className="se-recording-live-intro">Prepare o título, a capa e os dispositivos antes de entrar ao vivo.</p><button className="se-recording-button primary se-recording-open" onClick={() => navigate('/studio/live')}><Radio size={18} />Preparar live<ArrowRight size={18} /></button></div> : <div className="se-recording-setup-controls"><label className="se-recording-field">Nome da gravação <small>opcional</small><input aria-label="Nome da gravação" placeholder={defaultTitle(kind)} value={title} maxLength={160} disabled={loading || !!project} onChange={event => setTitle(event.target.value)} /></label>
        {kind !== 'podcast' && <div className="se-recording-source" role="group" aria-label="Origem da gravação"><button aria-pressed={mode === 'camera'} disabled={confirmationPending || leaving} onClick={() => chooseMode('camera')}><Camera size={17} />Câmera</button><button aria-pressed={mode === 'screen'} disabled={confirmationPending || leaving} onClick={() => chooseMode('screen')}><Monitor size={17} />Tela e microfone</button></div>}
        {kind !== 'podcast' && <button className={`se-recording-premium-source${mode === 'scenes' ? ' selected' : ''}`} aria-label="Gravação com cenas · Premium" aria-pressed={mode === 'scenes'} disabled={loading || confirmationPending || leaving} onClick={() => chooseMode('scenes')}><span className="se-premium-demo" aria-hidden="true"><span className="se-premium-demo-screen"><i /><i /><i /><Monitor size={25} /><b><Camera size={13} /></b></span><span className="se-premium-demo-cuts"><Camera size={12} /><Monitor size={12} /><Layers3 size={12} /></span></span><span className="se-premium-source-copy"><strong>Gravação com cenas <span><Crown size={12} />Premium</span></strong><small>Alterne câmera, tela e tela com você. Tudo em um take.</small></span>{mode === 'scenes' ? <Check size={19} /> : <ArrowRight size={19} />}</button>}
        <button className="se-recording-button primary se-recording-open" disabled={loading || !!error && !!projectId && !project} onClick={openCapture}>{loading ? <Loader2 size={18} className="se-spin" /> : kind === 'podcast' ? <Mic size={18} /> : mode === 'screen' ? <Monitor size={18} /> : <Camera size={18} />}{captureCTA}<ArrowRight size={18} /></button><p className="se-recording-privacy">A captura é privada. Seus takes são salvos neste navegador.</p>
      </div>}{error && <p className="se-recording-error" role="alert">{error}</p>}
    </main> : <main className="se-recording-production">
      <div className={`se-recording-stage-shell${reviewing ? ' is-reviewing' : ''}`} data-testid="recording-stage">
        <div className={`se-recording-stage ${kind}`}>
          {kind !== 'podcast' && <video ref={video} className="se-recording-live" muted playsInline autoPlay aria-label="Prévia da gravação" style={{ display: captureState.stream ? 'block' : 'none', transform: mode !== 'scenes' && guides.mirrored ? 'scaleX(-1)' : undefined }} />}
          {guides.grid && captureState.stream && !recording && kind !== 'podcast' && <div className="se-recording-grid" aria-hidden="true" />}
          {captureState.stream && guides.scriptEnabled && <RecordingTeleprompter guides={guides} recording={recording} active={(ready || recording) && !changingDevice && !leaving && !busy && countdown === null && !toolsOpen && !captureState.videoControls?.busy} microphoneEnabled={captureState.microphoneEnabled} inputKey={captureState.input?.id ?? ''} getMicrophoneTrack={getMicrophoneTrack} onGuides={updateGuides} />}
          {reviewing && kind !== 'podcast' && <StudioTakePlayer key={take?.id} ref={reviewPlayer} src={reviewURL!} kind="video" durationSeconds={take?.duration ?? 0} label="Reproduzir take salvo" disabled={occupied || pendingFile} fullscreen={fullscreen} onFullscreen={fullscreenAvailable ? toggleFullscreen : undefined} />}
          {kind === 'podcast' && (captureState.stream || reviewing) && <div className="se-recording-audio-stage"><div className={`se-recording-audio-artwork${recording ? ' recording' : ''}`}><Mic size={48} strokeWidth={1.3} /></div><span className="se-recording-audio-eyebrow">{recording ? 'GRAVANDO PODCAST' : reviewing ? 'ORIGINAL SALVO' : 'PRONTO PARA GRAVAR'}</span><h2>{recording ? 'Sua voz, em foco.' : reviewing ? `Take ${(project?.takes.findIndex(item => item.id === take?.id) ?? -1) + 1}` : 'Sua próxima ideia começa aqui.'}</h2>{reviewing && <StudioTakePlayer key={take?.id} ref={reviewPlayer} src={reviewURL!} kind="audio" durationSeconds={take?.duration ?? 0} label="Reproduzir take salvo" disabled={occupied || pendingFile} />}</div>}
        </div>
        {!recording && <header className="se-recording-stage-header"><div className="se-recording-stage-brand"><button className="se-recording-icon" aria-label="Voltar aos projetos" disabled={leaving || confirmationPending} onClick={() => void leave()}><ArrowLeft size={19} /></button><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" /><div><h1>{displayTitle}</h1><p>{mode === 'scenes' ? 'Produção com cenas · Premium' : kindName(kind)} · {aspectLabel}{project?.takes.length ? ` · ${formatStudioDuration(total)} salvos` : ''}</p></div></div><div className="se-recording-stage-actions"><span className="se-recording-save-state">{busy === 'save' ? <><Loader2 size={13} className="se-spin" />Salvando take…</> : project?.takes.length ? <><Check size={13} />Takes salvos</> : <><ShieldCheck size={13} />Privado</>}</span>{fullscreenAvailable && <button className="se-recording-icon" title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}<button className="se-recording-icon" title="Configurações da gravação" aria-label="Configurações da gravação" aria-expanded={toolsOpen} disabled={occupied || pendingFile} onClick={() => setToolsOpen(value => !value)}><Settings2 size={18} /></button></div></header>}
        {!recording && countdown === null && captureState.stream && <div className="se-recording-quick-tools" aria-label="Ferramentas da câmera">
          {kind !== 'podcast' && mode !== 'screen' && <><button aria-label="Ajustar zoom" title="Zoom" disabled={occupied || pendingFile} onClick={() => openTools('image')}><ZoomIn size={18} /><span>{captureState.videoControls?.zoom.value.toFixed(1) ?? '1.0'}×</span></button><button aria-label="Filtros e imagem" title="Filtros e imagem" disabled={occupied || pendingFile} onClick={() => openTools('image')}><Palette size={18} /></button></>}
          <button aria-label="Temporizador da gravação" title="Temporizador" disabled={occupied || pendingFile} onClick={() => openTools('record')}><Timer size={18} />{guides.delay > 0 && <span>{guides.delay}s</span>}</button><button aria-label="Roteiro e teleprompter" title="Roteiro" disabled={occupied || pendingFile} onClick={() => openTools('script')}><FileText size={18} /></button>
        </div>}
        {toolsOpen && !recording && <StudioRecordingTools initialTab={toolsTab} state={captureState} camera={kind !== 'podcast' && mode !== 'screen'} disabled={occupied || pendingFile} guides={guides} onGuides={updateGuides} onVideo={configureVideo} onClose={closeTools} />}
        {countdown !== null && <div className="se-recording-countdown" role="status"><strong>{countdown}</strong><button className="se-recording-button" onClick={() => { countdownRef.current = null; setCountdown(null); }}>Cancelar contagem</button></div>}
        {permissionCard && <div className="se-recording-permission" data-permission-state={occupied ? 'preparing' : permissionError ? 'error' : 'closed'}>
          <div className={`se-recording-permission-icon${permissionError ? ' error' : ''}`}>{occupied ? <Loader2 size={30} className="se-spin" /> : kind === 'podcast' ? <Mic size={31} strokeWidth={1.4} /> : mode === 'screen' ? <Monitor size={31} strokeWidth={1.4} /> : <Camera size={31} strokeWidth={1.4} />}</div>
          <h2>{busy === 'save' ? 'Salvando seu take.' : captureState.phase === 'stopping' ? 'Preparando seu take.' : captureState.phase === 'preparing' ? kind === 'podcast' ? 'Vamos abrir seu microfone.' : mode === 'screen' ? 'Escolha o que quer compartilhar.' : 'Vamos abrir sua câmera.' : permissionError ? 'Não conseguimos abrir a entrada.' : 'Seu palco está pronto.'}</h2>
          <p>{busy === 'save' ? 'Estamos preservando o original neste navegador.' : captureState.phase === 'preparing' ? mode === 'screen' && kind !== 'podcast' ? 'Use a janela do navegador para escolher uma tela ou aba. Depois, permita o microfone.' : kind === 'podcast' ? 'Quando o navegador pedir, permita o microfone. Você poderá conferir o áudio antes de gravar.' : 'Quando o navegador pedir, permita câmera e microfone. O preview aparece aqui, sem iniciar a gravação.' : permissionError ? permissionDenied ? 'Confira as permissões deste site no ícone ao lado do endereço do navegador e tente novamente.' : 'Confira a conexão do dispositivo e se outro aplicativo está usando esta entrada.' : 'Abra a captura para conferir o enquadramento e o áudio antes de gravar.'}</p>
          {permissionError && <p className="se-recording-permission-error" role="alert">{error ?? captureState.error}</p>}
          {!occupied && <button className="se-recording-button primary" onClick={openCapture}>{permissionError ? 'Tentar novamente' : project?.takes.length ? 'Gravar outro take' : captureCTA}<ArrowRight size={16} /></button>}
          {!permissionError && !busy && <small><ShieldCheck size={13} />Só você vê esta captura.</small>}
        </div>}
        {!recording && pendingFile && <div className="se-recording-recovery"><div className="se-recording-permission-icon"><Film size={29} /></div><h2>{busy === 'save' ? 'Salvando seu take.' : 'Seu take ainda está com você.'}</h2><p>{busy === 'save' ? 'Aguarde a confirmação antes de continuar.' : captureState.pendingRecovery && !captureState.file ? 'Mantenha esta página aberta e tente recuperar o trecho capturado.' : 'Repita o salvamento ou baixe o original para guardar uma cópia.'}</p><div className="se-recording-feedback error" role="alert"><span>{error ?? captureState.error ?? 'Este trecho ainda não foi salvo.'}</span><div><button disabled={occupied} onClick={retry}>Tentar salvar take</button>{(candidate.current?.file || captureState.file) && <button onClick={downloadOriginal}>Baixar original</button>}<button disabled={occupied} onClick={discard}>Descartar trecho</button></div></div></div>}
        {!recording && !permissionError && !pendingFile && (error || captureState.error || notice) && <div className={`se-recording-feedback se-recording-stage-feedback ${error || captureState.phase === 'error' ? 'error' : ''}`} role={error || captureState.phase === 'error' ? 'alert' : 'status'}><span>{error ?? captureState.error ?? notice}</span></div>}
        {recording && <span className="se-recording-timer" role="timer"><i />{formatStudioEditorTime(captureState.elapsed)}</span>}
        {captureState.input && <AudioMonitor state={captureState} />}
        {reviewing && !recording && <span className="se-recording-review-badge"><Play size={12} />Revisando take {(project?.takes.findIndex(item => item.id === take?.id) ?? -1) + 1}</span>}
      </div>
      {mode === 'scenes' && kind !== 'podcast' && captureState.scenes && captureState.stream && <StudioSceneControls state={captureState.scenes} disabled={occupied || pendingFile || !['ready', 'recording'].includes(captureState.phase)} recording={recording} onScene={selectScene} onPrepareScreen={prepareScreen} onConfigure={configureScene} director={{ supported: director.supported, isOpen: director.isOpen, onOpen: openDirector }} />}
      {!recording && !!project?.takes.length && <section className={`se-recording-takes${takesExpanded ? '' : ' collapsed'}`} aria-label="Takes salvos"><button className="se-recording-takes-toggle" aria-label={takesExpanded ? 'Recolher takes salvos' : 'Mostrar takes salvos'} aria-expanded={takesExpanded} aria-controls="se-recording-saved-takes" onClick={() => setTakesExpanded(value => !value)}><Film size={16} /><span>Seus takes<strong>{project.takes.length}</strong></span>{takesExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button><div className="se-recording-takes-strip" id="se-recording-saved-takes" hidden={!takesExpanded}>{project.takes.map((item, index) => <article key={item.id} className={item.id === selectedTake ? 'selected' : ''}><button className="se-recording-take" aria-label={`Revisar take ${index + 1}`} aria-pressed={item.id === selectedTake} disabled={occupied || pendingFile} onClick={() => { capture.current?.cancel(); setSelectedTake(item.id); }}><TakeThumbnail owner={owner} project={project} take={item} /><span><strong>Take {index + 1}</strong><small>{formatStudioDuration(studioTakeDuration(item))}</small></span></button><button className="se-recording-take-remove" aria-label={`Excluir take ${index + 1}`} disabled={occupied || pendingFile} onClick={() => void remove(item.id, index + 1)}><X size={13} /></button></article>)}</div></section>}
      <div className="se-recording-controls" data-testid="recording-toolbar" aria-label={recording ? 'Gravação em andamento' : 'Controles de gravação'}>
        {recording ? <div className="se-recording-record-control"><button className="se-recording-rec stop" aria-label="Encerrar gravação" disabled={confirmationPending} onClick={stop}><Square fill="currentColor" size={22} /></button><span>Encerrar gravação</span></div> : <>
          <div className="se-recording-devices">
            {kind !== 'podcast' && mode !== 'screen' ? <DeviceSelector label="Câmera" current={captureState.camera} devices={captureState.devices?.cameras ?? []} disabled={occupied || pendingFile} onChange={cameraId => selectDevice({ cameraId })} /> : kind !== 'podcast' ? <div className="se-recording-screen-label"><Monitor size={17} /><span>Tela compartilhada<small>{captureState.stream ? 'Captura ativa' : 'Selecione uma tela ao abrir'}</small></span></div> : null}
            <div className="se-recording-microphone-control"><button className={`se-recording-mute${captureState.microphoneEnabled === false ? ' muted' : ''}`} aria-label={captureState.microphoneEnabled === false ? 'Ativar microfone da gravação' : 'Desativar microfone'} aria-pressed={captureState.microphoneEnabled === false} title={captureState.microphoneEnabled === false ? 'Ativar microfone' : 'Desativar microfone'} disabled={!ready || occupied || pendingFile || !captureState.input} onClick={toggleMicrophone}>{captureState.microphoneEnabled === false ? <MicOff size={19} /> : <Mic size={19} />}</button><DeviceSelector label="Microfone" current={captureState.input} devices={captureState.devices?.microphones ?? []} disabled={occupied || pendingFile} onChange={microphoneId => selectDevice({ microphoneId })} /></div>
          </div>
          <div className="se-recording-record-control">{ready ? <><button className="se-recording-rec" aria-label="Iniciar gravação" disabled={occupied || pendingFile} onClick={start}><i /></button><span>Gravar take</span></> : occupied ? <span className="se-recording-working" role="status"><Loader2 size={18} className="se-spin" />{countdown !== null ? 'Preparando REC…' : changingDevice ? 'Ajustando entrada…' : busy === 'save' ? 'Salvando original…' : busy === 'remove' ? 'Removendo take…' : captureState.phase === 'stopping' ? 'Preparando o take…' : 'Aguardando permissão…'}</span> : !pendingFile && !permissionCard && <button className="se-recording-button" disabled={occupied || pendingFile} onClick={openCapture}><span className="se-recording-small-dot" />{project?.takes.length ? 'Gravar outro take' : captureCTA}</button>}</div>
          <div className="se-recording-next"><span>{project?.takes.length ? `${project.takes.length} ${project.takes.length === 1 ? 'take salvo' : 'takes salvos'} · ${formatStudioDuration(total)}` : 'Grave seu primeiro take'}</span><button className="se-recording-button primary" disabled={!project?.takes.length || occupied || pendingFile} onClick={() => void leave(true)}>Ir para edição<ArrowRight size={17} /></button></div>
        </>}
      </div>
    </main>}
    {dialog}
    {director.portal}
  </div>;
}
