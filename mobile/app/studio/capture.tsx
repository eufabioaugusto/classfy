import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useIsFocused, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { Camera, Check, ChevronRight, FileText, Mic, Minus, Palette, Pause, Play, Plus, SlidersHorizontal, Square, SwitchCamera, Timer, X, Zap, ZapOff } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, AppState, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { useAuth } from '@/features/auth/authContext';
import { importStudioMedia, persistStudioTake } from '@/features/studio/media';
import { formatStudioDuration, normalizeStudioCaptureGrade, studioEditing, studioGrade, withStudioStandardOutput, type StudioEffect, type StudioGrade, type StudioProject } from '@/features/studio/model';
import { studioEffectiveOutput, studioOutputSupported, studioOutputWarnings, withStudioOutputSelection } from '@/features/studio/model';
import { getStudioExportCapabilitiesAsync } from '../../modules/classfy-studio-media';
import { discardTransientStudioProject, getStudioProject, mutateStudioProject } from '@/features/studio/store';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { studioNormalizedZoom, useStudioCaptureCamera } from '@/features/studio/StudioCaptureCamera';
import { StudioCaptureFrame, StudioCaptureZoom } from '@/features/studio/StudioCaptureZoom';
import { StudioCaptureTakes } from '@/features/studio/StudioCaptureTakes';
import { StudioCaptureScriptPanel } from '@/features/studio/StudioCaptureScriptPanel';
import { createStudioVideoStopOperation } from '@/features/studio/StudioCaptureRecording';
import { StudioNativeCamera, StudioNativeRecordingError, isStudioNativeCameraHandle, type StudioCaptureCameraHandle, type StudioCaptureRecording, type StudioNativeCameraHandle } from '@/features/studio/StudioNativeCamera';
import { isStudioNativeCameraAvailable, isStudioNativeCameraEffectsAvailable } from '../../modules/classfy-studio-media';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';

type Phase = 'idle' | 'countdown' | 'recording' | 'saving';
type CaptureMetadata = Pick<Parameters<typeof persistStudioTake>[1], 'sourceKind' | 'sourceStage' | 'frameRate' | 'colorSpace' | 'grade'>;
type RecoverableTake = { project: StudioProject; uri: string; duration: number; metadata?: CaptureMetadata };
type CapturePanel = 'timer' | 'script' | 'quality' | 'treatment';
const capturePresets: { id: StudioEffect; label: string }[] = [{ id: 'natural', label: 'Natural' }, { id: 'studio', label: 'Studio' }, { id: 'cinematic', label: 'Cinematic' }];

export default function StudioCaptureScreen() {
  const params = useLocalSearchParams<{ id: string; from?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id || '';
  const { project, loading, error } = useStudioProject(id);
  const { user } = useAuth();
  const { canPublish, roleLoading } = usePrimaryAction();
  const navigation = useNavigation();
  const router = useRouter();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const dimensions = useWindowDimensions();
  const landscape = dimensions.width > dimensions.height;
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();
  const [phase, setPhase] = useState<Phase>('idle');
  const [countdown, setCountdown] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState<CameraType>('front');
  const [torch, setTorch] = useState(false);
  const [ready, setReady] = useState(false);
  const [sensorOrientation, setSensorOrientation] = useState<string | null>(null);
  const [zoom, setZoom] = useState(0);
  const [videoQuality, setVideoQuality] = useState<'1080p' | '720p'>('1080p');
  const [captureGrade, setCaptureGrade] = useState<StudioGrade>(() => studioGrade());
  const [effectBusy, setEffectBusy] = useState(false);
  const [effectSupported, setEffectSupported] = useState(false);
  const [effectError, setEffectError] = useState<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(3);
  const [panel, setPanel] = useState<CapturePanel | null>(null);
  const [importing, setImporting] = useState(false);
  const [cancelingAudio, setCancelingAudio] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [showScript, setShowScript] = useState(true);
  const [followScript, setFollowScript] = useState(true);
  const [scriptSpeed, setScriptSpeed] = useState(28);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoverableTake | null>(null);
  const camera = useRef<StudioCaptureCameraHandle>(null);
  const captureGradeRef = useRef(captureGrade); captureGradeRef.current = captureGrade;
  const effectBusyRef = useRef(false), effectSequence = useRef(0);
  const captureContext = useRef({ id, focused, foreground, recovery }); captureContext.current = { id, focused, foreground, recovery };
  const audio = useRef<Audio.Recording | null>(null);
  const videoOperation = useRef<ReturnType<typeof createStudioVideoStopOperation> | null>(null);
  const scriptScroll = useRef<ScrollView>(null);
  const scriptOffset = useRef(0);
  const scriptSize = useRef({ content: 0, viewport: 0 });
  const startedAt = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const mounted = useRef(true);
  const countdownToken = useRef(0);
  const pendingNavigation = useRef<NavigationAction | null>(null);
  const handedOff = useRef(false);
  const finishAfterImport = useRef(false);
  const session = useRef({ owner: user?.id, canPublish, roleLoading });
  session.current = { owner: user?.id, canPublish, roleLoading };
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const activeProject = useRef<StudioProject | null>(null);
  const audioStopping = useRef(false);
  const audioPreparation = useRef<number | null>(null);
  const isAudio = project?.kind === 'podcast';
  const permitted = !!project && project.ownerId === user?.id && canPublish && !roleLoading;
  const { orientationReady, orientationError } = useStudioOrientation(project?.kind, permitted);
  const busyProject = !!project && ['preparing', 'uploading', 'processing', 'submitted'].includes(project.state);
  const microphoneGranted = !!microphonePermission?.granted;
  const permissionGranted = microphoneGranted && (isAudio || !!cameraPermission?.granted);
  const permissionBlocked = !!microphonePermission && !microphonePermission.granted && !microphonePermission.canAskAgain
    || !isAudio && !!cameraPermission && !cameraPermission.granted && !cameraPermission.canAskAgain;
  const sensorLandscape = sensorOrientation?.startsWith('landscape');
  const sensorMatches = isAudio || sensorOrientation === null || (project?.kind === 'aula' ? sensorLandscape : !sensorLandscape);
  const screenMatches = isAudio || (project?.kind === 'aula' ? landscape : !landscape);
  const cameraMounted = !isAudio && Device.isDevice && permitted && !busyProject && permissionGranted
    && focused && foreground && orientationReady && screenMatches;
  const nativeCamera = Platform.OS === 'ios' && isStudioNativeCameraAvailable();
  const nativeEffects = !isAudio && nativeCamera && isStudioNativeCameraEffectsAvailable();
  const cameraControls = useStudioCaptureCamera(camera, facing, cameraMounted, { native: nativeCamera, orientation: project?.kind === 'aula' ? 'landscape' : 'portrait' });
  const captureReadiness = useRef({ sensorMatches, screenMatches, ready, orientationReady });
  captureReadiness.current = { sensorMatches, screenMatches, ready, orientationReady };

  function finishCapture() {
    const context = captureContext.current, account = session.current;
    if (phaseRef.current !== 'idle' || context.recovery || !context.focused || !context.foreground || context.id !== id
      || !account.owner || !account.canPublish || account.roleLoading || account.owner !== project?.ownerId) return;
    const latest = getStudioProject(account.owner, id);
    if (!latest) return;
    if (latest.pendingTakes?.length) { setFailure('Recupere os takes pendentes antes de avançar.'); return; }
    handedOff.current = true;
    if (params.from === 'projects') router.replace({ pathname: '/studio/[id]', params: { id } });
    else if (router.canGoBack()) router.back();
    else router.replace({ pathname: '/studio/[id]', params: { id } });
  }
  function closeCapture() {
    if (router.canGoBack()) router.back();
    else router.replace('/studio');
  }
  useEffect(() => {
    if (!project) return;
    const ownerId = project.ownerId; const projectId = project.id;
    return () => { if (!handedOff.current) void discardTransientStudioProject(ownerId, projectId).catch(() => undefined); };
  }, [project?.ownerId, project?.id]);
  useEffect(() => {
    const state = cameraControls.state;
    if (state) setZoom(studioNormalizedZoom(state.zoom, state));
  }, [cameraControls.state?.zoom, cameraControls.state?.minZoom, cameraControls.state?.maxZoom,
    cameraControls.state?.deviceId, cameraControls.state?.quality, cameraControls.state?.fps, cameraControls.state?.generation,
    cameraControls.error, cameraControls.zoomConfirmation]);
  useEffect(() => {
    if (nativeCamera && cameraControls.state) setTorch(cameraControls.state.torchEnabled);
  }, [nativeCamera, cameraControls.state?.torchEnabled]);
  useEffect(() => {
    if (!nativeCamera || !cameraMounted) return;
    const listener = ScreenOrientation.addOrientationChangeListener(() => {
      if (phaseRef.current === 'idle' && cameraControls.isReady()) void cameraControls.prepareRecording();
    });
    return () => ScreenOrientation.removeOrientationChangeListener(listener);
  }, [nativeCamera, cameraMounted, facing]);
  function changeZoom(value: number) {
    if (phaseRef.current !== 'idle' || cameraControls.isBusy()) return;
    const next = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    setZoom(next);
    if (cameraControls.available) cameraControls.setZoom(next);
  }

  function transition(next: Phase) {
    phaseRef.current = next;
    if (mounted.current) setPhase(next);
  }
  function assertSession(target: StudioProject) {
    const current = session.current;
    if (current.owner !== target.ownerId || !current.canPublish || current.roleLoading) {
      throw new Error('Sua sessão mudou. Abra o Studio na conta que iniciou esta gravação.');
    }
  }
  function captureScopeCurrent(target: StudioProject) {
    const context = captureContext.current, account = session.current;
    return mounted.current && context.id === target.id && context.focused && context.foreground
      && account.owner === target.ownerId && account.canPublish && !account.roleLoading;
  }
  function assertCaptureSession(target: StudioProject) {
    assertSession(target);
    if (!captureScopeCurrent(target)) throw new Error('A captura mudou. Abra novamente a câmera deste projeto.');
  }
  async function confirmCaptureGrade(next: StudioGrade): Promise<boolean> {
    const ownedCamera = camera.current;
    if (!nativeEffects || !isStudioNativeCameraHandle(ownedCamera)) {
      effectSequence.current++; effectBusyRef.current = false;
      const natural = !normalizeStudioCaptureGrade(next);
      if (mounted.current) { setEffectBusy(false); setEffectSupported(false); setEffectError(natural ? null : 'Abra a câmera nativa para confirmar o tratamento.'); }
      return natural;
    }
    const sequence = ++effectSequence.current;
    effectBusyRef.current = true;
    if (mounted.current) { setEffectBusy(true); setEffectError(null); }
    try {
      const ack = await ownedCamera.setEffectAsync(next);
      if (!mounted.current || sequence !== effectSequence.current || camera.current !== ownedCamera) return false;
      setEffectSupported(ack.previewProcessed);
      return true;
    } catch (cause) {
      if (mounted.current && sequence === effectSequence.current && camera.current === ownedCamera) {
        setEffectSupported(false);
        setEffectError(cause instanceof Error ? cause.message : 'Não foi possível visualizar este tratamento. Use Natural ou tente novamente.');
      }
      return false;
    } finally {
      if (sequence === effectSequence.current) {
        effectBusyRef.current = false;
        if (mounted.current) setEffectBusy(false);
      }
    }
  }
  async function chooseCaptureGrade(next: StudioGrade) {
    if (!project || phaseRef.current !== 'idle' || recovery || !permitted || !nativeEffects || cameraControls.isBusy()) return;
    const target = project;
    try {
      assertSession(target);
      const latest = getStudioProject(target.ownerId, target.id);
      if (!latest) return;
      if (normalizeStudioCaptureGrade(next) && studioEditing(latest).output.profile === 'legacy-source') {
        if (effectBusyRef.current) return;
        effectBusyRef.current = true; setEffectBusy(true);
        const nextEditing = withStudioStandardOutput(studioEditing(latest));
        const capabilities = await getStudioExportCapabilitiesAsync();
        assertSession(target);
        const needsUpdate = !studioOutputSupported(studioEffectiveOutput(nextEditing), capabilities);
        const warnings = studioOutputWarnings(nextEditing).filter(warning => warning.code === 'sdr-conversion');
        const accepted = !needsUpdate && !warnings.length || await new Promise<boolean>(resolve => Alert.alert('Usar tratamento nesta montagem?',
          needsUpdate ? 'Para manter a qualidade original com tratamento, instale o motor atualizado do Classfy Dev. Você também pode escolher HD e 30 FPS para esta montagem. Seu vídeo original será preservado.' : warnings.map(warning => warning.message).join('\n\n'),
          [{ text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) }, { text: needsUpdate ? 'Escolher HD · 30 FPS' : 'Usar tratamento', onPress: () => resolve(true) }],
          { cancelable: true, onDismiss: () => resolve(false) }));
        assertSession(target);
        if (!accepted || !mounted.current || !captureContext.current.focused || captureContext.current.id !== target.id || phaseRef.current !== 'idle') {
          effectBusyRef.current = false; if (mounted.current) setEffectBusy(false); return;
        }
        const confirmed = needsUpdate ? withStudioOutputSelection(studioEditing(latest), { resolution: 'hd', frameRate: 30 }) : nextEditing;
        const confirmedWarnings = studioOutputWarnings(confirmed);
        await mutateStudioProject(target.ownerId, target.id, current => {
          assertSession(target);
          if (!mounted.current || !captureContext.current.focused || captureContext.current.id !== target.id || phaseRef.current !== 'idle') throw new Error('Volte à câmera para confirmar o tratamento.');
          const resolved = needsUpdate ? withStudioOutputSelection(studioEditing(current), { resolution: 'hd', frameRate: 30 }) : withStudioStandardOutput(studioEditing(current));
          if (!studioOutputSupported(studioEffectiveOutput(resolved), capabilities) || JSON.stringify(resolved.output) !== JSON.stringify(confirmed.output)
            || JSON.stringify(studioOutputWarnings(resolved)) !== JSON.stringify(confirmedWarnings)) throw new Error('A qualidade dos originais mudou. Confirme novamente o tratamento.');
          return { editing: resolved };
        });
        assertSession(target);
        effectBusyRef.current = false; if (mounted.current) setEffectBusy(false);
      }
      if (!mounted.current || !captureContext.current.focused || captureContext.current.id !== target.id || phaseRef.current !== 'idle') return;
      captureGradeRef.current = { ...next }; setCaptureGrade({ ...next });
      await confirmCaptureGrade(next);
    } catch (cause) {
      if (mounted.current) setEffectError(cause instanceof Error ? cause.message : 'Não foi possível preparar o tratamento.');
      effectBusyRef.current = false; if (mounted.current) setEffectBusy(false);
    }
  }
  useEffect(() => {
    effectSequence.current++; effectBusyRef.current = false;
    const natural = studioGrade(); captureGradeRef.current = natural;
    setCaptureGrade(natural); setEffectBusy(false); setEffectSupported(false); setEffectError(null);
  }, [project?.id, user?.id]);
  useEffect(() => {
    if (!cameraMounted || !ready || !nativeEffects || phaseRef.current !== 'idle') return;
    void confirmCaptureGrade(captureGradeRef.current);
  }, [cameraMounted, ready, nativeEffects, cameraControls.state?.generation]);
  async function saveTake(target: StudioProject, uri: string, duration: number, metadata?: CaptureMetadata) {
    transition('saving');
    const recoverable = { project: target, uri, duration, metadata };
    try {
      assertSession(target);
      const latest = getStudioProject(target.ownerId, target.id);
      if (!latest) throw new Error('Não foi possível encontrar o projeto desta gravação.');
      const take = await persistStudioTake(latest, { uri, name: `Take ${latest.takes.length + 1}`, duration, ...metadata });
      assertSession(target);
      const current = getStudioProject(target.ownerId, target.id);
      if (!current) throw new Error('O projeto desta gravação não está disponível.');
      const saved = await mutateStudioProject(target.ownerId, target.id, current => {
        assertSession(target);
        return {
          takes: current.takes.some(existing => existing.id === take.id) ? current.takes : [...current.takes, take],
          ...(!current.coverUri && !current.coverUrl && take.thumbnailUri ? { coverUri: take.thumbnailUri } : {}),
        };
      });
      if (mounted.current) {
        captureContext.current.recovery = null;
        setRecovery(null); setFailure(null);
        setNotice(`Take ${saved.takes.findIndex(existing => existing.id === take.id) + 1} salvo. Pronto para o próximo.`);
      }
    } catch (cause) {
      pendingNavigation.current = null;
      if (mounted.current) {
        captureContext.current.recovery = recoverable;
        setRecovery(recoverable);
        setFailure(cause instanceof Error ? cause.message : 'Não foi possível salvar o take. Tente novamente.');
      }
    } finally { activeProject.current = null; transition('idle'); }
  }

  async function stopRecording() {
    if (phaseRef.current === 'countdown') {
      countdownToken.current++;
      if (audioPreparation.current !== null) {
        // Keep navigation and new capture locked until the old recorder has
        // finished preparing/unloading. Its cleanup must not stop a new take.
        if (mounted.current) { setCancelingAudio(true); setNotice('Cancelando a preparação do microfone…'); }
      } else { activeProject.current = null; transition('idle'); }
      return;
    }
    if (phaseRef.current !== 'recording') return;
    if (activeProject.current?.kind !== 'podcast') {
      const operation = videoOperation.current;
      if (!operation) return;
      transition('saving');
      const confirmed = await operation.requestStop();
      if (!confirmed && mounted.current && videoOperation.current === operation) {
        pendingNavigation.current = null;
        setFailure('A câmera ainda não confirmou o encerramento. Toque em encerrar novamente.');
        transition('recording');
      }
      return;
    }
    if (audioStopping.current) return;
    const recording = audio.current;
    const target = activeProject.current;
    if (!recording || !target) return;
    audioStopping.current = true;
    transition('saving');
    try {
      const before = await recording.getStatusAsync();
      const status = before.isDoneRecording ? before : await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      audio.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      if (!uri) throw new Error('O microfone não entregou um arquivo. Grave um novo take.');
      await saveTake(target, uri, status.durationMillis / 1000 || (Date.now() - startedAt.current) / 1000);
    } catch (cause) {
      pendingNavigation.current = null;
      const uri = recording.getURI();
      audio.current = null;
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
      // Interruption can stop the recorder before our explicit stop call. Still
      // try its actual file; persistStudioTake validates the native duration.
      if (uri) await saveTake(target, uri, (Date.now() - startedAt.current) / 1000);
      else {
        if (mounted.current) setFailure(cause instanceof Error ? cause.message : 'A gravação foi interrompida.');
        activeProject.current = null; transition('idle');
      }
    } finally { audioStopping.current = false; }
  }
  stopRef.current = stopRecording;

  usePreventRemove(phase !== 'idle' || !!recovery, ({ data }) => {
    if (phaseRef.current === 'idle' && recovery) {
      Alert.alert('Este take ainda não foi salvo',
        'A gravação continua em um arquivo temporário. Tente salvar antes de sair. Se sair sem salvar, o take não aparecerá no seu projeto.', [
          { text: 'Ficar aqui', style: 'cancel' },
          { text: 'Salvar e sair', onPress: () => {
            pendingNavigation.current = data.action;
            void saveTake(recovery.project, recovery.uri, recovery.duration, recovery.metadata);
          } },
          { text: 'Sair sem salvar', style: 'destructive', onPress: () => {
            pendingNavigation.current = data.action;
            setRecovery(null);
          } },
        ]);
      return;
    }
    if (phaseRef.current === 'saving') {
      Alert.alert(importing ? 'Importando seus arquivos' : 'Salvando seu take', 'Aguarde seus arquivos serem salvos antes de sair.');
      return;
    }
    if (phaseRef.current === 'countdown') {
      pendingNavigation.current = data.action;
      void stopRef.current();
      return;
    }
    Alert.alert('Encerrar este take?', 'A gravação será salva no seu projeto antes de sair.', [
      { text: 'Continuar gravando', style: 'cancel' },
      { text: 'Salvar e sair', onPress: () => { pendingNavigation.current = data.action; void stopRef.current(); } },
    ]);
  });
  useEffect(() => {
    if (phase === 'idle' && !recovery && pendingNavigation.current) {
      const action = pendingNavigation.current;
      pendingNavigation.current = null;
      navigation.dispatch(action);
    }
  }, [phase, recovery, navigation]);
  useEffect(() => {
    if (phase === 'idle' && !recovery && finishAfterImport.current) {
      finishAfterImport.current = false;
      finishCapture();
    }
  }, [phase, recovery]);
  useEffect(() => {
    if (!notice || failure) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice, failure]);
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setInterval(() => {
      setElapsed((Date.now() - startedAt.current) / 1000);
    }, 250);
    return () => clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'recording' || !showScript || !followScript) return;
    const timer = setInterval(() => {
      const limit = Math.max(0, scriptSize.current.content - scriptSize.current.viewport);
      scriptOffset.current = Math.min(limit, scriptOffset.current + scriptSpeed / 20);
      scriptScroll.current?.scrollTo({ y: scriptOffset.current, animated: false });
    }, 50);
    return () => clearInterval(timer);
  }, [phase, showScript, followScript, scriptSpeed]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        // Stop before removing the preview. A resolved video promise still saves its original.
        if (phaseRef.current === 'recording' || phaseRef.current === 'countdown') {
          if (mounted.current) setNotice(phaseRef.current === 'recording'
            ? 'Gravação interrompida. O take está sendo salvo.' : 'Preparação cancelada ao sair do aplicativo.');
          void stopRef.current();
        }
      }
      if (state !== 'active') setReady(false);
      setForeground(state === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!focused) setReady(false);
    const ownerChanged = !!activeProject.current && activeProject.current.ownerId !== user?.id;
    if (!focused || ownerChanged || (!roleLoading && !permitted)) void stopRef.current();
  }, [focused, permitted, roleLoading, user?.id]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      countdownToken.current++;
      // Native navigation is guarded; this also covers parent teardown/sign-out.
      void stopRef.current();
      videoOperation.current?.dispose();
      mounted.current = false;
    };
  }, []);

  async function enablePermissions() {
    setFailure(null);
    if (permissionBlocked) { await Linking.openSettings(); return; }
    try {
      if (!isAudio && !cameraPermission?.granted) await requestCameraPermission();
      if (!microphonePermission?.granted) await requestMicrophonePermission();
    } catch { setFailure('Não foi possível abrir as permissões. Confira os Ajustes do iPhone.'); }
  }
  async function beginRecording() {
    if (!project || !captureScopeCurrent(project) || phaseRef.current !== 'idle' || captureContext.current.recovery || busyProject || effectBusyRef.current) return;
    let operationToken: number | null = null;
    let ownedRecording: Audio.Recording | null = null;
    try {
      assertCaptureSession(project);
      if (!permissionGranted) { await enablePermissions(); return; }
      const prepared = captureReadiness.current;
      if (!Device.isDevice || !prepared.orientationReady || !isAudio && (!prepared.ready || !prepared.screenMatches || !prepared.sensorMatches || !cameraControls.isReady())) return;
      setFailure(null); setNotice(null); setElapsed(0); setPanel(null); setCancelingAudio(false);
      activeProject.current = project;
      transition('countdown');
      const token = ++countdownToken.current;
      operationToken = token;
      for (let value = countdownSeconds; value > 0; value--) {
        setCountdown(value);
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (token !== countdownToken.current || !mounted.current) return;
      }
      assertCaptureSession(project);
      const positioned = captureReadiness.current;
      if (!isAudio && (!positioned.sensorMatches || !positioned.screenMatches || !positioned.orientationReady)) {
        throw new Error(project.kind === 'aula' ? 'Vire o iPhone na horizontal para gravar sua aula.' : 'Mantenha o iPhone na vertical para gravar seu Short.');
      }
      if (!isAudio && (!positioned.ready || !cameraControls.isReady())) {
        throw new Error('A câmera foi interrompida. Aguarde a imagem ficar pronta e grave novamente.');
      }
      if (!isAudio) {
        const positionedCamera = await cameraControls.prepareRecording();
        if (token !== countdownToken.current || !mounted.current || AppState.currentState !== 'active') return;
        assertCaptureSession(project);
        if (!positionedCamera) throw new Error('A câmera não confirmou o enquadramento. Aguarde a imagem e tente novamente.');
        if (nativeEffects) {
          const treatmentReady = await confirmCaptureGrade(captureGradeRef.current);
          if (token !== countdownToken.current || !mounted.current || AppState.currentState !== 'active') return;
          assertCaptureSession(project);
          if (!treatmentReady) throw new Error('A câmera não confirmou o tratamento. Use Natural ou escolha o ajuste novamente.');
        }
      }
      if (token !== countdownToken.current || !mounted.current || AppState.currentState !== 'active') return;
      assertCaptureSession(project);
      setCountdown(0);
      scriptOffset.current = 0;
      scriptScroll.current?.scrollTo({ y: 0, animated: false });
      if (isAudio) {
        audioPreparation.current = token;
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        if (token !== countdownToken.current || !captureScopeCurrent(project) || AppState.currentState !== 'active') {
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          activeProject.current = null; transition('idle'); return;
        }
        const recording = new Audio.Recording();
        ownedRecording = recording;
        audio.current = recording;
        await recording.prepareToRecordAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
        if (token !== countdownToken.current || !captureScopeCurrent(project) || AppState.currentState !== 'active') {
          await recording.stopAndUnloadAsync(); if (audio.current === recording) audio.current = null;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          activeProject.current = null; transition('idle'); return;
        }
        recording.setOnRecordingStatusUpdate(status => {
          if (audio.current !== recording) return;
          if (mounted.current && status.canRecord) setElapsed(status.durationMillis / 1000);
          if (status.isDoneRecording && phaseRef.current === 'recording') void stopRef.current();
        });
        recording.setProgressUpdateInterval(120);
        await recording.startAsync();
        if (token !== countdownToken.current || !captureScopeCurrent(project) || AppState.currentState !== 'active') {
          await recording.stopAndUnloadAsync(); if (audio.current === recording) audio.current = null;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          activeProject.current = null; transition('idle'); return;
        }
        startedAt.current = Date.now(); transition('recording');
      } else {
        if (!camera.current) throw new Error('A câmera ainda está preparando a imagem. Tente novamente.');
        const ownedCamera = camera.current;
        const operation = createStudioVideoStopOperation({
          stop: () => ownedCamera.stopRecording(),
          isCurrent: () => mounted.current && videoOperation.current === operation && camera.current === ownedCamera,
          isRecording: cameraControls.recordingProbe(),
        });
        videoOperation.current = operation;
        startedAt.current = Date.now();
        transition('recording');
        // The configured AVFoundation session chooses its compatible codec.
        // Forcing H.264 here can override the output selected for 4K/60 FPS.
        const result = await ownedCamera.recordAsync(cameraControls.available ? undefined : { codec: 'avc1' })
          .finally(() => {
            operation.settle();
            if (videoOperation.current === operation) videoOperation.current = null;
          });
        if (!result?.uri) throw new Error('A câmera não entregou um arquivo. Grave um novo take.');
        const captured = isStudioNativeCameraHandle(ownedCamera) ? result as StudioCaptureRecording : undefined;
        const metadata: CaptureMetadata | undefined = captured ? {
          sourceKind: captured.sourceKind, sourceStage: captured.sourceStage, frameRate: captured.frameRate, grade: captured.grade,
          colorSpace: captured.colorPrimaries === 'ITU_R_709_2' && captured.transferFunction === 'ITU_R_709_2' ? 'rec709'
            : captured.colorPrimaries && captured.colorPrimaries !== 'unknown' ? captured.colorPrimaries : undefined,
        } : undefined;
        await saveTake(project, result.uri, captured?.duration || (Date.now() - startedAt.current) / 1000, metadata);
      }
    } catch (cause) {
      pendingNavigation.current = null;
      if (!isAudio && cause instanceof StudioNativeRecordingError && cause.recoveryUri) {
        await saveTake(project, cause.recoveryUri, (Date.now() - startedAt.current) / 1000, { sourceKind: 'standard', sourceStage: 'standard', grade: cause.grade });
        return;
      }
      const recording = ownedRecording;
      if (audio.current === recording) audio.current = null;
      if (recording) { try { await recording.stopAndUnloadAsync(); } catch {} }
      if (isAudio) { try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {} }
      activeProject.current = null;
      if (mounted.current) setFailure(cause instanceof Error ? cause.message : 'Não foi possível iniciar a gravação.');
      transition('idle');
    } finally {
      // A canceled countdown can finish after another countdown has begun.
      // Only the preparation that owns this token may release its startup lock.
      if (operationToken !== null && audioPreparation.current === operationToken) {
        audioPreparation.current = null;
        if (mounted.current) {
          setCancelingAudio(false);
          if (operationToken !== countdownToken.current) setNotice('Preparação cancelada. Seu projeto continua salvo.');
        }
      }
    }
  }

  async function addMedia() {
    if (!project || phaseRef.current !== 'idle' || recovery || busyProject) return;
    setPanel(null); setFailure(null); setNotice(null); setImporting(true);
    transition('saving');
    try {
      assertSession(project);
      const latest = getStudioProject(project.ownerId, project.id);
      if (!latest) throw new Error('Não foi possível encontrar este projeto.');
      const takes = await importStudioMedia(latest);
      assertSession(project);
      // The shared importer saves each original and appends each valid take
      // atomically. Never append this batch again or discard partial successes.
      if (takes.length) finishAfterImport.current = true;
    } catch (cause) {
      if (mounted.current) setFailure(cause instanceof Error ? cause.message : 'Não foi possível importar seus arquivos.');
    } finally {
      if (mounted.current) setImporting(false);
      transition('idle');
    }
  }

  const idle = phase === 'idle';
  const immersive = phase === 'recording';
  const captureAvailable = permitted && !loading && !busyProject;
  const toolsDisabled = !idle || !!recovery || !captureAvailable;
  const recordDisabled = phase === 'saving' || cancelingAudio || idle && (!!recovery || busyProject || !permitted || !Device.isDevice
    || !permissionGranted || !orientationReady || !isAudio && (!ready || !screenMatches || !sensorMatches || cameraControls.busy || effectBusy
      || !!normalizeStudioCaptureGrade(captureGrade) && (!effectSupported || !!effectError) || cameraControls.available && !cameraControls.state));
  const cameraState = cameraControls.state;
  const qualities: ('720p' | '1080p' | '2160p')[] = cameraState?.qualities.map(item => item.quality) || ['720p', '1080p'];
  const confirmedQuality = cameraState?.quality || videoQuality;
  const frameRates = cameraState?.qualities.find(item => item.quality === confirmedQuality)?.fps || [];
  const qualityLabel = confirmedQuality === '2160p' ? '4K' : confirmedQuality === '1080p' ? 'HD' : '720p';
  const zoomDisabled = !idle || !!recovery || cameraControls.busy || cameraControls.available && !cameraControls.zoomAvailable;
  const zoomLabel = cameraState && Number.isFinite(cameraState.zoom) ? `${cameraState.zoom.toFixed(1)}×`
    : cameraControls.available ? 'Zoom indisponível' : `Zoom ${Math.round(zoom * 100)}%`;
  const showTorch = !isAudio && Device.isDevice && facing === 'back' && !!cameraState?.supportsTorch;
  function chooseQuality(quality: '720p' | '1080p' | '2160p') {
    if (phaseRef.current !== 'idle' || recovery || cameraControls.isBusy()) return;
    if (cameraControls.available) { void cameraControls.configure(quality); }
    else if (quality !== '2160p' && quality !== videoQuality) { setReady(false); setSensorOrientation(null); setVideoQuality(quality); }
  }
  function cycleQuality() {
    const next = qualities[(qualities.indexOf(confirmedQuality) + 1) % qualities.length];
    if (next) chooseQuality(next);
  }
  function cycleFPS() {
    if (!cameraState?.quality || phaseRef.current !== 'idle' || recovery) return;
    const next = frameRates[(frameRates.findIndex(rate => Math.abs(rate - (cameraState.fps || 0)) < 0.5) + 1) % frameRates.length];
    if (next) void cameraControls.configure(cameraState.quality, next);
  }
  const kindLabel = isAudio ? 'Podcast' : project?.kind === 'short' ? 'Short · 9:16' : 'Aula · 16:9';
  const cameraAspect = project?.kind === 'short' ? 9 / 16 : 16 / 9;
  const cameraWidth = Math.min(dimensions.width, dimensions.height * cameraAspect);
  const cameraHeight = cameraWidth / cameraAspect;
  const safeTop = Math.max(insets.top, 14);
  const safeBottom = Math.max(insets.bottom, 20);
  const safeLeft = Math.max(insets.left, 18);
  const safeRight = Math.max(insets.right, 18);
  const scriptPresent = !!project?.script.trim();
  const panelTitle = panel === 'timer' ? 'Temporizador' : panel === 'quality' ? cameraState ? 'Câmera Pro' : 'Qualidade do vídeo' : panel === 'treatment' ? 'Tratamento' : 'Teleprompter';
  const readyHint = isAudio ? 'Uma conversa. Uma ideia por take.' : project?.kind === 'aula' ? 'Seu conhecimento em uma aula.' : 'Uma ideia que merece ser compartilhada.';
  const stateHint = phase === 'saving' ? importing ? 'Importando seus originais…' : 'Salvando seu take…'
    : phase === 'recording' ? 'Toque para encerrar o take' : phase === 'countdown' ? 'Toque para cancelar'
    : !orientationReady ? 'Preparando o enquadramento…'
    : !isAudio && (!sensorMatches || !screenMatches) ? project?.kind === 'aula' ? 'Vire o iPhone na horizontal' : 'Mantenha o iPhone na vertical'
    : readyHint;

  let gate: ReactNode = null;
  if (loading || roleLoading) {
    gate = <ActivityIndicator color={colors.textSecondary} />;
  } else if (!project || !permitted) {
    gate = <CaptureMessage icon={<Camera color={colors.textSecondary} size={36} strokeWidth={1.3} />}
      title="Seu espaço de criação" detail={error || 'Abra este projeto na conta de creator que o criou.'}
      actionLabel="Voltar" onAction={closeCapture} />;
  } else if (busyProject) {
    gate = <CaptureMessage icon={<Check color={colors.textSecondary} size={36} strokeWidth={1.3} />}
      title="Seu projeto está em preparação" detail="Os takes estão preservados. Volte ao projeto para acompanhar o envio."
      actionLabel="Ver projeto" onAction={finishCapture} />;
  } else if (!Device.isDevice) {
    gate = <CaptureMessage icon={isAudio ? <Mic color={colors.textSecondary} size={36} strokeWidth={1.3} /> : <Camera color={colors.textSecondary} size={36} strokeWidth={1.3} />}
      title={isAudio ? 'O microfone abre no seu iPhone' : 'A câmera abre no seu iPhone'}
      detail="Aqui no simulador, importe um arquivo para experimentar seu Studio."
      actionLabel={isAudio ? 'Importar áudio' : 'Abrir galeria'} onAction={() => void addMedia()} disabled={toolsDisabled} />;
  } else if (!permissionGranted) {
    gate = <CaptureMessage icon={isAudio ? <Mic color={colors.textSecondary} size={36} strokeWidth={1.3} /> : <Camera color={colors.textSecondary} size={36} strokeWidth={1.3} />}
      title={isAudio ? 'Dê voz ao seu conhecimento' : 'Tudo começa com uma ideia'}
      detail={isAudio ? 'Permita o microfone para gravar seu podcast.' : 'Permita a câmera e o microfone. A gravação só começa quando você tocar no botão.'}
      actionLabel={permissionBlocked ? 'Abrir Ajustes' : 'Permitir e continuar'} onAction={() => void enablePermissions()} />;
  }

  const closeButton = <CaptureTool label="Fechar captura" onPress={closeCapture}><X size={23} strokeWidth={1.65} color={colors.text} /></CaptureTool>;
  const flipButton = !isAudio && <CaptureTool label="Alternar câmera" disabled={toolsDisabled || !Device.isDevice} onPress={() => {
    setReady(false); setSensorOrientation(null); setFacing(previous => previous === 'front' ? 'back' : 'front'); setTorch(false); setZoom(0);
  }}><SwitchCamera size={26} color={colors.text} strokeWidth={1.45} /><Text style={styles.cameraToolLabel}>Câmera</Text></CaptureTool>;
  const recordButton = <Pressable accessibilityRole="button"
    accessibilityLabel={phase === 'recording' ? 'Encerrar e salvar take' : phase === 'countdown' ? 'Cancelar contagem' : 'Começar gravação'}
    accessibilityState={{ disabled: recordDisabled, busy: phase === 'saving' }} disabled={recordDisabled}
    onPress={() => { if (phase === 'recording' || phase === 'countdown') void stopRecording(); else void beginRecording(); }}
    style={({ pressed }) => [styles.recordButton, phase === 'recording' && styles.recordButtonActive, recordDisabled && styles.disabled, pressed && styles.recordPressed]}>
    {phase === 'saving' ? <ActivityIndicator color={colors.text} /> : phase === 'recording' ? <View style={styles.recordStop} />
      : phase === 'countdown' ? <Square size={26} color={colors.text} strokeWidth={1.8} /> : <View style={styles.recordInner} />}
  </Pressable>;

  return <View style={styles.screen}>
    <StatusBar hidden={focused} style="light" animated />
    {cameraMounted && <StudioCaptureFrame key={`${project!.id}:${facing}:${nativeCamera ? 'studio-native' : cameraControls.available ? 'expo-bridge' : videoQuality}`}
      frame={{ width: cameraWidth, height: cameraHeight, left: (dimensions.width - cameraWidth) / 2, top: (dimensions.height - cameraHeight) / 2 }}
      zoom={zoom} onZoom={changeZoom} disabled={zoomDisabled || immersive}
      onFocus={cameraState?.supportsFocus ? point => { void cameraControls.focus(point); } : undefined} canLockFocus={cameraState?.supportsFocusLock}>
      {nativeCamera ? <StudioNativeCamera ref={camera as React.Ref<StudioNativeCameraHandle>} style={StyleSheet.absoluteFill}
        onCameraReady={() => { void cameraControls.initialize().then(result => { if (result !== undefined && mounted.current) setReady(result); }); }}
        onRecordingState={event => { if (event.phase === 'recording' && phaseRef.current === 'recording') startedAt.current = Date.now(); }}
        onInterruption={event => { if (mounted.current) {
          if (event.message) setNotice(event.message);
          if (event.reason === 'previewFallback') {
            setEffectSupported(false);
            setEffectError('A prévia do tratamento foi interrompida. Escolha Natural para o próximo take ou ajuste a imagem no editor.');
          }
        } }}
        onMountError={event => { if (mounted.current) { setReady(false); setFailure(event.message); } }} />
      : <CameraView ref={camera as React.Ref<CameraView>} style={StyleSheet.absoluteFill}
        facing={facing} mode="video" videoQuality={cameraControls.available ? '1080p' : videoQuality} videoStabilizationMode="auto" autofocus="on"
        zoom={cameraControls.available ? undefined : zoom} enableTorch={torch && facing === 'back'} mirror={false} responsiveOrientationWhenOrientationLocked
        onResponsiveOrientationChanged={event => setSensorOrientation(event.orientation)}
        onCameraReady={() => { void cameraControls.initialize().then(result => { if (result !== undefined && mounted.current) setReady(result); }); }}
        onMountError={() => { setReady(false); setFailure('Não foi possível iniciar a câmera. Confira as permissões ou importe um vídeo.'); }} />}
    </StudioCaptureFrame>}
    {(isAudio || !!gate) && <LinearGradient colors={['#16141D', '#070708', '#000000']} locations={[0, 0.6, 1]} style={StyleSheet.absoluteFill} />}
    {!immersive && <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.55)', 'transparent']} style={[styles.topShade, { height: safeTop + 130 }]} />}
    {!immersive && <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.72)']} style={[styles.bottomShade, landscape ? { height: 110 } : { height: safeBottom + 210 }]} />}
    {!immersive && landscape && <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.72)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.rightShade, { width: safeRight + 120 }]} />}

    <View style={[styles.topControls, { top: safeTop, left: safeLeft, right: safeRight }]}>
      {!immersive && <View style={styles.topActionSlot}>{closeButton}</View>}
      <View pointerEvents="none" style={styles.captureIdentity}>
        <View style={[styles.timerPill, phase === 'recording' && styles.timerPillActive]}>
          {phase === 'recording' && <View style={styles.recordDot} />}
          <Text style={styles.timer}>{formatStudioDuration(elapsed)}</Text>
        </View>
        {!immersive && <Text style={styles.takeLabel}>{kindLabel.toUpperCase()} · TAKE {String((project?.takes.length || 0) + 1).padStart(2, '0')}</Text>}
      </View>
      {!immersive && <View style={styles.qualityCluster}>
        <Pressable accessibilityRole="button" accessibilityLabel={isAudio ? 'Gravação de áudio em M4A' : `Qualidade ${qualityLabel}. Toque para alternar, segure para os ajustes`}
          disabled={isAudio || toolsDisabled || cameraControls.busy || cameraControls.available && !cameraState}
          onPress={cycleQuality} onLongPress={() => setPanel('quality')} style={({ pressed }) => [styles.qualityPill, pressed && styles.pressed]}>
          {cameraControls.busy ? <ActivityIndicator size={12} color={colors.text} /> : <Text style={styles.qualityText}>{isAudio ? 'M4A' : qualityLabel}</Text>}
        </Pressable>
        {!isAudio && !!cameraState && !!frameRates.length && <Pressable accessibilityRole="button" accessibilityLabel={`${cameraState.fps ? Math.round(cameraState.fps) : 'Auto'} quadros por segundo. Toque para alternar`}
          disabled={toolsDisabled || cameraControls.busy} onPress={cycleFPS} onLongPress={() => setPanel('quality')}
          style={({ pressed }) => [styles.fpsPill, pressed && styles.pressed]}><Text style={styles.qualityText}>{cameraState.fps ? Math.round(cameraState.fps) : 'Auto'}</Text></Pressable>}
      </View>}
    </View>

    {gate ? <View pointerEvents="box-none" style={[styles.gate, landscape && { paddingHorizontal: safeLeft + 90, paddingVertical: 80 }]}>{gate}</View> : isAudio && !immersive ?
      <View pointerEvents="box-none" style={[styles.podcastCenter, { paddingHorizontal: safeLeft + 12 }, scriptPresent && showScript && { justifyContent: 'flex-end', paddingTop: 0, paddingBottom: safeBottom + 192 }]}>
        {!(scriptPresent && showScript) && <><View style={styles.micCircle}><Mic color={colors.textSecondary} size={42} strokeWidth={1.15} /></View>
          <Text style={styles.podcastTitle}>{project!.title.trim() || 'Dê voz ao seu conhecimento'}</Text></>}
        <Text style={styles.podcastCaption}>Seu microfone, seu próximo aprendizado</Text>
        <View accessible accessibilityLabel="Microfone em espera" style={styles.meterRow}>
          {Array.from({ length: 36 }, (_, index) => <View key={index} style={styles.meterBar} />)}
        </View>
      </View> : null}

    {captureAvailable && !immersive && <View style={[styles.tools, landscape
      ? { top: safeTop + 76, left: safeLeft }
      : { top: safeTop + 95, right: safeRight }]}>
      {showTorch && <CaptureTool label={torch ? 'Desligar luz' : 'Ligar luz'}
        disabled={toolsDisabled}
        selected={torch} onPress={() => { if (nativeCamera) void cameraControls.setTorch(!torch); else setTorch(previous => !previous); }}>
        {torch ? <Zap size={21} color={colors.amber} strokeWidth={1.5} /> : <ZapOff size={21} color={colors.text} strokeWidth={1.5} />}
      </CaptureTool>}
      <CaptureTool label={`Temporizador: ${countdownSeconds ? `${countdownSeconds} segundos` : 'desligado'}`} disabled={toolsDisabled} selected={countdownSeconds > 0} onPress={() => setPanel('timer')}>
        <Timer size={22} color={colors.text} strokeWidth={1.5} />
        {!!countdownSeconds && <Text style={styles.toolValue}>{countdownSeconds}</Text>}
      </CaptureTool>
      {!isAudio && cameraState && <CaptureTool label="Abrir controles Pro da câmera" disabled={phase === 'saving'} onPress={() => setPanel('quality')}>
        <SlidersHorizontal size={22} color={colors.text} strokeWidth={1.5} />
      </CaptureTool>}
      {!isAudio && <CaptureTool label={`Tratamento: ${capturePresets.find(item => item.id === captureGrade.preset)?.label || 'Natural'}`}
        selected={!!normalizeStudioCaptureGrade(captureGrade)} disabled={toolsDisabled} onPress={() => setPanel('treatment')}>
        {effectBusy ? <ActivityIndicator size={20} color={colors.text} /> : <Palette size={22} color={colors.text} strokeWidth={1.5} />}
      </CaptureTool>}
      <CaptureTool label="Abrir teleprompter" selected={showScript && scriptPresent} disabled={!permitted || phase === 'saving'} onPress={() => setPanel('script')}>
        <FileText size={22} color={colors.text} strokeWidth={1.5} />
      </CaptureTool>
    </View>}

    {!immersive && !gate && scriptPresent && showScript && <View style={[styles.prompter, landscape
      ? { top: safeTop + 78, left: safeLeft + 66, right: safeRight + 114 }
      : { top: safeTop + 102, left: safeLeft, right: safeRight + 60 }]}>
      <View style={styles.prompterHeader}>
        <View style={styles.prompterIdentity}><FileText color={colors.textSecondary} size={13} strokeWidth={1.5} /><Text style={styles.prompterLabel}>ROTEIRO</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={followScript ? 'Pausar rolagem do roteiro' : 'Ativar rolagem do roteiro'}
          onPress={() => setFollowScript(previous => !previous)} hitSlop={10} style={styles.prompterAction}>
          {followScript ? <Pause color={colors.text} size={15} /> : <Play color={colors.text} size={15} />}
        </Pressable>
      </View>
      <ScrollView ref={scriptScroll} style={[styles.scriptScroll, { maxHeight: landscape ? Math.max(58, Math.min(110, dimensions.height * 0.25)) : 122 }]} showsVerticalScrollIndicator={false}
        onLayout={event => { scriptSize.current.viewport = event.nativeEvent.layout.height; }}
        onContentSizeChange={(_, height) => { scriptSize.current.content = height; }}
        onScroll={event => { scriptOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
        onScrollBeginDrag={() => setFollowScript(false)}>
        <Text style={[styles.scriptText, landscape && { fontSize: 20, lineHeight: 28 }]}>{project!.script.trim()}</Text>
      </ScrollView>
    </View>}

    {!immersive && !isAudio && captureAvailable && !gate && (!cameraControls.available || cameraControls.zoomAvailable) && <View pointerEvents="box-none" style={[styles.zoomAnchor, landscape
      ? { bottom: Math.max(insets.bottom, 16) + (project?.takes.length ? 85 : 15), left: (dimensions.width - 210) / 2 }
      : { bottom: safeBottom + (project?.takes.length ? 206 : 140), alignSelf: 'center' }]}>
      <StudioCaptureZoom value={zoom} onChange={changeZoom} label={zoomLabel} disabled={zoomDisabled}
        confirmedValue={cameraState ? studioNormalizedZoom(cameraState.zoom, cameraState) : undefined}
        pending={cameraControls.zoomPending} confirmation={cameraControls.zoomConfirmation} style={{ position: 'relative' }} />
    </View>}

    {phase === 'countdown' && <View pointerEvents="none" style={styles.countdownOverlay}>
      {countdown > 0 ? <Text style={styles.countdownNumber}>{countdown}</Text> : <ActivityIndicator color={colors.text} size="large" />}
      <Text style={styles.countdownLabel}>{cancelingAudio ? 'Cancelando a preparação…' : countdown > 0 ? 'Respire. Sua ideia vem primeiro.' : 'Preparando a gravação…'}</Text>
    </View>}

    {!immersive && (!!notice || !!failure || !!recovery || !!orientationError || !!cameraControls.error) && <View accessibilityLiveRegion="polite" style={[styles.statusToast, landscape
      ? { bottom: Math.max(insets.bottom, 16) + (project?.takes.length ? 160 : 60), left: safeLeft + 64, right: safeRight + 124 }
      : { bottom: safeBottom + (project?.takes.length ? 278 : 228), left: safeLeft, right: safeRight }]}>
      <View style={styles.statusRow}>{!failure && !orientationError && !cameraControls.error && <Check size={16} color={colors.free} />}<Text style={[styles.statusText, (!!failure || !!orientationError || !!cameraControls.error) && styles.failure]}>{failure || orientationError || cameraControls.error || notice}</Text></View>
      {!!recovery && <Pressable accessibilityRole="button" disabled={!idle} onPress={() => void saveTake(recovery.project, recovery.uri, recovery.duration, recovery.metadata)} style={styles.recoveryButton}>
        <Text style={styles.recoveryLabel}>Salvar este take</Text><ChevronRight size={17} color={colors.text} />
      </Pressable>}
    </View>}

    {captureAvailable && <View style={landscape
      ? [styles.landscapeDock, { top: safeTop + 64, bottom: Math.max(insets.bottom, 14), right: safeRight }]
      : [styles.portraitDock, { bottom: safeBottom + (project?.takes.length ? 82 : 0), left: safeLeft, right: safeRight }]}>
      {landscape ? <>
        <View style={styles.landscapeRecord}>{recordButton}{!immersive && <Text style={styles.recordCaption}>{phase === 'saving' ? 'Salvando' : phase === 'countdown' ? 'Cancelar' : 'Gravar'}</Text>}</View>
        <View style={styles.landscapeSecondary}>{!immersive && flipButton}</View>
      </> : <>
        {!immersive && <Text pointerEvents="none" style={styles.guidance}>{stateHint}</Text>}
        <View style={styles.portraitRecordRow}><View style={styles.dockSide} />{recordButton}<View style={styles.dockSide}>{!immersive && flipButton}</View></View>
        {!immersive && !project!.takes.length && <View style={styles.portraitFinish}><Text style={styles.firstTakeLabel}>Faça uma ideia por take</Text></View>}
      </>}
    </View>}

    {!immersive && captureAvailable && !!project?.takes.length && <View style={[styles.takesDock, landscape
      ? { bottom: safeBottom, left: safeLeft + 64, right: safeRight + 124 }
      : { bottom: safeBottom, left: safeLeft, right: safeRight }]}>
      <StudioCaptureTakes takes={project.takes} disabled={toolsDisabled} onContinue={finishCapture} compact={landscape} />
    </View>}

    <SheetModal visible={!!panel} onRequestClose={() => setPanel(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={sheetStyles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar ajustes de captura" onPress={() => setPanel(null)} style={StyleSheet.absoluteFill} />
        <View style={[sheetStyles.surface, styles.panelSurface, {
          width: landscape ? Math.min(dimensions.width - safeLeft - safeRight, dimensions.height * 16 / 9) : '100%',
          maxHeight: Math.max(180, Math.min(460, dimensions.height - safeTop - 16)),
        }]}>
          <View onStartShouldSetResponder={() => true}><View style={sheetStyles.handle} />
            <View style={sheetStyles.header}><Text style={styles.panelTitle}>{panelTitle}</Text><SheetCloseButton onPress={() => setPanel(null)} /></View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: Math.max(insets.bottom, 20) + 12, gap: 18 }}>
            {panel === 'timer' && <>
              <Text style={styles.panelDetail}>Um instante para se posicionar antes de cada take.</Text>
              <View style={styles.optionRow}>{[0, 3, 5, 10].map(seconds => <Pressable key={seconds} accessibilityRole="button" accessibilityLabel={seconds ? `${seconds} segundos` : 'Sem contagem'}
                accessibilityState={{ selected: countdownSeconds === seconds }} onPress={() => { setCountdownSeconds(seconds); setPanel(null); }}
                style={({ pressed }) => [styles.option, countdownSeconds === seconds && styles.optionSelected, pressed && styles.pressed]}>
                <Text style={[styles.optionText, countdownSeconds === seconds && styles.optionTextSelected]}>{seconds ? `${seconds}s` : 'Sem'}</Text>
              </Pressable>)}</View>
            </>}
            {panel === 'treatment' && <>
              <Text style={styles.panelDetail}>{nativeEffects
                ? 'Veja o tratamento na câmera e ajuste a intensidade. O original fica intacto; você pode mudar o resultado depois no editor.'
                : 'A prévia de tratamento precisa da câmera nativa atualizada. Nesta versão, a gravação mantém a imagem original.'}</Text>
              <View style={styles.optionRow}>{capturePresets.map(preset => <Pressable key={preset.id} accessibilityRole="button"
                accessibilityLabel={`Tratamento ${preset.label}`} accessibilityState={{ selected: captureGrade.preset === preset.id, disabled: !nativeEffects || toolsDisabled || cameraControls.busy || effectBusy }}
                disabled={!nativeEffects || toolsDisabled || cameraControls.busy || effectBusy}
                onPress={() => { void chooseCaptureGrade({ ...studioGrade(preset.id), intensity: captureGrade.intensity }); }}
                style={({ pressed }) => [styles.option, captureGrade.preset === preset.id && styles.optionSelected,
                  (!nativeEffects || toolsDisabled || effectBusy) && styles.disabled, pressed && styles.pressed]}>
                <Text style={[styles.optionText, captureGrade.preset === preset.id && styles.optionTextSelected]}>{preset.label}</Text>
              </Pressable>)}</View>
              <View style={{ gap: 8 }}>
                <View style={styles.settingRow}><Text style={styles.settingLabel}>Intensidade</Text><Text style={styles.cameraValue}>{Math.round(captureGrade.intensity * 100)}%</Text></View>
                <StudioCaptureZoom controlName="intensidade do tratamento" value={captureGrade.intensity}
                  onChange={value => { void chooseCaptureGrade({ ...captureGradeRef.current, intensity: Math.round(value * 100) / 100 }); }}
                  label={`${Math.round(captureGrade.intensity * 100)}%`} disabled={!nativeEffects || toolsDisabled || cameraControls.busy || captureGrade.preset === 'natural'}
                  style={{ position: 'relative', alignSelf: 'center', width: '100%' }} />
                <Text style={styles.cameraHint}>{captureGrade.preset === 'natural' ? 'Natural mantém a imagem da câmera.' : captureGrade.preset === 'studio' ? 'Studio aplica luz suave no rosto e equilibra os tons.' : 'Cinematic ajusta as cores; não aplica desfoque de fundo.'}</Text>
              </View>
              <View style={styles.settingRow}>{effectBusy ? <ActivityIndicator size={13} color={colors.textSecondary} /> : null}
                <Text accessibilityLiveRegion="polite" style={[styles.cameraHint, effectError && styles.failure]}>{effectError || (effectBusy ? 'Confirmando a prévia…' : nativeEffects && effectSupported ? 'Tratamento confirmado na prévia.' : 'Gravação com a imagem original.')}</Text>
              </View>
              <Text style={styles.cameraHint}>O original mantém a qualidade confirmada na câmera. A qualidade da montagem é escolhida no editor; tratamentos são aplicados em SDR.</Text>
            </>}
            {panel === 'quality' && <>
              <Text style={styles.panelDetail}>{cameraState ? 'Resolução e movimento do seu vídeo. Toque em HD ou FPS na câmera para alternar rapidamente.' : 'Mais qualidade ou um arquivo mais leve. A resolução pode variar conforme a câmera do seu aparelho.'}</Text>
              <View style={styles.optionRow}>{qualities.map(quality => <Pressable key={quality} accessibilityRole="button" accessibilityState={{ selected: confirmedQuality === quality }}
                disabled={toolsDisabled || cameraControls.busy} onPress={() => chooseQuality(quality)}
                style={({ pressed }) => [styles.option, confirmedQuality === quality && styles.optionSelected, (toolsDisabled || cameraControls.busy) && styles.disabled, pressed && styles.pressed]}>
                <Text style={[styles.optionText, confirmedQuality === quality && styles.optionTextSelected]}>{quality === '2160p' ? '4K' : quality === '1080p' ? '1080p' : '720p'}</Text>
              </Pressable>)}</View>
              {cameraState && <>
                {!!frameRates.length && <><Text style={styles.settingLabel}>Quadros por segundo</Text><View style={styles.optionRow}>{frameRates.map(rate => <Pressable key={rate}
                  accessibilityRole="button" accessibilityLabel={`${rate} quadros por segundo`} accessibilityState={{ selected: Math.abs((cameraState.fps || 0) - rate) < 0.5 }}
                  disabled={toolsDisabled || cameraControls.busy} onPress={() => { if (cameraState.quality) void cameraControls.configure(cameraState.quality, rate); }}
                  style={({ pressed }) => [styles.option, Math.abs((cameraState.fps || 0) - rate) < 0.5 && styles.optionSelected, (toolsDisabled || cameraControls.busy) && styles.disabled, pressed && styles.pressed]}>
                  <Text style={[styles.optionText, Math.abs((cameraState.fps || 0) - rate) < 0.5 && styles.optionTextSelected]}>{rate}</Text>
                </Pressable>)}</View></>}
                {cameraState.supportsExposure && cameraState.maxExposure > cameraState.minExposure && <View style={{ gap: 10 }}>
                  <View style={styles.settingRow}><Text style={styles.settingLabel}>Exposição</Text><Text style={styles.cameraValue}>{cameraState.exposure >= 0 ? '+' : ''}{cameraState.exposure.toFixed(1)} EV</Text></View>
                  <StudioCaptureZoom controlName="exposição" value={(cameraState.exposure - cameraState.minExposure) / (cameraState.maxExposure - cameraState.minExposure)}
                    onChange={value => cameraControls.setExposure(cameraState.minExposure + value * (cameraState.maxExposure - cameraState.minExposure))}
                    label={cameraState.exposure >= 0 ? `+${cameraState.exposure.toFixed(1)} EV` : `${cameraState.exposure.toFixed(1)} EV`}
                    disabled={!idle || cameraControls.busy || cameraState.exposureLocked} style={{ position: 'relative', alignSelf: 'center', width: '100%' }} />
                  <Text style={styles.cameraHint}>{cameraState.exposureLocked ? 'A exposição acompanha o bloqueio de foco. Toque no quadro para liberar.' : 'Deslize para clarear ou escurecer a imagem.'}</Text>
                </View>}
                {cameraState.aperture !== null && <View style={styles.settingRow}><Text style={styles.settingLabel}>Abertura da lente</Text>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}><Text style={styles.cameraValue}>f/{cameraState.aperture.toFixed(1)}</Text><Text style={styles.cameraHint}>Fixa nesta câmera</Text></View>
                </View>}
                {cameraState.supportsFocus && <Text style={styles.cameraHint}>{cameraState.supportsFocusLock ? 'Toque na imagem para focar. Segure para bloquear o foco.' : 'Toque na imagem para escolher o foco.'}</Text>}
              </>}
            </>}
            {panel === 'script' && !!project && <>
              <StudioCaptureScriptPanel project={project} disabled={!idle || !permitted} onApplied={saved => {
                setShowScript(!!saved.script.trim()); scriptOffset.current = 0;
                scriptScroll.current?.scrollTo({ y: 0, animated: false }); setPanel(null);
              }} />
              {scriptPresent && <>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: showScript }} onPress={() => setShowScript(previous => !previous)} style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Mostrar roteiro</Text><View style={[styles.toggle, showScript && styles.toggleActive]}><View style={[styles.toggleThumb, showScript && { alignSelf: 'flex-end' }]} /></View>
                </Pressable>
                <Pressable accessibilityRole="switch" accessibilityState={{ checked: followScript }} onPress={() => setFollowScript(previous => !previous)} style={styles.settingRow}>
                  <Text style={styles.settingLabel}>Rolagem automática</Text><View style={[styles.toggle, followScript && styles.toggleActive]}><View style={[styles.toggleThumb, followScript && { alignSelf: 'flex-end' }]} /></View>
                </Pressable>
                <View style={styles.settingRow}><Text style={styles.settingLabel}>Ritmo de leitura</Text><View style={styles.speedControl}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Ler mais devagar" onPress={() => setScriptSpeed(previous => Math.max(12, previous - 8))} disabled={scriptSpeed <= 12} style={styles.speedButton}><Minus size={18} color={colors.text} /></Pressable>
                  <Text style={styles.speedLabel}>{scriptSpeed < 28 ? 'Calmo' : scriptSpeed <= 44 ? 'Natural' : 'Rápido'}</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Ler mais rápido" onPress={() => setScriptSpeed(previous => Math.min(76, previous + 8))} disabled={scriptSpeed >= 76} style={styles.speedButton}><Plus size={18} color={colors.text} /></Pressable>
                </View></View>
              </>}
            </>}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SheetModal>
  </View>;
}

function CaptureTool({ children, label, onPress, disabled = false, selected = false }: {
  children: ReactNode; label: string; onPress: () => void; disabled?: boolean; selected?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.tool, selected && styles.toolSelected, disabled && styles.disabled, pressed && styles.pressed]}>{children}</Pressable>;
}
function CaptureMessage({ icon, title, detail, actionLabel, onAction, disabled }: {
  icon: ReactNode; title: string; detail: string; actionLabel: string; onAction: () => void; disabled?: boolean;
}) {
  const dimensions = useWindowDimensions();
  const compact = dimensions.width > dimensions.height;
  return <View style={[styles.message, compact && { maxWidth: 430, gap: 12 }]}>
    {!compact && <View style={styles.messageIcon}>{icon}</View>}<Text style={[styles.messageTitle, compact && { fontSize: 21, lineHeight: 26 }]}>{title}</Text><Text style={styles.messageDetail}>{detail}</Text>
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onAction} style={({ pressed }) => [styles.secondaryButton, disabled && styles.disabled, pressed && styles.pressed]}>
      <Text style={styles.buttonText}>{actionLabel}</Text><ChevronRight size={17} color={colors.text} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000000' },
  topShade: { position: 'absolute', left: 0, right: 0, top: 0 },
  bottomShade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  rightShade: { position: 'absolute', top: 0, bottom: 0, right: 0 },
  topControls: { position: 'absolute', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', height: 70 },
  topActionSlot: { width: 68, alignItems: 'flex-start' },
  captureIdentity: { position: 'absolute', top: 0, left: '50%', width: 200, transform: [{ translateX: -100 }], alignItems: 'center', gap: 8 },
  timerPill: { minHeight: 38, paddingHorizontal: 16, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.38)', flexDirection: 'row', alignItems: 'center', gap: 8 },
  timerPillActive: { backgroundColor: 'rgba(225,29,72,0.86)' },
  timer: { color: colors.text, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], letterSpacing: 0.8 },
  recordDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FFFFFF' },
  takeLabel: { color: '#F0F0F0', fontSize: 9, fontWeight: '600', letterSpacing: 1.3, textShadowColor: 'rgba(0,0,0,0.45)', textShadowRadius: 4, textShadowOffset: { width: 0, height: 1 } },
  qualityCluster: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  fpsPill: { minWidth: 38, height: 38, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  cameraToolLabel: { fontSize: 7, fontWeight: '500', color: '#E1E1E1', marginTop: 2 },
  qualityPill: { minWidth: 48, height: 38, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 13 },
  qualityText: { color: colors.text, fontSize: 12, fontWeight: '600', letterSpacing: 0.6 },
  gate: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 48, paddingTop: 106, paddingBottom: 180 },
  message: { alignItems: 'center', gap: 16, maxWidth: 350 },
  messageIcon: { width: 76, height: 76, borderRadius: 38, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', backgroundColor: 'rgba(255,255,255,0.035)', alignItems: 'center', justifyContent: 'center' },
  messageTitle: { color: colors.text, fontSize: 23, lineHeight: 28, fontWeight: '600', textAlign: 'center', letterSpacing: -0.6 },
  messageDetail: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  tools: { position: 'absolute', gap: 10 },
  tool: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center' },
  toolSelected: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(0,0,0,0.58)' },
  toolValue: { position: 'absolute', bottom: 5, right: 6, fontSize: 8, color: colors.text, fontWeight: '700', backgroundColor: '#333333', borderRadius: 4, minWidth: 11, textAlign: 'center' },
  prompter: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.52)', borderRadius: 14, paddingHorizontal: 16, paddingTop: 9, paddingBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  prompterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 },
  prompterIdentity: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prompterLabel: { color: '#D9D3DC', fontSize: 8, letterSpacing: 1.7, fontWeight: '600' },
  prompterAction: { width: 28, height: 26, justifyContent: 'center', alignItems: 'center' },
  scriptScroll: { flexShrink: 1 },
  scriptText: { color: '#FFFFFF', fontSize: 22, lineHeight: 32, fontWeight: '500', paddingBottom: 32 },
  zoomAnchor: { position: 'absolute', width: 210, alignItems: 'center', justifyContent: 'flex-end' },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.26)' },
  countdownNumber: { color: '#FFFFFF', fontSize: 110, fontWeight: '300', fontVariant: ['tabular-nums'] },
  countdownLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 8 },
  portraitDock: { position: 'absolute', gap: 12 },
  portraitRecordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', minHeight: 88 },
  dockSide: { width: 76, alignItems: 'center', justifyContent: 'center' },
  portraitFinish: { height: 28, alignItems: 'center', justifyContent: 'center' },
  guidance: { color: '#EEEEEE', fontSize: 11, fontWeight: '500', textAlign: 'center', textShadowColor: '#000000', textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } },
  firstTakeLabel: { color: '#ADADAD', fontSize: 10 },
  landscapeDock: { position: 'absolute', width: 100, justifyContent: 'flex-end', alignItems: 'center', gap: 10 },
  landscapeRecord: { flex: 1, minHeight: 90, alignItems: 'center', justifyContent: 'center', gap: 9 },
  recordCaption: { color: colors.text, fontSize: 10, fontWeight: '600' },
  landscapeSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  takesDock: { position: 'absolute' },
  recordButton: { width: 86, height: 86, borderRadius: 43, borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.12)' },
  recordButtonActive: { borderColor: 'rgba(255,255,255,0.82)' },
  recordInner: { width: 70, height: 70, borderRadius: 35, backgroundColor: '#E11D48' },
  recordStop: { width: 32, height: 32, borderRadius: 7, backgroundColor: '#E11D48' },
  recordPressed: { transform: [{ scale: 0.95 }] },
  statusToast: { position: 'absolute', padding: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', backgroundColor: 'rgba(9,9,9,0.9)', gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusText: { color: colors.textSecondary, fontSize: 11, lineHeight: 17, flexShrink: 1 },
  failure: { color: '#F6B6C4' },
  recoveryButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 10, gap: 8, backgroundColor: '#282828' },
  recoveryLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  podcastCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 18, paddingTop: 75, paddingBottom: 190 },
  micCircle: { width: 116, height: 116, borderRadius: 58, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  podcastTitle: { color: colors.text, fontSize: 25, lineHeight: 32, fontWeight: '600', textAlign: 'center', letterSpacing: -0.8 },
  podcastCaption: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  meterRow: { height: 78, flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  meterBar: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#635C6D' },
  panelSurface: { alignSelf: 'center' },
  cameraValue: { color: colors.text, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  cameraHint: { color: colors.muted, fontSize: 11, lineHeight: 18 },
  panelTitle: { color: colors.text, fontSize: 19, fontWeight: '600', letterSpacing: -0.4 },
  panelDetail: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  optionRow: { flexDirection: 'row', gap: 10 },
  option: { flex: 1, height: 50, borderRadius: 12, backgroundColor: '#191919', borderWidth: 1, borderColor: '#292929', alignItems: 'center', justifyContent: 'center' },
  optionSelected: { backgroundColor: '#F2F2F2', borderColor: '#F2F2F2' },
  optionText: { color: '#C9C9C9', fontSize: 15, fontWeight: '600' },
  optionTextSelected: { color: '#111111' },
  qualityOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 16, borderRadius: 12, backgroundColor: '#141414', borderWidth: 1, borderColor: '#292929' },
  qualityOptionSelected: { borderColor: '#707070', backgroundColor: '#202020' },
  qualityOptionTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  qualityOptionDetail: { color: colors.muted, fontSize: 11 },
  settingRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  settingLabel: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
  toggle: { width: 44, height: 26, padding: 3, borderRadius: 13, backgroundColor: '#333333' },
  toggleActive: { backgroundColor: '#E11D48' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF' },
  speedControl: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, backgroundColor: '#202020' },
  speedButton: { width: 36, height: 40, justifyContent: 'center', alignItems: 'center' },
  speedLabel: { color: colors.textSecondary, fontSize: 11, minWidth: 52, textAlign: 'center' },
  primaryButton: { minHeight: controls.buttonMinHeight, paddingHorizontal: 22, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: controls.buttonRadius, backgroundColor: colors.accent },
  secondaryButton: { minHeight: controls.buttonMinHeight, paddingHorizontal: 18, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: controls.buttonRadius, backgroundColor: '#252428', alignSelf: 'center' },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.32 },
});
