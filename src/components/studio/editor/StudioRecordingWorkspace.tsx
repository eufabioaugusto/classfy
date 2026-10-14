import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Camera, Check, ChevronDown, ChevronUp, Film, Loader2, Maximize2, Mic, MicOff, Minimize2, Monitor, Play, Palette, Timer, FileText, ZoomIn, Settings2, ShieldCheck, Smartphone, Square, X } from 'lucide-react';
import { createStudioCapture, type StudioCaptureController, type StudioCaptureMode, type StudioCaptureState } from '@/lib/studio/editor/capture';
import { studioScenesSupport, type StudioCaptureScene, type StudioSceneConfigurationPatch } from '@/lib/studio/editor/sceneTypes';
import { createStudioRecordingSession } from '@/lib/studio/editor/recording';
import { getAsset } from '@/lib/studio/editor/storage';
import { formatStudioEditorTime, formatStudioDuration, studioTakeDuration, type StudioKind, type StudioProject, type StudioTake } from '../../../../shared/studio';
import { StudioRecordingTools, type RecordingGuides } from './StudioRecordingTools';
import { StudioRecordingQuality } from './StudioRecordingQuality';
import { StudioRecordingSetup, type StudioRecordingLayout, type StudioRecordingCameraSource } from './StudioRecordingSetup';
import { RecordingTeleprompter } from './RecordingTeleprompter';
import { useStudioExitGuard } from './useStudioExitGuard';
import { useStudioConfirmation } from './useStudioConfirmation';
import { StudioTakePlayer, type StudioTakePlayerHandle } from './StudioTakePlayer';
import { StudioSceneControls } from './StudioSceneControls';
import { useStudioSceneDirector } from './useStudioSceneDirector';
import { createStudioRemoteCapture, studioRemoteAudioReady, type StudioRemoteCaptureController, type StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { createStudioRemoteSceneCapture, studioRemoteMicrophoneId } from '@/lib/studio/editor/remoteSceneCapture';
import { StudioRemoteCameraPairing, StudioRemoteCameraStatus, studioRemoteTransferLabel } from './StudioRemoteCameraPairing';
import { StudioRemoteCameraControls, type StudioRemoteToolsTab } from './StudioRemoteCameraControls';
import { StudioRemoteMicrophoneMonitor } from './StudioRemoteMicrophoneMonitor';
import { remoteCameraFocusPoint } from './remoteCameraFocusPoint';
import { StudioRemoteSceneRecoveryList, type StudioRemoteSceneRecoveredSource } from './StudioRemoteSceneRecoveryList';
import { readStudioRecordingSelection, saveStudioRecordingSelection } from '@/lib/studio/editor/recordingSetupPreferences';
import '@/styles/studio-recording.css';

type RecordingSession = ReturnType<typeof createStudioRecordingSession>;
type Candidate = { file: File; operationId: string; remoteTakeId?: string; session: RecordingSession; token: number; work: Promise<boolean> | null; saved: boolean; notice: string | null };
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
export function StudioRecordingWorkspace({ owner, initialKind, initialTitle = '', projectId, canUseScenes = false, premiumLoading = false, onUpgradeScenes, onUpgradeRemote }: { owner: string; initialKind?: StudioKind; initialTitle?: string; projectId?: string; canUseScenes?: boolean; premiumLoading?: boolean; onUpgradeScenes?: () => void; onUpgradeRemote?: () => void }) {
  const navigate = useNavigate(), location = useLocation();
  const [stage, setStage] = useState<'setup' | 'production'>('setup'), [kind, setKind] = useState<StudioKind>(initialKind ?? 'aula');
  const [captureRevision, setCaptureRevision] = useState(0), selectionTouched = useRef(false);
  const [previewRequested, setPreviewRequested] = useState(false);
  const [liveSelected, setLiveSelected] = useState(false), [toolsOpen, setToolsOpen] = useState(false), [guides, setGuides] = useState(initialRecordingGuides);
  const [toolsTab, setToolsTab] = useState<StudioRemoteToolsTab>('image');
  const [focusTarget, setFocusTarget] = useState<{ left: number; top: number } | null>(null);
  const openTools = (tab: StudioRemoteToolsTab) => { if (confirmationOperation.current || exitIntent.current) return; setToolsTab(tab); setToolsOpen(true); };
  const closeTools = useCallback(() => setToolsOpen(false), []);
  const [countdown, setCountdown] = useState<number | null>(null), countdownRef = useRef<number | null>(null);
  const [title, setTitle] = useState(initialTitle), [mode, setMode] = useState<'camera' | 'screen' | 'scenes' | 'remote'>('camera'), [remoteScenes, setRemoteScenes] = useState(false);
  const remoteCapture = useRef<StudioRemoteCaptureController | null>(null);
  const [remoteState, setRemoteState] = useState<StudioRemoteView | null>(null);
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
  const latest = useRef({ stage, kind, title, location, canUseScenes, onUpgradeScenes, onUpgradeRemote }); latest.current = { stage, kind, title, location, canUseScenes, onUpgradeScenes, onUpgradeRemote }; currentOwner.current = owner;
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
    const savedSelection = !projectId ? readStudioRecordingSelection(owner, canUseScenes, studioScenesSupport().supported) : null;
    const seedKind = initialKind ?? savedSelection?.kind ?? 'aula';
    selectionTouched.current = false;
    setCaptureRevision(value => value + 1);
    setPreviewRequested(false);
    projectSnapshot.current = null; setProject(null); setSelectedTake(undefined); setError(null); setNotice(null); setBusy(null); setLeaving(false); setChangingDevice(false); setTakesExpanded(true); setStage('setup'); setLiveSelected(false); setToolsOpen(false); countdownRef.current = null; setCountdown(null); setGuides(initialRecordingGuides()); setKind(seedKind); setTitle(initialTitle); setMode(seedKind === 'podcast' ? 'camera' : savedSelection?.mode ?? 'camera'); setRemoteScenes(seedKind !== 'podcast' && (savedSelection?.remoteScenes ?? false)); setRemoteState(null); setLoading(!!projectId);
    const owned = makeSession(seedKind, initialTitle, projectId); let active = true;
    if (projectId) void owned.loadExisting().then(value => {
      if (!active || !live(token) || session.current !== owned) return;
      if (!value) throw new Error('Esta gravação não está disponível neste navegador.');
      projectSnapshot.current = value; setProject(value); setKind(value.kind); setCaptureRevision(revision => revision + 1); setTitle(value.title); setSelectedTake(value.takes.at(-1)?.id);
    }).catch(cause => { if (active && live(token)) setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a gravação.'); })
      .finally(() => { if (active && live(token)) setLoading(false); });
    return () => { active = false; };
    // initialKind/title seed a new session, rather than reconfiguring a running one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, projectId]);

  useEffect(() => {
    if (projectId || selectionTouched.current || captureSnapshot.current.stream || captureSnapshot.current.phase === 'preparing') return;
    const saved = readStudioRecordingSelection(owner, canUseScenes, studioScenesSupport().supported);
    if (!saved) return;
    const nextKind = initialKind ?? saved.kind;
    setKind(nextKind); setMode(nextKind === 'podcast' ? 'camera' : saved.mode); setRemoteScenes(nextKind !== 'podcast' && saved.remoteScenes);
    setCaptureRevision(value => value + 1);
  }, [owner, canUseScenes, projectId, initialKind]);

  const isRemote = mode === 'remote' && kind !== 'podcast', hasScenes = kind !== 'podcast' && (mode === 'scenes' || isRemote && remoteScenes);
  const captureMode: StudioCaptureMode = kind === 'podcast' ? 'audio' : mode === 'remote' ? 'camera' : mode;
  useEffect(() => {
    const selectedKind = latest.current.kind;
    const base = isRemote ? createStudioRemoteCapture({ owner, kind: selectedKind === 'short' ? 'short' : 'aula', title: latest.current.title, projectId: projectSnapshot.current?.id, getContext: () => ({ title: latest.current.title, projectId: projectSnapshot.current?.id }) }) : null;
    remoteCapture.current = base;
    const owned = base ? remoteScenes ? createStudioRemoteSceneCapture({ remote: base, owner, aspectRatio: selectedKind === 'short' ? '9:16' : '16:9' }) : base : createStudioCapture({ mode: captureMode, aspectRatio: selectedKind === 'short' ? '9:16' : '16:9' }); capture.current = owned;
    deviceWork.current = null; screenWork.current = null; setChangingDevice(false);
    const unsubscribe = owned.subscribe(value => {
      if (!mounted.current || currentOwner.current !== owner || capture.current !== owned) return;
      captureSnapshot.current = value; setCaptureState(value);
    });
    const unsubscribeRemote = base?.subscribeRemote(value => { if (mounted.current && currentOwner.current === owner && remoteCapture.current === base) setRemoteState(value); });
    if (!base) setRemoteState(null);
    return () => { if (capture.current === owned) capture.current = null; if (remoteCapture.current === base) remoteCapture.current = null; unsubscribe(); unsubscribeRemote?.(); owned.dispose(); if (base && base !== owned) base.dispose(); };
  }, [owner, captureMode, isRemote, remoteScenes, captureRevision]);
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
  useEffect(() => {
    if (!focusTarget) return;
    const timer = setTimeout(() => setFocusTarget(null), 1400);
    return () => clearTimeout(timer);
  }, [focusTarget]);
  const take = project?.takes.find(value => value.id === selectedTake);
  useEffect(() => {
    let active = true, url: string | undefined; setReviewURL(undefined);
    if (project && take?.assetId && !captureState.stream) void getAsset(owner, project.id, take.assetId).then(blob => {
      if (!active || !blob) return; url = URL.createObjectURL(blob); setReviewURL(url);
    }).catch(() => { if (active) setError('O original deste take não está disponível neste navegador.'); });
    // The player owns and pauses its media on unmount before this URL is released.
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [owner, project?.id, take?.assetId, captureState.stream]);

  const remember = (file: File, source?: StudioRemoteSceneRecoveredSource): Candidate => {
    if (candidate.current?.file === file) return candidate.current;
    if (candidate.current && !candidate.current.saved) throw new Error('Salve ou descarte o trecho pendente antes de continuar.');
    if (!session.current) throw new Error('A sessão de gravação não está pronta.');
    const remoteTakeId = source?.takeId ?? remoteState?.pendingTakeId;
    const value: Candidate = { file, operationId: remoteTakeId ?? crypto.randomUUID(), ...(remoteTakeId ? { remoteTakeId } : {}), session: session.current, token: epoch.current, work: null, saved: false, notice: captureSnapshot.current.error };
    candidate.current = value; return value;
  };
  const saveCandidate = (file: File, source?: StudioRemoteSceneRecoveredSource): Promise<boolean> => {
    const entry = remember(file, source); if (entry.saved) return Promise.resolve(true); if (entry.work) return entry.work;
    const ownedCapture = capture.current; saveBusy.current = true; setBusy('save'); setError(null);
    const active = () => live(entry.token) && candidate.current === entry && session.current === entry.session;
    const work = (async () => {
      try {
        const saved = await entry.session.append(file, { operationId: entry.operationId, remoteTakeId: entry.remoteTakeId, isCurrent: active });
        if (!active()) return false;
        entry.saved = true; projectSnapshot.current = saved; setProject(saved); setSelectedTake(saved.takes.at(-1)?.id); setNotice(entry.notice);
        if (capture.current === ownedCapture) { remoteCapture.current?.discardRemoteRecovery(); ownedCapture?.cancel(); } candidate.current = null;
        const params = new URLSearchParams(latest.current.location.search); params.set('project', saved.id); params.set('kind', saved.kind);
        navigate({ pathname: '/studio/record', search: `?${params}` }, { replace: true }); return true;
      } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : 'O trecho ainda não foi salvo. Salve o take para continuar.'); return false; }
      finally { if (live(entry.token) && session.current === entry.session) { saveBusy.current = false; setBusy(null); } }
    })(); entry.work = work; void work.finally(() => { if (entry.work === work) entry.work = null; }); return work;
  };
  const saveRef = useRef(saveCandidate); saveRef.current = saveCandidate;
  useEffect(() => {
    if (captureState.phase !== 'recorded' || !captureState.file || attempted.current.has(captureState.file)) return;
    attempted.current.add(captureState.file); void saveRef.current(captureState.file);
  }, [captureState.phase, captureState.file]);

  const hasRisk = () => !!confirmationOperation.current || countdownRef.current !== null || ['preparing', 'recording', 'stopping'].includes(captureSnapshot.current.phase) || saveBusy.current || !!deviceWork.current || !!screenWork.current || captureSnapshot.current.scenes?.preparingScreen === true || !!candidate.current && !candidate.current.saved || !!captureSnapshot.current.file || captureSnapshot.current.pendingRecovery === true;
  const saveRecoveredRemote = async (file: File, source?: StudioRemoteSceneRecoveredSource) => {
    if (!mounted.current || hasRisk() || exitIntent.current) throw new Error('Salve ou descarte o take atual antes de recuperar outra gravação.');
    const token = epoch.current, formatChanged = !!source && source.kind !== latest.current.kind;
    if (source) { const owned = projectSnapshot.current; if (!owned || owned.id !== source.projectId) { projectSnapshot.current = null; setProject(null); setSelectedTake(undefined); makeSession(source.kind, source.title, source.projectId ?? undefined); setKind(source.kind); setTitle(source.title); } }
    setStage('production');
    const saved = await saveCandidate(file, source);
    if (formatChanged && live(token)) setCaptureRevision(revision => revision + 1);
    if (!saved) throw new Error('O take ainda não foi adicionado. Seus originais continuam preservados.');
  };
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
          if (!await ask({ title: 'Salvar o trecho antes de sair?', description: 'Vamos recuperar e salvar o original. Se o salvamento falhar, você continuará aqui com o trecho disponível.', confirmLabel: 'Salvar e sair', tone: 'accent', icon: 'exit' }) || !current()) return false;
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
      } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'O trecho permanece disponível para salvar.'); return false; }
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
    setError(captureSnapshot.current.error ?? (denied ? 'Permita câmera e microfone nas permissões deste site e abra a captura.' : cause instanceof Error ? cause.message : 'Não foi possível abrir esta entrada.'));
  };
  const authorizeScenes = () => {
    if (isRemote && !latest.current.canUseScenes) { (latest.current.onUpgradeRemote ?? latest.current.onUpgradeScenes)?.(); return false; }
    if (!hasScenes) return true;
    if (!latest.current.canUseScenes) { latest.current.onUpgradeScenes?.(); return false; }
    const support = studioScenesSupport();
    if (!support.supported) { setError(support.reason ?? 'Este navegador não oferece gravação contínua com cenas.'); return false; }
    return true;
  };
  const chooseMode = (next: 'camera' | 'screen' | 'scenes' | 'remote', withScenes = next === 'scenes') => {
    if (!mounted.current || loading || hasRisk() || captureSnapshot.current.videoControls?.busy || exitIntent.current || document.visibilityState === 'hidden') return;
    if (next === 'remote' && !latest.current.canUseScenes) { (latest.current.onUpgradeRemote ?? latest.current.onUpgradeScenes)?.(); return; }
    if (withScenes) {
      if (latest.current.kind === 'podcast') return;
      if (!latest.current.canUseScenes) { latest.current.onUpgradeScenes?.(); return; }
      const support = studioScenesSupport();
      if (!support.supported) { setError(support.reason ?? 'Este navegador não oferece gravação contínua com cenas.'); return; }
    }
    const nextRemoteScenes = next === 'remote' && withScenes;
    if (next === mode && nextRemoteScenes === remoteScenes) return;
    selectionTouched.current = true; capture.current?.cancel(); setPreviewRequested(false); setToolsOpen(false); setFocusTarget(null);
    setError(null); setMode(next); setRemoteScenes(nextRemoteScenes);
  };
  const chooseSetupFormat = async (next: StudioKind | 'live') => {
    if (!mounted.current || loading || project || hasRisk() || captureSnapshot.current.videoControls?.busy || exitIntent.current) return;
    if (next === (liveSelected ? 'live' : kind)) return;
    selectionTouched.current = true; setError(null); setToolsOpen(false);
    const token = epoch.current, owned = capture.current;
    if (next !== 'live' && next !== 'podcast' && kind !== 'podcast' && !liveSelected && !isRemote && owned?.configureAspectRatio && captureSnapshot.current.phase === 'ready') {
      setChangingDevice(true);
      const current = () => live(token) && capture.current === owned && deviceWork.current === work && !exitIntent.current;
      const work = owned.configureAspectRatio(next === 'short' ? '9:16' : '16:9').then(() => { if (!current()) return false; setKind(next); return true; }, cause => { if (current()) report(cause, token); return false; });
      deviceWork.current = work;
      try { await work; } finally { if (deviceWork.current === work) { const active = current(); deviceWork.current = null; if (active) setChangingDevice(false); } }
      return;
    }
    owned?.cancel(); setPreviewRequested(false); setFocusTarget(null); setCaptureRevision(value => value + 1);
    setLiveSelected(next === 'live');
    if (next !== 'live') setKind(next);
    if (next === 'live' || next === 'podcast') { setMode('camera'); setRemoteScenes(false); }
    setError(null);
  };
  const chooseSetupLayout = (next: StudioRecordingLayout) => {
    if (kind === 'podcast' || liveSelected) return;
    chooseMode(mode === 'remote' && latest.current.canUseScenes && next !== 'screen' ? 'remote' : next, next === 'scenes');
  };
  const chooseSetupCamera = (next: StudioRecordingCameraSource) => {
    if (kind === 'podcast' || liveSelected || mode === 'screen') return;
    const scenes = latest.current.canUseScenes && (mode === 'scenes' || mode === 'remote' && remoteScenes);
    chooseMode(next === 'iphone' ? 'remote' : scenes ? 'scenes' : 'camera', scenes);
  };
  const reconnectRemote = () => {
    const owned = remoteCapture.current, token = epoch.current; if (!owned || confirmationOperation.current || exitIntent.current || saveBusy.current) return;
    const current = owned.getEnvelope();
    if (!current?.session.deviceId && Date.parse(remoteState?.pairing?.expiresAt ?? '') < Date.now()) { owned.cancel(); void owned.prepare().catch(cause => reportCapture(cause, token, capture.current!)); }
    else void owned.reconnect().catch(cause => { if (live(token)) setError(cause instanceof Error ? cause.message : 'Não foi possível reconectar o iPhone.'); });
  };
  const cancelRemoteConnection = () => {
    if (!isRemote || confirmationOperation.current || exitWork.current || exitIntent.current || saveBusy.current || captureSnapshot.current.pendingRecovery || ['recording', 'stopping'].includes(captureSnapshot.current.phase)) return;
    capture.current?.cancel(); setPreviewRequested(false); setError(null); setNotice(null); setToolsOpen(false);
    setStage(projectSnapshot.current?.takes.length ? 'production' : 'setup');
  };
  const unlinkRemote = async () => {
    const owned = remoteCapture.current, token = epoch.current;
    if (!owned || confirmationOperation.current || exitWork.current || exitIntent.current || saveBusy.current || captureSnapshot.current.pendingRecovery || ['recording', 'stopping'].includes(captureSnapshot.current.phase)) return;
    if (!await ask({ title: 'Desvincular este iPhone?', description: 'Este computador deixará de conectar automaticamente. Seus takes salvos e os originais no iPhone continuam preservados. Para vincular novamente, leia um novo QR.', confirmLabel: 'Desvincular iPhone', tone: 'accent', icon: 'exit' }) || !live(token) || remoteCapture.current !== owned) return;
    setChangingDevice(true); setError(null);
    try { await owned.unlinkRemote(); if (live(token)) { capture.current?.cancel(); setPreviewRequested(false); setStage(projectSnapshot.current?.takes.length ? 'production' : 'setup'); } }
    catch (cause) { report(cause, token); }
    finally { if (live(token)) setChangingDevice(false); }
  };
  const configureRemote = async (patch: Parameters<StudioRemoteCaptureController['configureRemote']>[0]) => {
    const owned = remoteCapture.current, token = epoch.current;
    if (!owned || confirmationOperation.current || remoteControlsOccupied || pendingFile || exitIntent.current || !['ready', 'error'].includes(captureSnapshot.current.phase)) throw new Error('Aguarde o iPhone estar pronto para ajustar a câmera.');
    setError(null);
    try { await owned.configureRemote(patch); }
    catch (cause) { if (live(token) && remoteCapture.current === owned) setError(cause instanceof Error ? cause.message : 'O iPhone não confirmou o ajuste.'); throw cause; }
  };
  const selectRemoteMicrophone = async (audioInputId: string | null) => {
    const owned = remoteCapture.current, composite = capture.current, token = epoch.current;
    if (!owned || !composite || confirmationOperation.current || occupied || pendingFile || deviceWork.current || screenWork.current || countdownRef.current !== null || exitIntent.current || captureSnapshot.current.phase !== 'ready') throw new Error('Escolha o microfone antes de iniciar a gravação.');
    setError(null); setChangingDevice(true);
    const selection = hasScenes ? composite.selectDevices({ microphoneId: studioRemoteMicrophoneId(audioInputId) }) : owned.configureRemote({ audioInputId });
    const work = selection.then(() => true, () => false); deviceWork.current = work;
    try { await selection; }
    catch (cause) { if (live(token) && remoteCapture.current === owned) setError(cause instanceof Error ? cause.message : 'O iPhone não confirmou esse microfone.'); throw cause; }
    finally { if (deviceWork.current === work) { deviceWork.current = null; if (live(token) && capture.current === composite) setChangingDevice(false); } }
  };
  const openCapture = () => {
    if (loading || confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || candidate.current || captureSnapshot.current.pendingRecovery || countdownRef.current !== null || ['recording', 'stopping', 'preparing'].includes(captureSnapshot.current.phase)) return;
    const token = epoch.current, owned = capture.current; if (!owned || !authorizeScenes()) return;
    if (!projectSnapshot.current && !session.current?.current()) makeSession(latest.current.kind, latest.current.title);
    saveStudioRecordingSelection(owner, { kind: latest.current.kind, mode, remoteScenes });
    reviewPlayer.current?.pause(); setPreviewRequested(true); setError(null); setNotice(null);
    // Keep getDisplayMedia/getUserMedia on the original user gesture.
    void owned.prepare().catch(cause => reportCapture(cause, token, owned));
  };
  const cancelPreparation = () => {
    if (confirmationOperation.current || exitWork.current || saveBusy.current || exitIntent.current || candidate.current || captureSnapshot.current.pendingRecovery || ['recording', 'stopping', 'recorded'].includes(captureSnapshot.current.phase)) return;
    capture.current?.cancel(); setPreviewRequested(false); deviceWork.current = null; screenWork.current = null; setChangingDevice(false); setToolsOpen(false); setError(null); setFocusTarget(null); countdownRef.current = null; setCountdown(null);
  };
  const enterProduction = () => {
    if (!mounted.current || latest.current.stage !== 'setup' || loading || hasRisk() || exitIntent.current || captureSnapshot.current.videoControls?.busy || captureSnapshot.current.phase !== 'ready' || document.visibilityState === 'hidden' || !authorizeScenes()) return;
    setError(null); setNotice(null); setFocusTarget(null);
    setToolsTab(isRemote ? 'camera' : kind === 'podcast' || mode === 'screen' ? 'record' : 'image');
    setToolsOpen(true); setStage('production');
  };
  const beginRecording = () => {
    if (latest.current.stage !== 'production' || confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || captureSnapshot.current.pendingRecovery || captureSnapshot.current.phase !== 'ready' || !authorizeScenes()) return;
    if (!projectSnapshot.current) makeSession(latest.current.kind, latest.current.title);
    saveStudioRecordingSelection(owner, { kind: latest.current.kind, mode, remoteScenes });
    setError(null); setNotice(null); setToolsOpen(false);
    try { capture.current?.start(); } catch (cause) { report(cause, epoch.current); }
  };
  const start = () => {
    if (latest.current.stage !== 'production' || confirmationOperation.current || exitWork.current || saveBusy.current || deviceWork.current || screenWork.current || exitIntent.current || captureSnapshot.current.pendingRecovery || countdownRef.current !== null || captureSnapshot.current.phase !== 'ready') return;
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
    if (!hasScenes || confirmationOperation.current || exitWork.current || exitIntent.current || saveBusy.current || deviceWork.current || screenWork.current || candidate.current || countdownRef.current !== null || captureSnapshot.current.phase !== 'ready' || !authorizeScenes() || document.visibilityState === 'hidden') return;
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
    if (!hasScenes || sceneBlocked()) return;
    const state = captureSnapshot.current.scenes;
    if (!state || state.preparingScreen || (scene === 'camera' ? !state.cameraReady : scene === 'screen' ? !state.screenReady : !state.cameraReady || !state.screenReady)) return;
    try { capture.current?.selectScene?.(scene); } catch (cause) { report(cause, epoch.current); }
  };
  const configureScene = (patch: StudioSceneConfigurationPatch) => {
    if (!hasScenes || sceneBlocked() || captureSnapshot.current.scenes?.preparingScreen) return;
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
    if (!hasScenes || sceneBlocked() || !captureSnapshot.current.input) return;
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
    candidate.current = null; remoteCapture.current?.discardRemoteRecovery(); owned?.cancel(); setError(null); setNotice(null);
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
  const remoteControlsOccupied = confirmationPending || loading || !!busy || changingDevice || leaving || countdown !== null || captureState.scenes?.preparingScreen === true || captureState.phase === 'preparing' || captureState.phase === 'stopping';
  const occupied = remoteControlsOccupied || captureState.videoControls?.busy === true;
  const pendingFile = !!candidate.current || captureState.pendingRecovery === true || captureState.phase === 'error' && !!captureState.file;
  const recoveringRemote = isRemote && pendingFile && !candidate.current?.file && !captureState.file;
  const recoveryWorking = busy === 'save' || captureState.phase === 'stopping';
  const total = project?.takes.reduce((sum, item) => sum + studioTakeDuration(item), 0) ?? 0;
  const captureCTA = kind === 'podcast' ? 'Ativar microfone' : isRemote ? 'Conectar meu iPhone' : mode === 'screen' ? 'Compartilhar tela' : mode === 'scenes' ? 'Preparar câmera e tela' : 'Abrir câmera';
  const permissionCard = !captureState.stream && (!reviewing || isRemote && captureState.phase === 'preparing') && !pendingFile;
  const permissionError = permissionCard && !occupied && (error || captureState.error);
  const permissionDenied = !!permissionError && /permit|permiss|negou|acesso.*bloque/i.test(error ?? captureState.error ?? '');
  const ready = captureState.phase === 'ready';
  const remoteAudioReady = !isRemote || studioRemoteAudioReady(remoteState?.session?.deviceState);
  const remoteScreenRequired = isRemote && hasScenes && ready && !captureState.scenes?.screenReady;
  const iphoneNarration = isRemote && (!hasScenes || captureState.scenes?.narrationSource === 'iphone');
  const showRemoteMicrophone = iphoneNarration && !!remoteState?.session && !!captureState.stream;
  const canFocusRemote = isRemote && !hasScenes && ready && !!captureState.stream && !occupied && !pendingFile && remoteState?.connection === 'connected' && remoteState.session?.deviceState?.pro?.supportsFocusPoint === true;
  const focusRemote = (event: React.PointerEvent<HTMLVideoElement>) => {
    if (!canFocusRemote || event.button !== 0 || event.isPrimary === false) return;
    const element = event.currentTarget, rect = element.getBoundingClientRect();
    const point = remoteCameraFocusPoint({ clientX: event.clientX, clientY: event.clientY, rect, imageWidth: element.videoWidth, imageHeight: element.videoHeight, fit: kind === 'short' ? 'cover' : 'contain', mirrored: guides.mirrored });
    if (!point) return;
    void configureRemote({ pro: { focusPoint: { ...point, locked: false } } }).catch(() => undefined);
    setFocusTarget({ left: (event.clientX - rect.left) / rect.width * 100, top: (event.clientY - rect.top) / rect.height * 100 });
  };
  const displayTitle = project?.title ?? (title.trim() || defaultTitle(kind));
  const aspectLabel = kind === 'aula' ? '16:9' : kind === 'short' ? '9:16' : 'Áudio';
  const displayedZoom = isRemote && typeof remoteState?.session?.deviceState?.pro?.zoom === 'number' ? remoteState.session.deviceState.pro.zoom : captureState.videoControls?.zoom.value ?? 1;
  const director = useStudioSceneDirector({ scope: `${owner}:${epoch.current}`, state: captureState, blocked: stage !== 'production' || occupied || pendingFile || remoteScreenRequired || ready && !remoteAudioReady, onScene: selectScene, onStop: stop, onMicrophone: setSceneMicrophone, onStart: start });
  const openDirector = () => { const token = epoch.current; void director.open().catch(cause => report(cause, token)); };
  const liveVideo = kind !== 'podcast' && <video ref={video} className={`se-recording-live${canFocusRemote ? ' src-live-focusable' : ''}`} muted playsInline autoPlay aria-label="Prévia da gravação" title={canFocusRemote ? 'Clique na imagem para focar' : undefined} onPointerDown={focusRemote} style={{ display: captureState.stream ? 'block' : 'none', transform: !hasScenes && guides.mirrored ? 'scaleX(-1)' : undefined }} />;
  const preflightPreview = captureState.stream ? <>
    {liveVideo}
    {kind === 'podcast' && <div className="se-recording-audio-stage"><Mic size={36} strokeWidth={1.3} /><AudioMonitor state={captureState} /></div>}
    {isRemote && !hasScenes && focusTarget && <div className="src-focus-reticle" aria-hidden="true" style={{ left: `${focusTarget.left}%`, top: `${focusTarget.top}%` }} />}
    {guides.grid && kind !== 'podcast' && <div className="se-recording-grid" aria-hidden="true" />}
    {guides.scriptEnabled && <RecordingTeleprompter guides={guides} recording={false} active={ready && !occupied && !toolsOpen} microphoneEnabled={captureState.microphoneEnabled} inputKey={captureState.input?.id ?? ''} getMicrophoneTrack={getMicrophoneTrack} voiceUnavailableReason={iphoneNarration ? 'Para acompanhar a voz nesta página, selecione um microfone do computador. Com o áudio do iPhone, use a rolagem automática.' : undefined} onGuides={updateGuides} />}
    {countdown !== null && <div className="se-recording-countdown" role="status"><strong>{countdown}</strong><button className="se-recording-button" onClick={() => { countdownRef.current = null; setCountdown(null); }}>Cancelar contagem</button></div>}
  </> : previewRequested && isRemote && remoteState ? <StudioRemoteCameraPairing state={remoteState} onReconnect={reconnectRemote} onUnpair={() => void unlinkRemote()} disabled={!!busy || leaving || confirmationPending || changingDevice} /> : undefined;
  const preflightTools = toolsOpen && !recording && (isRemote && remoteState ? <StudioRemoteCameraControls initialTab={toolsTab} onTab={setToolsTab} state={remoteState} disabled={remoteControlsOccupied || pendingFile} onConfigure={configureRemote} onClose={closeTools} recording={{ state: captureState, guides, onGuides: updateGuides, onVideo: configureVideo }} /> : <StudioRecordingTools initialTab={toolsTab === 'camera' ? 'image' : toolsTab} state={captureState} camera={kind !== 'podcast' && mode !== 'screen'} disabled={occupied || pendingFile} guides={guides} onGuides={updateGuides} onVideo={configureVideo} onClose={closeTools} />);
  const preflightDevices = captureState.stream && <>
    <div className="se-recording-devices">
      {isRemote ? remoteState && <StudioRemoteCameraStatus state={remoteState} onReconnect={reconnectRemote} onUnpair={() => void unlinkRemote()} disabled={occupied || pendingFile} /> : kind !== 'podcast' && mode !== 'screen' ? <DeviceSelector label="Câmera" current={captureState.camera} devices={captureState.devices?.cameras ?? []} disabled={occupied || pendingFile} onChange={cameraId => selectDevice({ cameraId })} /> : null}
      {(!isRemote || hasScenes) && <div className="se-recording-microphone-control"><button className={`se-recording-mute${captureState.microphoneEnabled === false ? ' muted' : ''}`} aria-label={captureState.microphoneEnabled === false ? 'Ativar microfone da gravação' : 'Desativar microfone'} aria-pressed={captureState.microphoneEnabled === false} disabled={!ready || occupied || pendingFile || !captureState.input} onClick={toggleMicrophone}>{captureState.microphoneEnabled === false ? <MicOff size={18} /> : <Mic size={18} />}</button><DeviceSelector label="Microfone" current={captureState.input} devices={captureState.devices?.microphones ?? []} disabled={occupied || pendingFile} onChange={microphoneId => selectDevice({ microphoneId })} /></div>}
    </div>
    {kind !== 'podcast' && captureState.input && !showRemoteMicrophone && <AudioMonitor state={captureState} />}
    {showRemoteMicrophone && remoteState && <StudioRemoteMicrophoneMonitor state={remoteState} microphoneEnabled={captureState.microphoneEnabled} disabled={occupied || pendingFile || !ready || remoteState.session?.deviceState?.processing === true || remoteState.session?.deviceState?.uploading === true} onSelect={selectRemoteMicrophone} />}
    <div className="srs-adjustments">
      {kind !== 'podcast' && <StudioRecordingQuality state={captureState} disabled={occupied || pendingFile} onVideo={configureVideo} />}
      <button className="se-recording-button" aria-label="Configurações da gravação" aria-expanded={toolsOpen} disabled={occupied || pendingFile} onClick={() => setToolsOpen(value => !value)}><Settings2 size={16} />Ajustes</button>
      <button className="se-recording-button" aria-label="Roteiro e teleprompter" disabled={occupied || pendingFile} onClick={() => openTools('script')}><FileText size={16} />Roteiro</button>
    </div>
    {hasScenes && captureState.scenes && <StudioSceneControls state={captureState.scenes} disabled={occupied || pendingFile || !ready} recording={false} onScene={selectScene} onPrepareScreen={prepareScreen} onConfigure={configureScene} />}
  </>;
  const setupWorking = captureState.phase === 'preparing' || changingDevice || captureState.scenes?.preparingScreen === true;
  const setupCTA = remoteScreenRequired ? 'Compartilhar tela' : ready ? 'Ir para gravação' : setupWorking ? isRemote ? 'Conectando iPhone…' : 'Preparando prévia…' : mode === 'camera' && kind !== 'podcast' ? 'Ativar câmera' : captureCTA;
  const setupContext = remoteScreenRequired ? 'Seu iPhone está pronto. Compartilhe a tela para completar a cena.' : ready && !remoteAudioReady ? 'Confirme o microfone do iPhone para gravar.' : setupWorking ? changingDevice ? 'Ajustando o enquadramento…' : mode === 'screen' ? 'Escolha uma tela ou aba no navegador.' : isRemote ? 'Abra a câmera remota no app Classfy.' : 'Autorize o acesso para conferir a prévia.' : undefined;

  return <div ref={workspace} className={`se-recording${recording ? ' is-recording' : ''}${hasScenes ? ' has-scenes' : ''}`} data-stage={stage} onKeyDown={event => {
    if (!hasScenes || event.altKey || event.ctrlKey || event.metaKey || event.repeat || (event.target as HTMLElement).closest('input,select,textarea,[contenteditable="true"],[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
    const target = (['camera', 'screen', 'screen-camera'] as const)[Number(event.key) - 1];
    if (target) { event.preventDefault(); selectScene(target); }
  }}>
    {stage === 'setup' && <header className="se-recording-header"><div className="se-recording-brand"><button className="se-recording-icon" aria-label="Voltar aos projetos" disabled={leaving || confirmationPending} onClick={() => void leave()}><ArrowLeft size={20} /></button><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" /><span>Studio</span><i /><strong>Gravar</strong></div><span className="se-recording-header-note"><ShieldCheck size={15} />Seu espaço privado</span></header>}
    {stage === 'setup' ? <StudioRecordingSetup kind={kind} liveSelected={liveSelected} mode={mode} remoteScenes={remoteScenes} title={title}
      formatLocked={loading || !!project} disabled={occupied || pendingFile} openDisabled={!!error && !!projectId && !project} canUseScenes={canUseScenes} premiumLoading={premiumLoading}
      cta={liveSelected ? 'Preparar live' : setupCTA} onFormat={next => void chooseSetupFormat(next)} onLayout={chooseSetupLayout} onCameraSource={chooseSetupCamera}
      onTitle={setTitle} onOpen={liveSelected ? () => navigate('/studio/live', { state: { studioRecordingTitle: title.trim().slice(0, 150) } }) : remoteScreenRequired ? prepareScreen : ready ? enterProduction : openCapture}
      preview={!liveSelected ? preflightPreview : undefined} devices={!liveSelected ? preflightDevices : undefined} tools={preflightTools} context={setupContext}
      ready={ready && !!captureState.stream && remoteAudioReady && !remoteScreenRequired} preparing={setupWorking} onCancelPreparation={cancelPreparation}
      recovery={!liveSelected ? <StudioRemoteSceneRecoveryList owner={owner} onRecoveredFile={saveRecoveredRemote} /> : undefined} error={error ?? (!preflightPreview ? captureState.error : null)} /> : <main className="se-recording-production">
      <div className={`se-recording-stage-shell${reviewing ? ' is-reviewing' : ''}`} data-testid="recording-stage">
        <div className={`se-recording-stage ${kind}`}>
          {liveVideo}
          {isRemote && !hasScenes && !recording && captureState.stream && focusTarget && <div className="src-focus-reticle" aria-hidden="true" style={{ left: `${focusTarget.left}%`, top: `${focusTarget.top}%` }} />}
          {guides.grid && captureState.stream && !recording && kind !== 'podcast' && <div className="se-recording-grid" aria-hidden="true" />}
          {captureState.stream && guides.scriptEnabled && <RecordingTeleprompter guides={guides} recording={recording} active={(ready || recording) && !changingDevice && !leaving && !busy && countdown === null && !toolsOpen && !captureState.videoControls?.busy} microphoneEnabled={captureState.microphoneEnabled} inputKey={captureState.input?.id ?? ''} getMicrophoneTrack={getMicrophoneTrack} voiceUnavailableReason={iphoneNarration ? 'Para acompanhar a voz nesta página, selecione um microfone do computador. Com o áudio do iPhone, use a rolagem automática.' : undefined} onGuides={updateGuides} />}
          {reviewing && kind !== 'podcast' && <StudioTakePlayer key={take?.id} ref={reviewPlayer} src={reviewURL!} kind="video" durationSeconds={take?.duration ?? 0} label="Reproduzir take salvo" disabled={occupied || pendingFile} fullscreen={fullscreen} onFullscreen={fullscreenAvailable ? toggleFullscreen : undefined} />}
          {kind === 'podcast' && (captureState.stream || reviewing) && <div className="se-recording-audio-stage"><div className={`se-recording-audio-artwork${recording ? ' recording' : ''}`}><Mic size={48} strokeWidth={1.3} /></div><span className="se-recording-audio-eyebrow">{recording ? 'GRAVANDO PODCAST' : reviewing ? 'ORIGINAL SALVO' : 'PRONTO PARA GRAVAR'}</span><h2>{recording ? 'Sua voz, em foco.' : reviewing ? `Take ${(project?.takes.findIndex(item => item.id === take?.id) ?? -1) + 1}` : 'Sua próxima ideia começa aqui.'}</h2>{reviewing && <StudioTakePlayer key={take?.id} ref={reviewPlayer} src={reviewURL!} kind="audio" durationSeconds={take?.duration ?? 0} label="Reproduzir take salvo" disabled={occupied || pendingFile} />}</div>}
        </div>
        {!recording && <header className="se-recording-stage-header"><div className="se-recording-stage-brand"><button className="se-recording-icon" aria-label="Voltar aos projetos" disabled={leaving || confirmationPending} onClick={() => void leave()}><ArrowLeft size={19} /></button><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" /><div><h1>{displayTitle}</h1><p>{isRemote ? remoteScenes ? 'iPhone com cenas · Premium' : 'iPhone · Câmera remota Premium' : mode === 'scenes' ? 'Produção com cenas · Premium' : kindName(kind)} · {aspectLabel}{project?.takes.length ? ` · ${formatStudioDuration(total)} salvos` : ''}</p></div></div><div className="se-recording-stage-actions">{kind !== 'podcast' && !reviewing && <StudioRecordingQuality state={captureState} disabled={occupied || pendingFile} onVideo={configureVideo} />}<span className="se-recording-save-state">{busy === 'save' ? <><Loader2 size={13} className="se-spin" />Salvando take…</> : project?.takes.length ? <><Check size={13} />Takes salvos</> : <><ShieldCheck size={13} />Privado</>}</span>{fullscreenAvailable && <button className="se-recording-icon" title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}<button className="se-recording-icon" title="Configurações da gravação" aria-label="Configurações da gravação" aria-expanded={toolsOpen} disabled={occupied || pendingFile} onClick={() => setToolsOpen(value => !value)}><Settings2 size={18} /></button></div></header>}
        {!recording && countdown === null && captureState.stream && <div className="se-recording-quick-tools" aria-label="Ferramentas da câmera">
          {kind !== 'podcast' && mode !== 'screen' && <><button aria-label="Ajustar zoom" title="Zoom" disabled={occupied || pendingFile} onClick={() => openTools(isRemote ? 'camera' : 'image')}><ZoomIn size={18} /><span>{displayedZoom.toFixed(1)}×</span></button><button aria-label="Filtros e imagem" title="Filtros e imagem" disabled={occupied || pendingFile} onClick={() => openTools('image')}><Palette size={18} /></button>{isRemote && <button aria-label="Controles Pro do iPhone" title="Câmera Pro" disabled={occupied || pendingFile} onClick={() => openTools('camera')}><Settings2 size={18} /></button>}</>}
          <button aria-label="Temporizador da gravação" title="Temporizador" disabled={occupied || pendingFile} onClick={() => openTools('record')}><Timer size={18} />{guides.delay > 0 && <span>{guides.delay}s</span>}</button><button aria-label="Roteiro e teleprompter" title="Roteiro" disabled={occupied || pendingFile} onClick={() => openTools('script')}><FileText size={18} /></button>
        </div>}
        {toolsOpen && !recording && (isRemote && remoteState ? <StudioRemoteCameraControls initialTab={toolsTab} onTab={setToolsTab} state={remoteState} disabled={remoteControlsOccupied || pendingFile} onConfigure={configureRemote} onClose={closeTools} recording={{ state: captureState, guides, onGuides: updateGuides, onVideo: configureVideo }} /> : <StudioRecordingTools initialTab={toolsTab === 'camera' ? 'image' : toolsTab} state={captureState} camera={kind !== 'podcast' && mode !== 'screen'} disabled={occupied || pendingFile} guides={guides} onGuides={updateGuides} onVideo={configureVideo} onClose={closeTools} />)}
        {countdown !== null && <div className="se-recording-countdown" role="status"><strong>{countdown}</strong><button className="se-recording-button" onClick={() => { countdownRef.current = null; setCountdown(null); }}>Cancelar contagem</button></div>}
        {isRemote && remoteState && permissionCard && <StudioRemoteCameraPairing state={remoteState} onReconnect={reconnectRemote} onCancel={cancelRemoteConnection} onUnpair={() => void unlinkRemote()} disabled={!!busy || leaving || confirmationPending || changingDevice} />}
        {permissionCard && !isRemote && <div className="se-recording-permission" data-permission-state={occupied ? 'preparing' : permissionError ? 'error' : 'closed'}>
          <div className={`se-recording-permission-icon${permissionError ? ' error' : ''}`}>{occupied ? <Loader2 size={30} className="se-spin" /> : kind === 'podcast' ? <Mic size={31} strokeWidth={1.4} /> : mode === 'screen' ? <Monitor size={31} strokeWidth={1.4} /> : <Camera size={31} strokeWidth={1.4} />}</div>
          <h2>{busy === 'save' ? 'Salvando seu take.' : captureState.phase === 'stopping' ? 'Preparando seu take.' : captureState.phase === 'preparing' ? kind === 'podcast' ? 'Vamos abrir seu microfone.' : mode === 'screen' ? 'Escolha o que quer compartilhar.' : 'Vamos abrir sua câmera.' : permissionError ? 'Não conseguimos abrir a entrada.' : 'Seu palco está pronto.'}</h2>
          <p>{busy === 'save' ? 'Estamos preservando o original neste navegador.' : captureState.phase === 'preparing' ? mode === 'screen' && kind !== 'podcast' ? 'Use a janela do navegador para escolher uma tela ou aba. Depois, permita o microfone.' : kind === 'podcast' ? 'Quando o navegador pedir, permita o microfone. Você poderá conferir o áudio antes de gravar.' : 'Quando o navegador pedir, permita câmera e microfone. O preview aparece aqui, sem iniciar a gravação.' : permissionError ? permissionDenied ? 'Confira as permissões deste site no ícone ao lado do endereço do navegador e abra a captura.' : 'Confira a conexão do dispositivo e se outro aplicativo está usando esta entrada.' : 'Abra a captura para conferir o enquadramento e o áudio antes de gravar.'}</p>
          {permissionError && <p className="se-recording-permission-error" role="alert">{error ?? captureState.error}</p>}
          {!occupied && <button className="se-recording-button primary" onClick={openCapture}>{permissionError ? captureCTA : project?.takes.length ? 'Gravar outro take' : captureCTA}<ArrowRight size={16} /></button>}
          {!permissionError && !busy && <small><ShieldCheck size={13} />Só você vê esta captura.</small>}
        </div>}
        {!recording && pendingFile && <div className="se-recording-recovery" aria-busy={recoveryWorking}><div className="se-recording-permission-icon">{recoveryWorking ? <Loader2 size={29} className="se-spin" /> : <Film size={29} />}</div><h2>{busy === 'save' ? 'Salvando seu take.' : recoveryWorking && recoveringRemote ? 'Recebendo seu original.' : recoveryWorking ? 'Preparando seu take.' : 'Seu take ainda está com você.'}</h2><p>{busy === 'save' ? 'Aguarde a confirmação antes de continuar.' : recoveringRemote ? 'Mantenha esta página e o app no iPhone abertos. O original será recebido e salvo no projeto.' : captureState.pendingRecovery && !captureState.file ? 'Mantenha esta página aberta e salve o trecho capturado para continuar.' : 'Salve o take ou baixe o original para guardar uma cópia.'}</p><div className={`se-recording-feedback${recoveryWorking ? '' : ' error'}`} role={recoveryWorking ? 'status' : 'alert'}><span>{recoveryWorking ? busy === 'save' ? 'Preservando o original neste navegador…' : recoveringRemote && remoteState ? studioRemoteTransferLabel(remoteState) : 'Finalizando o trecho capturado…' : error ?? captureState.error ?? 'Este trecho ainda não foi salvo.'}</span><div><button disabled={occupied} onClick={retry}>{recoveryWorking && <Loader2 size={14} className="se-spin" />}{recoveringRemote ? recoveryWorking ? 'Transferindo original…' : 'Retomar transferência' : busy === 'save' ? 'Salvando take…' : 'Salvar take'}</button>{(candidate.current?.file || captureState.file) && <button onClick={downloadOriginal}>Baixar original</button>}<button disabled={occupied} onClick={discard}>Descartar trecho</button></div></div></div>}
        {!recording && !permissionError && !pendingFile && (error || captureState.error || notice) && <div className={`se-recording-feedback se-recording-stage-feedback ${error || captureState.phase === 'error' ? 'error' : ''}`} role={error || captureState.phase === 'error' ? 'alert' : 'status'}><span>{error ?? captureState.error ?? notice}</span></div>}
        {recording && <span className="se-recording-timer" role="timer"><i />{formatStudioEditorTime(captureState.elapsed)}</span>}
        {captureState.input && !showRemoteMicrophone && <AudioMonitor state={captureState} />}
        {showRemoteMicrophone && remoteState && <StudioRemoteMicrophoneMonitor state={remoteState} microphoneEnabled={captureState.microphoneEnabled} disabled={occupied || pendingFile || !ready || remoteState.session?.deviceState?.processing === true || remoteState.session?.deviceState?.uploading === true} onSelect={selectRemoteMicrophone} />}
        {isRemote && remoteState?.session && captureState.stream && (!recording || remoteState.connection !== 'connected' || remoteState.transfer !== 'idle') && <StudioRemoteCameraStatus state={remoteState} onReconnect={reconnectRemote} onUnpair={!recording ? () => void unlinkRemote() : undefined} disabled={occupied || pendingFile} audioMonitorVisible={!!captureState.input || showRemoteMicrophone} />}
        {reviewing && !recording && <span className="se-recording-review-badge"><Play size={12} />Revisando take {(project?.takes.findIndex(item => item.id === take?.id) ?? -1) + 1}</span>}
      </div>
      {hasScenes && captureState.scenes && captureState.stream && <StudioSceneControls state={captureState.scenes} disabled={occupied || pendingFile || !['ready', 'recording'].includes(captureState.phase)} recording={recording} onScene={selectScene} onPrepareScreen={prepareScreen} onConfigure={configureScene} director={{ supported: director.supported, isOpen: director.isOpen, onOpen: openDirector, error: director.error }} />}
      {!recording && !!project?.takes.length && <section className={`se-recording-takes${takesExpanded ? '' : ' collapsed'}`} aria-label="Takes salvos"><button className="se-recording-takes-toggle" aria-label={takesExpanded ? 'Recolher takes salvos' : 'Mostrar takes salvos'} aria-expanded={takesExpanded} aria-controls="se-recording-saved-takes" onClick={() => setTakesExpanded(value => !value)}><Film size={16} /><span>Seus takes<strong>{project.takes.length}</strong></span>{takesExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}</button><div className="se-recording-takes-strip" id="se-recording-saved-takes" hidden={!takesExpanded}>{project.takes.map((item, index) => <article key={item.id} className={item.id === selectedTake ? 'selected' : ''}><button className="se-recording-take" aria-label={`Revisar take ${index + 1}`} aria-pressed={item.id === selectedTake} disabled={occupied || pendingFile} onClick={() => { capture.current?.cancel(); setSelectedTake(item.id); }}><TakeThumbnail owner={owner} project={project} take={item} /><span><strong>Take {index + 1}</strong><small>{formatStudioDuration(studioTakeDuration(item))}</small></span></button><button className="se-recording-take-remove" aria-label={`Excluir take ${index + 1}`} disabled={occupied || pendingFile} onClick={() => void remove(item.id, index + 1)}><X size={13} /></button></article>)}</div></section>}
      <div className="se-recording-controls" data-testid="recording-toolbar" aria-label={recording ? 'Gravação em andamento' : 'Controles de gravação'}>
        {recording ? <div className="se-recording-record-control"><button className="se-recording-rec stop" aria-label="Encerrar gravação" disabled={confirmationPending} onClick={stop}><Square fill="currentColor" size={22} /></button><span>Encerrar gravação</span></div> : <>
          <div className="se-recording-devices">
            {isRemote ? <div className="se-recording-screen-label"><Smartphone size={17} /><span>{captureState.camera?.name ?? 'Meu iPhone'}<small>{hasScenes ? iphoneNarration ? 'Imagem e áudio no iPhone' : 'Imagem do iPhone · áudio no computador' : 'Câmera e áudio no aparelho'}</small></span></div> : kind !== 'podcast' && mode !== 'screen' ? <DeviceSelector label="Câmera" current={captureState.camera} devices={captureState.devices?.cameras ?? []} disabled={occupied || pendingFile} onChange={cameraId => selectDevice({ cameraId })} /> : kind !== 'podcast' ? <div className="se-recording-screen-label"><Monitor size={17} /><span>Tela compartilhada<small>{captureState.stream ? 'Captura ativa' : 'Selecione uma tela ao abrir'}</small></span></div> : null}
            {(!isRemote || hasScenes) && <div className="se-recording-microphone-control"><button className={`se-recording-mute${captureState.microphoneEnabled === false ? ' muted' : ''}`} aria-label={captureState.microphoneEnabled === false ? 'Ativar microfone da gravação' : 'Desativar microfone'} aria-pressed={captureState.microphoneEnabled === false} title={captureState.microphoneEnabled === false ? 'Ativar microfone' : 'Desativar microfone'} disabled={!ready || occupied || pendingFile || !captureState.input} onClick={toggleMicrophone}>{captureState.microphoneEnabled === false ? <MicOff size={19} /> : <Mic size={19} />}</button><DeviceSelector label="Microfone" current={captureState.input} devices={captureState.devices?.microphones ?? []} disabled={occupied || pendingFile} onChange={microphoneId => selectDevice({ microphoneId })} /></div>}
          </div>
          <div className="se-recording-record-control">{ready ? <><button className="se-recording-rec" aria-label="Iniciar gravação" disabled={occupied || pendingFile || !remoteAudioReady} onClick={start}><i /></button><span>{remoteAudioReady ? 'Gravar take' : 'Confirme o microfone do iPhone'}</span></> : occupied ? <span className="se-recording-working" role="status"><Loader2 size={18} className="se-spin" />{countdown !== null ? 'Preparando REC…' : changingDevice ? 'Ajustando entrada…' : busy === 'save' ? 'Salvando original…' : busy === 'remove' ? 'Removendo take…' : captureState.phase === 'stopping' ? isRemote ? 'Recebendo original do iPhone…' : 'Preparando o take…' : isRemote ? 'Aguardando meu iPhone…' : 'Aguardando permissão…'}</span> : !pendingFile && !permissionCard && <button className="se-recording-button" disabled={occupied || pendingFile} onClick={openCapture}><span className="se-recording-small-dot" />{project?.takes.length ? 'Gravar outro take' : captureCTA}</button>}</div>
          <div className="se-recording-next"><span>{project?.takes.length ? `${project.takes.length} ${project.takes.length === 1 ? 'take salvo' : 'takes salvos'} · ${formatStudioDuration(total)}` : 'Grave seu primeiro take'}</span><button className="se-recording-button primary" disabled={!project?.takes.length || occupied || pendingFile} onClick={() => void leave(true)}>Ir para edição<ArrowRight size={17} /></button></div>
        </>}
      </div>
    </main>}
    {dialog}
    {director.portal}
  </div>;
}
