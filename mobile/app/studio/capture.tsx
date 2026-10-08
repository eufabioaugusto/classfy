import { Audio } from 'expo-av';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import * as Device from 'expo-device';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useIsFocused, usePreventRemove, type NavigationAction } from '@react-navigation/native';
import { Camera, Check, FileText, FlipHorizontal2, Mic, Minus, Pause, Play, Plus, Settings, Square, Zap, ZapOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { useAuth } from '@/features/auth/authContext';
import { persistStudioTake } from '@/features/studio/media';
import { formatStudioDuration, type StudioProject } from '@/features/studio/model';
import { getStudioProject, updateStudioProject } from '@/features/studio/store';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';

type Phase = 'idle' | 'countdown' | 'recording' | 'saving';
type RecoverableTake = { project: StudioProject; uri: string; duration: number };

export default function StudioCaptureScreen() {
  const params = useLocalSearchParams<{ id: string }>();
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
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [showScript, setShowScript] = useState(true);
  const [followScript, setFollowScript] = useState(true);
  const [scriptSpeed, setScriptSpeed] = useState(28);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoverableTake | null>(null);
  const camera = useRef<CameraView>(null);
  const audio = useRef<Audio.Recording | null>(null);
  const scriptScroll = useRef<ScrollView>(null);
  const scriptOffset = useRef(0);
  const scriptSize = useRef({ content: 0, viewport: 0 });
  const startedAt = useRef(0);
  const phaseRef = useRef<Phase>('idle');
  const mounted = useRef(true);
  const countdownToken = useRef(0);
  const pendingNavigation = useRef<NavigationAction | null>(null);
  const session = useRef({ owner: user?.id, canPublish, roleLoading });
  session.current = { owner: user?.id, canPublish, roleLoading };
  const stopRef = useRef<() => Promise<void>>(async () => {});
  const activeProject = useRef<StudioProject | null>(null);
  const audioStopping = useRef(false);
  const isAudio = project?.kind === 'podcast';
  const permitted = !!project && project.ownerId === user?.id && canPublish && !roleLoading;
  const busyProject = !!project && ['preparing', 'uploading', 'processing', 'submitted'].includes(project.state);
  const microphoneGranted = !!microphonePermission?.granted;
  const permissionGranted = microphoneGranted && (isAudio || !!cameraPermission?.granted);
  const permissionBlocked = !!microphonePermission && !microphonePermission.granted && !microphonePermission.canAskAgain
    || !isAudio && !!cameraPermission && !cameraPermission.granted && !cameraPermission.canAskAgain;

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
  async function saveTake(target: StudioProject, uri: string, duration: number) {
    transition('saving');
    const recoverable = { project: target, uri, duration };
    try {
      assertSession(target);
      const latest = getStudioProject(target.ownerId, target.id);
      if (!latest) throw new Error('Não foi possível encontrar o projeto desta gravação.');
      const take = await persistStudioTake(latest, { uri, name: `Take ${latest.takes.length + 1}`, duration });
      assertSession(target);
      const current = getStudioProject(target.ownerId, target.id);
      if (!current) throw new Error('O projeto desta gravação não está disponível.');
      await updateStudioProject(target.ownerId, target.id, {
        takes: [...current.takes, take],
        ...(!current.coverUri && !current.coverUrl && take.thumbnailUri ? { coverUri: take.thumbnailUri } : {}),
      });
      if (mounted.current) {
        setRecovery(null); setFailure(null);
        setNotice(`Take ${current.takes.length + 1} salvo no projeto. Pode gravar o próximo.`);
      }
    } catch (cause) {
      pendingNavigation.current = null;
      if (mounted.current) {
        setRecovery(recoverable);
        setFailure(cause instanceof Error ? cause.message : 'Não foi possível salvar o take. Tente novamente.');
      }
    } finally { activeProject.current = null; transition('idle'); }
  }

  async function stopRecording() {
    if (phaseRef.current === 'countdown') { countdownToken.current++; transition('idle'); return; }
    if (phaseRef.current !== 'recording') return;
    if (activeProject.current?.kind !== 'podcast') {
      // recordAsync owns the file promise; stopping it resolves that promise for saveTake.
      camera.current?.stopRecording();
      transition('saving');
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
            void saveTake(recovery.project, recovery.uri, recovery.duration);
          } },
          { text: 'Sair sem salvar', style: 'destructive', onPress: () => {
            pendingNavigation.current = data.action;
            setRecovery(null);
          } },
        ]);
      return;
    }
    if (phaseRef.current === 'saving') {
      Alert.alert('Salvando seu take', 'Aguarde a gravação ser salva antes de sair.');
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
          if (mounted.current) setNotice('Gravação interrompida. O take está sendo salvo.');
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
    if (!focused || !project) return;
    let active = true;
    let previous = ScreenOrientation.OrientationLock.PORTRAIT_UP;
    const operation = (async () => {
      try {
        const policy = await ScreenOrientation.getOrientationLockAsync();
        if (policy !== ScreenOrientation.OrientationLock.OTHER && policy !== ScreenOrientation.OrientationLock.UNKNOWN) previous = policy;
        if (!active) return;
        if (project.kind === 'aula') await ScreenOrientation.unlockAsync();
        else await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch { /* The camera still uses responsive sensor orientation on older builds. */ }
    })();
    return () => {
      active = false;
      void operation.then(() => ScreenOrientation.lockAsync(previous)).catch(() => {});
    };
  }, [focused, project?.id, project?.kind]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      countdownToken.current++;
      // Native navigation is guarded; this also covers parent teardown/sign-out.
      void stopRef.current();
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
    if (!project || phaseRef.current !== 'idle' || recovery || busyProject) return;
    try {
      assertSession(project);
      if (!permissionGranted) { await enablePermissions(); return; }
      if (!Device.isDevice || !isAudio && !ready) return;
      setFailure(null); setNotice(null); setElapsed(0);
      activeProject.current = project;
      transition('countdown');
      const token = ++countdownToken.current;
      for (let value = 3; value > 0; value--) {
        setCountdown(value);
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (token !== countdownToken.current || !mounted.current) return;
      }
      assertSession(project);
      startedAt.current = Date.now();
      scriptOffset.current = 0;
      scriptScroll.current?.scrollTo({ y: 0, animated: false });
      if (isAudio) {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const recording = new Audio.Recording();
        audio.current = recording;
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        if (token !== countdownToken.current || !mounted.current || AppState.currentState !== 'active') {
          await recording.stopAndUnloadAsync(); audio.current = null;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          transition('idle'); return;
        }
        recording.setOnRecordingStatusUpdate(status => {
          if (mounted.current && status.canRecord) setElapsed(status.durationMillis / 1000);
          if (status.isDoneRecording && phaseRef.current === 'recording') void stopRef.current();
        });
        await recording.startAsync();
        if (token !== countdownToken.current || !mounted.current || AppState.currentState !== 'active') {
          await recording.stopAndUnloadAsync(); audio.current = null;
          await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
          transition('idle'); return;
        }
        transition('recording');
      } else {
        if (!camera.current) throw new Error('A câmera ainda está preparando a imagem. Tente novamente.');
        transition('recording');
        const result = await camera.current.recordAsync({ codec: 'avc1' });
        if (!result?.uri) throw new Error('A câmera não entregou um arquivo. Grave um novo take.');
        await saveTake(project, result.uri, (Date.now() - startedAt.current) / 1000);
      }
    } catch (cause) {
      pendingNavigation.current = null;
      const recording = audio.current;
      audio.current = null;
      if (recording) { try { await recording.stopAndUnloadAsync(); } catch {} }
      if (isAudio) { try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {} }
      activeProject.current = null;
      if (mounted.current) setFailure(cause instanceof Error ? cause.message : 'Não foi possível iniciar a gravação.');
      transition('idle');
    }
  }

  const header = <NavigationHeader title={isAudio ? 'Gravar podcast' : 'Gravar aula'} back right={
    <View style={styles.quality}><Text style={styles.qualityText}>{isAudio ? 'ÁUDIO' : '1080p'}</Text></View>
  } />;
  if (loading || roleLoading) return <AppScreen scroll={false} header={header}><ActivityIndicator color={colors.muted} /></AppScreen>;
  if (!project || !permitted) return <AppScreen header={header}><Text style={styles.notice}>{error || 'Entre na conta creator que criou este projeto para gravar.'}</Text></AppScreen>;
  if (!Device.isDevice) return <AppScreen header={header}>
    <View style={styles.deviceState}><Camera color={colors.muted} size={48} strokeWidth={1.3} />
      <Text style={styles.deviceTitle}>A câmera precisa do seu iPhone</Text>
      <Text style={styles.deviceDetail}>No simulador, importe um vídeo ou áudio para experimentar a edição. A gravação fica disponível no aparelho.</Text>
      <Pressable onPress={() => router.back()} style={styles.secondaryButton}><Text style={styles.buttonText}>Voltar ao projeto</Text></Pressable>
    </View>
  </AppScreen>;
  if (!permissionGranted) return <AppScreen header={header}>
    <View style={styles.deviceState}>
      {isAudio ? <Mic color={colors.muted} size={48} strokeWidth={1.3} /> : <Camera color={colors.muted} size={48} strokeWidth={1.3} />}
      <Text style={styles.deviceTitle}>{isAudio ? 'Sua voz, em primeiro plano' : 'Pronto para ensinar'}</Text>
      <Text style={styles.deviceDetail}>{isAudio ? 'Permita o microfone para gravar seu podcast.' : 'Permita a câmera e o microfone para gravar suas aulas. Você controla quando a gravação começa.'}</Text>
      <Pressable onPress={() => void enablePermissions()} style={styles.primaryButton}>
        {permissionBlocked && <Settings color={colors.text} size={19} />}<Text style={styles.buttonText}>{permissionBlocked ? 'Abrir Ajustes' : 'Permitir e continuar'}</Text>
      </Pressable>
      {!!failure && <Text style={styles.failure}>{failure}</Text>}
    </View>
  </AppScreen>;

  return <AppScreen scroll={false} edgeToEdge header={header}>
    <View style={[styles.captureBody, landscape && styles.landscapeBody]}>
      <View style={styles.stage}>
      <View style={[styles.preview, landscape && styles.landscapePreview, project.kind === 'short' && styles.portraitPreview, isAudio && styles.audioPreview]}>
        {!isAudio && focused && foreground && <CameraView ref={camera} style={StyleSheet.absoluteFill}
          facing={facing} mode="video" videoQuality="1080p" videoStabilizationMode="auto"
          enableTorch={torch && facing === 'back'} mirror={false} responsiveOrientationWhenOrientationLocked
          onCameraReady={() => setReady(true)} onMountError={() => { setReady(false); setFailure('Não foi possível iniciar a câmera. Confira as permissões ou tente importar um vídeo.'); }} />}
        {isAudio && <View style={styles.audioCenter}><Mic color={phase === 'recording' ? colors.accent : colors.textSecondary} size={64} strokeWidth={1.2} /><Text style={styles.audioCaption}>{phase === 'recording' ? 'Gravando sua voz' : 'Um conhecimento, uma conversa'}</Text></View>}
        <View style={styles.previewTop}>
          <View style={styles.takePill}><Text style={styles.pillText}>Take {project.takes.length + 1}</Text></View>
          <View style={styles.timePill}>{phase === 'recording' && <View style={styles.recordDot} />}<Text style={styles.timer}>{formatStudioDuration(elapsed)}</Text></View>
        </View>
        {phase === 'countdown' && <View style={styles.countdownOverlay}><Text style={styles.countdownNumber}>{countdown}</Text><Text style={styles.countdownLabel}>Respire. Sua aula começa agora.</Text></View>}
        {!!project.script.trim() && showScript && <View style={styles.prompter}>
          <View style={styles.prompterHeader}><Text style={styles.prompterLabel}>SEU ROTEIRO</Text>
            <Pressable accessibilityLabel={followScript ? 'Pausar rolagem do roteiro' : 'Ativar rolagem do roteiro'} onPress={() => setFollowScript(!followScript)} hitSlop={12}>
              {followScript ? <Pause color={colors.textSecondary} size={17} /> : <Play color={colors.textSecondary} size={17} />}
            </Pressable>
          </View>
          <ScrollView ref={scriptScroll} style={[styles.scriptScroll, landscape && { maxHeight: 62 }]} showsVerticalScrollIndicator={false}
            onLayout={event => { scriptSize.current.viewport = event.nativeEvent.layout.height; }}
            onContentSizeChange={(_, height) => { scriptSize.current.content = height; }}
            onScroll={event => { scriptOffset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
            onScrollBeginDrag={() => setFollowScript(false)}>
            <Text style={styles.scriptText}>{project.script.trim()}</Text>
          </ScrollView>
        </View>}
      </View>
      <View style={styles.toolRow}>
        {!isAudio && <>
          <Pressable accessibilityLabel="Alternar câmera" disabled={phase !== 'idle'} onPress={() => { setReady(false); setFacing(facing === 'front' ? 'back' : 'front'); setTorch(false); }} style={[styles.tool, phase !== 'idle' && styles.disabled]}><FlipHorizontal2 size={22} color={colors.textSecondary} strokeWidth={1.5} /></Pressable>
          <Pressable accessibilityLabel={torch ? 'Desligar luz' : 'Ligar luz'} disabled={facing !== 'back' || phase !== 'idle'} onPress={() => setTorch(!torch)} style={[styles.tool, (facing !== 'back' || phase !== 'idle') && styles.disabled]}>{torch ? <Zap size={21} color={colors.amber} strokeWidth={1.5} /> : <ZapOff size={21} color={colors.textSecondary} strokeWidth={1.5} />}</Pressable>
        </>}
        {!!project.script.trim() && <>
          <Pressable accessibilityLabel={showScript ? 'Ocultar roteiro' : 'Mostrar roteiro'} onPress={() => setShowScript(!showScript)} style={[styles.tool, showScript && styles.toolSelected]}><FileText size={21} color={colors.textSecondary} strokeWidth={1.5} /></Pressable>
          {showScript && <View style={styles.speedControl}><Pressable accessibilityLabel="Ler mais devagar" onPress={() => setScriptSpeed(Math.max(12, scriptSpeed - 8))} style={styles.speedButton}><Minus size={16} color={colors.muted} /></Pressable><Text style={styles.speedLabel}>Ritmo</Text><Pressable accessibilityLabel="Ler mais rápido" onPress={() => setScriptSpeed(Math.min(76, scriptSpeed + 8))} style={styles.speedButton}><Plus size={16} color={colors.muted} /></Pressable></View>}
        </>}
      </View>
      </View>
      <View style={[styles.capturePanel, landscape && styles.landscapePanel]}>
      <Text style={styles.guidance}>{phase === 'saving' ? 'Salvando o original no seu projeto…' : phase === 'recording' ? 'Toque para encerrar e salvar este take.' : phase === 'countdown' ? 'Toque para cancelar a contagem.' : isAudio ? 'Grave em partes. Depois, escolha os melhores takes.' : project.kind === 'short' ? 'Grave na vertical. Seu aprendizado em até 3 minutos.' : 'Vire o iPhone para gravar na horizontal. Faça uma ideia por take.'}</Text>
      {!!notice && <View accessibilityLiveRegion="polite" style={styles.noticeRow}><Check size={16} color={colors.free} /><Text style={styles.noticeText}>{notice}</Text></View>}
      {!!failure && <Text accessibilityLiveRegion="polite" style={styles.failure}>{failure}</Text>}
      {recovery && <Pressable style={styles.secondaryButton} onPress={() => void saveTake(recovery.project, recovery.uri, recovery.duration)} disabled={phase !== 'idle'}><Text style={styles.buttonText}>Tentar salvar o take novamente</Text></Pressable>}
      <View style={[styles.recordControls, { paddingBottom: landscape ? 14 : Math.max(insets.bottom, 18) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={phase === 'recording' ? 'Encerrar e salvar take' : phase === 'countdown' ? 'Cancelar contagem' : 'Começar gravação'}
          disabled={phase === 'saving' || !!recovery || busyProject || !isAudio && !ready}
          onPress={() => { if (phase === 'recording' || phase === 'countdown') void stopRecording(); else void beginRecording(); }}
          style={[styles.recordButton, (phase === 'saving' || !!recovery || busyProject || !isAudio && !ready) && styles.disabled]}>
          {phase === 'saving' ? <ActivityIndicator color={colors.text} /> : phase === 'recording' ? <Square size={26} fill={colors.accent} color={colors.accent} /> : phase === 'countdown' ? <Square size={23} color={colors.textSecondary} /> : <View style={styles.recordInner} />}
        </Pressable>
        <Text style={styles.recordLabel}>{phase === 'saving' ? 'Salvando' : phase === 'recording' ? 'Encerrar take' : phase === 'countdown' ? 'Cancelar' : 'Gravar take'}</Text>
      </View>
      </View>
    </View>
  </AppScreen>;
}

const styles = StyleSheet.create({
  quality: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 8 },
  qualityText: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  captureBody: { flex: 1, paddingHorizontal: 16, gap: 12 },
  landscapeBody: { flexDirection: 'row', paddingBottom: 8 },
  stage: { flex: 1, gap: 8 },
  capturePanel: { gap: 12 },
  landscapePanel: { width: 172, justifyContent: 'center', flexShrink: 0 },
  preview: { flex: 1, minHeight: 180, borderRadius: 20, overflow: 'hidden', backgroundColor: '#101010', marginTop: 8 },
  landscapePreview: { minHeight: 100 },
  portraitPreview: { alignSelf: 'center', width: '100%', maxWidth: 340 },
  audioPreview: { backgroundColor: '#111012', borderWidth: 1, borderColor: colors.borderSubtle },
  audioCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingBottom: 40 },
  audioCaption: { color: colors.muted, fontSize: 14 },
  previewTop: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  takePill: { backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  pillText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  timePill: { backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  timer: { color: colors.text, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  recordDot: { height: 6, width: 6, borderRadius: 3, backgroundColor: colors.accent },
  countdownOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
  countdownNumber: { color: colors.text, fontSize: 82, fontWeight: '300', fontVariant: ['tabular-nums'] },
  countdownLabel: { color: colors.textSecondary, fontSize: 13, marginTop: 12 },
  prompter: { position: 'absolute', bottom: 16, left: 16, right: 16, backgroundColor: 'rgba(0,0,0,0.72)', borderRadius: 16, padding: 14 },
  prompterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  prompterLabel: { color: '#D0C5B9', fontSize: 9, letterSpacing: 1.7, fontWeight: '600' },
  scriptScroll: { maxHeight: 124 },
  scriptText: { color: '#F5EFE8', fontSize: 21, lineHeight: 31, fontWeight: '500', paddingBottom: 35 },
  toolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  tool: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  toolSelected: { backgroundColor: colors.surface },
  speedControl: { flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderWidth: 1, borderColor: colors.borderSubtle },
  speedButton: { width: 34, height: 40, justifyContent: 'center', alignItems: 'center' },
  speedLabel: { color: colors.muted, fontSize: 11 },
  guidance: { color: colors.muted, textAlign: 'center', fontSize: 12, lineHeight: 18, paddingHorizontal: 10 },
  noticeRow: { flexDirection: 'row', alignItems: 'center', gap: 7, justifyContent: 'center' },
  noticeText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, flexShrink: 1 },
  notice: { color: colors.muted, lineHeight: 22 },
  failure: { color: '#F5A3B4', textAlign: 'center', fontSize: 12, lineHeight: 18 },
  recordControls: { alignItems: 'center', gap: 10, paddingTop: 3 },
  recordButton: { height: 74, width: 74, borderRadius: 37, borderWidth: 2, borderColor: '#EEEEEE', alignItems: 'center', justifyContent: 'center' },
  recordInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent },
  recordLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  disabled: { opacity: 0.35 },
  deviceState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingTop: 70 },
  deviceTitle: { fontSize: 23, color: colors.text, textAlign: 'center', fontWeight: '600', letterSpacing: -0.5 },
  deviceDetail: { color: colors.muted, fontSize: 14, lineHeight: 23, textAlign: 'center', maxWidth: 315 },
  primaryButton: { minHeight: controls.buttonMinHeight, paddingHorizontal: 22, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', borderRadius: controls.buttonRadius, backgroundColor: colors.accent },
  secondaryButton: { minHeight: controls.buttonMinHeight, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', borderRadius: controls.buttonRadius, backgroundColor: colors.surface, alignSelf: 'center' },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
