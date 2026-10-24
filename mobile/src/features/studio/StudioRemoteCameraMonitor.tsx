import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
  type GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronRight, CloudUpload, Mic, Monitor, MoreHorizontal, RotateCw, Unplug, X } from 'lucide-react-native';
import { StudioCaptureAudioMonitor, type StudioCaptureAudioMonitorProps } from './StudioCaptureAudioMonitor';
import { StudioCaptureStorageMonitor } from './StudioCaptureStorageMonitor';
import { remoteCameraFocusPoint, remoteCameraModalOrientations, remoteCameraMonitorLayout, remoteCameraQualityLabel, type RemoteCameraFocusPoint } from './remoteCameraMonitorLayout';
import type { RemoteCameraSnapshot } from './remoteCameraController';
import type { StudioAudioInputState } from '../../../modules/classfy-studio-media';
import { remoteCameraAudioInputSelected, remoteCameraAudioInputState, remoteCameraAudioPortLabel } from './remoteCameraAudioPicker';

type Props = {
  children: ReactNode; state: RemoteCameraSnapshot; audio: StudioCaptureAudioMonitorProps; active: boolean;
  captureScope: string; elapsed: number; error?: string | null; canUnpair: boolean;
  onClose(): void; onStop(): void; onUpload(): void; onReconnect(): void; onUnpair(): void;onLocalTakes?():void;
  onFocus(point: RemoteCameraFocusPoint): Promise<unknown>; onFocusError(message: string): void;
  onAudioSelect?(id: string | null): Promise<StudioAudioInputState>;
};

/** Camera-first monitor: only status, metering and REC remain over the scene. */
export function StudioRemoteCameraMonitor({ children, state, audio, active, captureScope, elapsed, error, canUnpair,
  onClose, onStop, onUpload, onReconnect, onUnpair, onLocalTakes, onFocus, onFocusError, onAudioSelect }: Props) {
  const window = useWindowDimensions(), insets = useSafeAreaInsets();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const [menu, setMenu] = useState(false), [reticle, setReticle] = useState<RemoteCameraFocusPoint | null>(null);
  const [audioMenu, setAudioMenu] = useState(false), [audioSelecting, setAudioSelecting] = useState<{ id: string | null } | null>(null), [audioError, setAudioError] = useState('');
  const recording = ['starting', 'recording', 'saving'].includes(state.phase), saving = state.phase === 'saving';
  const layout = remoteCameraMonitorLayout(size, insets, recording);
  const scope = useRef({ captureScope, active, width: size.width, height: size.height, mounted: true, epoch: 0 });
  if (scope.current.captureScope !== captureScope || scope.current.active !== active
    || scope.current.width !== size.width || scope.current.height !== size.height) scope.current.epoch++;
  scope.current = { ...scope.current, captureScope, active, width: size.width, height: size.height };
  const focusSequence = useRef(0), hide = useRef<ReturnType<typeof setTimeout> | null>(null), held = useRef(false);
  const audioSequence = useRef(0), audioOperation = useRef<number | null>(null);
  const audioProtected = useRef(false); audioProtected.current = recording || state.processing === true;
  const capabilities = state.state?.capabilities;
  const audioInputs = remoteCameraAudioInputState(state.state?.audioInput);
  const supportsAudioSelection = state.state?.supportsAudioInputSelection === true || capabilities?.audioInputSelection === true;
  const audioBlocked = !active || recording || state.processing === true || audioInputs?.selecting === true || !!audioSelecting;
  const audioPortsKey = audioInputs?.available.map(input => input.id).join('\u0000');
  useEffect(() => { setAudioError(''); }, [audioInputs?.current?.id, audioInputs?.preferredId, audioInputs?.warning, audioPortsKey]);
  const canFocus = state.state?.supportsFocus === true || capabilities?.supportsFocus === true;
  const canLockFocus = state.state?.supportsFocusLock === true || capabilities?.supportsFocusLock === true;
  useEffect(() => {
    setReticle(null); setMenu(false); setAudioMenu(false); setAudioSelecting(null); setAudioError(''); audioOperation.current = null; audioSequence.current++; held.current = false;
    if (hide.current) clearTimeout(hide.current); hide.current = null;
  }, [captureScope, active, size.width, size.height]);
  useEffect(() => { if (recording || !active || state.processing) {
    setMenu(false); setAudioMenu(false); audioSequence.current++; audioOperation.current = null; setAudioSelecting(null);
  } }, [recording, active, state.processing]);
  useEffect(() => { scope.current.mounted = true; return () => {
    scope.current.mounted = false; scope.current.epoch++; if (hide.current) clearTimeout(hide.current);
  }; }, []);
  async function focus(event: GestureResponderEvent, locked: boolean) {
    if (!active || !canFocus || locked && !canLockFocus) return;
    const point = remoteCameraFocusPoint({ x: event.nativeEvent.locationX, y: event.nativeEvent.locationY }, size,
      { width: Number(state.state?.width || 0), height: Number(state.state?.height || 0) }, locked);
    if (!point) return;
    const epoch = scope.current.epoch, request = ++focusSequence.current;
    const current = () => scope.current.mounted && scope.current.active && scope.current.epoch === epoch && focusSequence.current === request;
    try {
      await onFocus(point); if (!current()) return;
      if (hide.current) clearTimeout(hide.current);
      setReticle(point);
      if (!locked) hide.current = setTimeout(() => { if (current()) setReticle(null); }, 1600);
    } catch (cause) { if (current()) onFocusError(cause instanceof Error ? cause.message : 'Não foi possível ajustar o foco.'); }
  }
  async function selectAudioInput(id: string | null) {
    if (audioBlocked || audioOperation.current !== null || !supportsAudioSelection || !onAudioSelect || !audioInputs
      || id !== null && !audioInputs.available.some(input => input.id === id)) return;
    const epoch = scope.current.epoch, request = ++audioSequence.current;
    audioOperation.current = request; setAudioSelecting({ id }); setAudioError('');
    const current = () => scope.current.mounted && scope.current.active && !audioProtected.current && scope.current.epoch === epoch && audioSequence.current === request;
    try {
      const receipt = remoteCameraAudioInputState(await onAudioSelect(id)); if (!current()) return;
      if (!receipt) throw new Error('A câmera não confirmou a entrada de áudio.');
      // The subscribed native snapshot remains the only selected state. A
      // preferred port alone never moves the checkmark or invents active PCM.
      if (!remoteCameraAudioInputSelected(receipt, id)) setAudioError(receipt.warning || 'A entrada ainda não foi confirmada pelo iPhone. Confira o microfone.');
    } catch (cause) { if (current()) setAudioError(cause instanceof Error ? cause.message : 'Não foi possível alterar o microfone.'); }
    finally { if (audioOperation.current === request) audioOperation.current = null; if (current()) setAudioSelecting(null); }
  }
  const percent = state.uploadTotalBytes ? Math.min(100, Math.floor((state.uploadProgressBytes || 0) / state.uploadTotalBytes * 100)) : 0;
  const processingPercent = Math.min(100, Math.max(0, Math.floor((state.processingProgress || 0) * 100)));
  const transfer = state.processing ? `${state.processingStage === 'validating' ? 'Conferindo original' : 'Preparando take'} · ${processingPercent}%`
    : state.uploading ? `Enviando original · ${percent}%`
    : state.uploadState === 'paused' ? 'Envio pausado · original preservado'
      : state.uploadState === 'complete' ? 'Original enviado' : state.localTakes?.length ? 'Take salvo neste iPhone · envio opcional' : null;
  const needsUpload = state.uploadState === 'paused' || !!state.uploadPendingCount;
  const audioDescription = [`Microfone: ${audio.input?.name || audioInputs?.current?.name || 'Entrada de áudio'}`,
    audio.status === 'live' ? 'Entrada ativa' : audio.status === 'waiting' ? 'Aguardando áudio' : audio.status === 'interrupted' ? 'Áudio interrompido' : 'Monitor indisponível',
    audio.message, recording || state.processing ? 'Escolha o microfone antes de gravar' : supportsAudioSelection ? 'Escolher entrada de áudio' : 'Seleção de entrada indisponível nesta versão',
  ].filter(Boolean).join('. ');
  const quality = remoteCameraQualityLabel(state.state?.width, state.state?.height);
  const timer = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  return <View style={styles.stage} onLayout={event => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
  }}>
    <StatusBar hidden style="light" />
    {children}
    <Pressable testID="remote-camera-focus-surface" accessibilityRole="button" accessibilityLabel="Enquadramento da câmera. Toque para focar, segure para travar o foco."
      accessibilityState={{ disabled: !active || !canFocus }} disabled={!active || !canFocus} style={StyleSheet.absoluteFill}
      onPressIn={() => { held.current = false; }} delayLongPress={650}
      onLongPress={event => { if (canLockFocus) { held.current = true; void focus(event, true); } }}
      onPress={event => { if (!held.current) void focus(event, false); }} />
    {reticle && <View testID="remote-camera-focus-reticle" pointerEvents="none" style={[styles.reticle, {
      left: Math.max(0, Math.min(size.width - 48, reticle.x * size.width - 24)),
      top: Math.max(18, Math.min(size.height - 48, reticle.y * size.height - 24)),
    }]}>{reticle.locked && <Text style={styles.lockLabel}>AF LOCK</Text>}</View>}
    <View pointerEvents="box-none" style={[styles.header, { top: layout.top, left: layout.left, right: layout.right }]}>
      {!recording ? <Pressable accessibilityRole="button" accessibilityLabel="Fechar câmera" onPress={onClose} style={styles.circle}><X size={21} color="#fff" /></Pressable>
        : <View style={styles.headerSlot} />}
      <View accessible accessibilityLiveRegion="none" accessibilityLabel={recording ? `${saving ? 'Salvando' : 'Gravando'} original. ${timer}` : state.previewConnected ? 'Câmera conectada ao Studio' : 'Câmera ativa. Prévia do computador desconectada'}
        style={[styles.status, recording && styles.recordingStatus]}>
        {recording ? <View style={styles.recordDot} /> : <Monitor size={15} color={state.previewConnected ? '#A6E0C0' : '#E4C67F'} />}
        <Text style={styles.statusText}>{state.phase === 'starting' ? 'Preparando REC…' : saving ? 'Salvando…' : recording ? timer : state.previewConnected ? 'Studio conectado' : 'Prévia desconectada'}</Text>
      </View>
      {!recording ? <Pressable accessibilityRole="button" accessibilityLabel="Opções da câmera remota" onPress={() => setMenu(true)} style={styles.circle}><MoreHorizontal size={23} color="#fff" /></Pressable>
        : <View style={styles.headerSlot} />}
    </View>
    {!recording && <View pointerEvents="none" accessible accessibilityLabel={`Original: ${state.state?.width || '—'} por ${state.state?.height || '—'} pixels, ${state.state?.fps || '—'} quadros por segundo`}
      style={[styles.qualityRow, { top: layout.top + 54, right: layout.right }]}>
      <Text style={styles.quality}>{quality}</Text><Text style={styles.fps}>{state.state?.fps || '—'} FPS</Text>
    </View>}
    <View testID="remote-camera-audio-corner" pointerEvents="box-none" style={[styles.audioCorner, { left: layout.left, bottom: layout.audioBottom, width: layout.audioWidth }]}>
      {(!!error || !!transfer) && <Pressable accessibilityRole={recording ? 'text' : 'button'} accessibilityLabel={`${error ? `Aviso da câmera: ${error}` : transfer}${recording ? '' : '. Ver detalhes'}`}
        disabled={recording} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }} onPress={() => setMenu(true)} style={[styles.feedback, !!error && styles.feedbackError]}>
        {(state.uploading || state.processing) && !error ? <ActivityIndicator size="small" color="#E7E7E7" /> : state.uploadState === 'complete' && !error ? <Check size={12} color="#A6E0C0" /> : null}
        <Text accessibilityLiveRegion="polite" numberOfLines={recording ? 3 : 2} style={[styles.feedbackText, !!error && styles.errorText]}>{error || transfer}</Text>
        {!recording && <ChevronRight size={12} color="#C5C5C5" />}
      </Pressable>}
      <Pressable testID="remote-camera-audio-selector" accessibilityRole="button" accessibilityLabel={audioDescription}
        accessibilityState={{ disabled: audioBlocked || !supportsAudioSelection || !onAudioSelect, busy: !!audioSelecting || audioInputs?.selecting === true }}
        disabled={audioBlocked || !supportsAudioSelection || !onAudioSelect} style={styles.audioTarget}
        onPress={() => { setMenu(false); setAudioError(''); setAudioMenu(true); }}>
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden><StudioCaptureAudioMonitor {...audio} compact
          accessory={!recording && !state.processing && supportsAudioSelection ? <ChevronRight size={10} color="#CFCFD3" /> : undefined} /></View>
      </Pressable>
      <StudioCaptureStorageMonitor availableBytes={active ? state.state?.storageAvailableBytes : undefined}
        totalBytes={active ? state.state?.storageTotalBytes : undefined} />
    </View>
    {recording && <View style={[styles.stopPosition, layout.landscape ? { right: layout.right, bottom: layout.bottom } : { bottom: layout.bottom, left: (size.width - 88) / 2 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Encerrar e salvar take" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving}
        onPress={onStop} style={[styles.stopButton, saving && styles.saving]}>{saving ? <ActivityIndicator color="#fff" /> : <View style={styles.stopSquare} />}</Pressable>
      <Text style={styles.stopLabel}>{saving ? 'Salvando' : 'Parar'}</Text>
    </View>}
    <Modal transparent visible={menu && !recording && active} animationType="slide" presentationStyle="overFullScreen" supportedOrientations={remoteCameraModalOrientations} statusBarTranslucent onRequestClose={() => setMenu(false)}>
      <View style={[styles.sheetBackdrop, { paddingLeft: layout.left, paddingRight: layout.right, paddingBottom: insets.bottom }]}>
        <Pressable accessibilityLabel="Fechar opções" style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} />
        <View accessibilityViewIsModal style={[styles.sheet, { maxHeight: layout.sheetMaxHeight }]}>
          <View style={styles.sheetHeader}><View style={{ flex: 1, gap: 4 }}><Text style={styles.sheetTitle}>Câmera remota</Text>
            <Text style={styles.sheetDetail}>{state.state?.width || '—'}×{state.state?.height || '—'} · {state.state?.fps || '—'} FPS · {state.takeCount} {state.takeCount === 1 ? 'take preservado' : 'takes preservados'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar opções da câmera" onPress={() => setMenu(false)} style={styles.circle}><X size={21} color="#fff" /></Pressable></View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {!!error && <Text accessibilityLiveRegion="polite" style={styles.sheetError}>{error}</Text>}
            {!!transfer && <View style={styles.transferDetail}><Text style={styles.sheetDetail}>{transfer}</Text>{state.uploading && <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${percent}%` }]} /></View>}</View>}
            <Text style={styles.sheetDetail}>O Studio no computador controla a gravação.{canFocus ? ` Você também pode tocar na imagem para focar${canLockFocus ? '; segure para travar o foco' : ''}.` : ''}</Text>
            {onLocalTakes&&<MonitorAction icon={<Check size={20} color="#A6E0C0"/>} label="Takes neste iPhone · compartilhar original" onPress={()=>{setMenu(false);onLocalTakes();}}/>}
            <MonitorAction icon={<CloudUpload size={20} color="#fff" />} label={state.uploading ? `Enviando original · ${percent}%` : needsUpload ? 'Retomar envio' : state.uploadState === 'complete' ? 'Original enviado' : 'Enviar original'}
              disabled={state.uploading || !state.takeCount || state.uploadState === 'complete' && !state.uploadPendingCount} onPress={onUpload} />
            <MonitorAction icon={<RotateCw size={20} color="#fff" />} label="Reconectar prévia" onPress={() => { setMenu(false); onReconnect(); }} />
            {canUnpair && <MonitorAction icon={<Unplug size={20} color="#B8B8B8" />} label="Desvincular computador" disabled={state.uploading}
              onPress={() => { setMenu(false); onUnpair(); }} />}
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal transparent visible={audioMenu && active && !recording && !state.processing} animationType="slide" presentationStyle="overFullScreen" supportedOrientations={remoteCameraModalOrientations} statusBarTranslucent onRequestClose={() => setAudioMenu(false)}>
      <View style={[styles.sheetBackdrop, { paddingLeft: layout.left, paddingRight: layout.right, paddingBottom: insets.bottom }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Fechar entradas de áudio" style={StyleSheet.absoluteFill} onPress={() => setAudioMenu(false)} />
        <View accessibilityViewIsModal style={[styles.sheet, { maxHeight: layout.sheetMaxHeight }]}>
          <View style={styles.sheetHeader}><View style={{ flex: 1, gap: 4 }}><Text style={styles.sheetTitle}>Entrada de áudio</Text>
            <Text style={styles.sheetDetail}>{audioInputs?.current ? `Em uso: ${audioInputs.current.name}` : 'Aguardando uma entrada ativa'}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar seleção de microfone" onPress={() => setAudioMenu(false)} style={styles.circle}><X size={21} color="#fff" /></Pressable></View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {!!(audioError || audioInputs?.warning) && <Text accessibilityLiveRegion="polite" style={styles.sheetError}>{audioInputs?.warning || audioError}</Text>}
            <AudioInputOption label="Automático" detail={audioInputs?.preferredId === null && audioInputs.current ? `Usando ${audioInputs.current.name}` : 'O iPhone escolhe a entrada disponível'}
              selected={remoteCameraAudioInputSelected(audioInputs, null)} pending={audioSelecting?.id === null}
              disabled={audioBlocked || !audioInputs} onPress={() => void selectAudioInput(null)} />
            {audioInputs?.available.map(input => <AudioInputOption key={input.id} label={input.name}
              detail={audioInputs.current?.id === input.id ? `${remoteCameraAudioPortLabel(input.type)} · Em uso` : remoteCameraAudioPortLabel(input.type)}
              selected={remoteCameraAudioInputSelected(audioInputs, input.id)} pending={audioSelecting?.id === input.id}
              disabled={audioBlocked} onPress={() => void selectAudioInput(input.id)} />)}
            {!audioInputs?.available.length && <Text style={styles.sheetDetail}>Conecte o microfone ao iPhone. As entradas reconhecidas aparecem aqui.</Text>}
            <Text style={styles.audioNote}>O nome e a entrada ativa são informados pelo iPhone. A troca fica disponível antes de REC.</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </View>;
}

function MonitorAction({ icon, label, disabled, onPress }: { icon: ReactNode; label: string; disabled?: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.menuAction, disabled && { opacity: .4 }, pressed && { backgroundColor: '#252528' }]}>{icon}<Text style={styles.menuText}>{label}</Text><ChevronRight size={16} color="#949494" /></Pressable>;
}

function AudioInputOption({ label, detail, selected, pending, disabled, onPress }: { label: string; detail: string; selected: boolean; pending: boolean; disabled: boolean; onPress(): void }) {
  return <Pressable accessibilityRole="radio" accessibilityLabel={`${label}. ${detail}`} accessibilityState={{ selected, disabled, busy: pending }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.audioOption, selected && styles.audioOptionSelected, pressed && { backgroundColor: '#252528' }]}>
    <Mic size={18} color={selected ? '#EF5066' : '#E0E0E3'} /><View style={{ flex: 1, gap: 3 }}><Text style={styles.menuText}>{label}</Text><Text style={styles.audioOptionDetail}>{detail}</Text></View>
    {pending ? <ActivityIndicator size="small" color="#EF5066" /> : selected ? <Check size={18} color="#EF5066" /> : null}
  </Pressable>;
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' }, header: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  circle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111114B8', alignItems: 'center', justifyContent: 'center' }, headerSlot: { width: 44 },
  status: { flexDirection: 'row', gap: 7, alignItems: 'center', maxWidth: '68%', borderRadius: 22, backgroundColor: '#111114B8', paddingHorizontal: 14, minHeight: 38 },
  recordingStatus: { backgroundColor: '#E31346E6' }, statusText: { color: '#fff', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  recordDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }, qualityRow: { position: 'absolute', flexDirection: 'row', gap: 1, borderRadius: 9, overflow: 'hidden' },
  quality: { color: '#fff', fontSize: 12, fontWeight: '700', backgroundColor: '#111114B8', paddingHorizontal: 12, paddingVertical: 9 },
  fps: { color: '#DEDEDE', fontSize: 11, fontWeight: '600', backgroundColor: '#111114B8', paddingHorizontal: 10, paddingVertical: 9, fontVariant: ['tabular-nums'] },
  audioCorner: { position: 'absolute', gap: 8 }, feedback: { paddingVertical: 7, paddingHorizontal: 8, backgroundColor: '#111114C9', borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 5 },
  audioTarget: { minHeight: 44, justifyContent: 'center', position: 'relative' },
  feedbackError: { borderWidth: 1, borderColor: '#F65C784A' }, feedbackText: { fontSize: 10, lineHeight: 14, color: '#E7E7E7', flex: 1 }, errorText: { color: '#FFA1AE' },
  stopPosition: { position: 'absolute', width: 88, alignItems: 'center', gap: 5 }, stopButton: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', backgroundColor: '#11111445' },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#EC134A' }, stopLabel: { color: '#fff', fontSize: 10, fontWeight: '600' }, saving: { opacity: .7 },
  reticle: { position: 'absolute', width: 48, height: 48, borderWidth: 1.5, borderColor: '#FFD456', borderRadius: 7 }, lockLabel: { position: 'absolute', top: -18, color: '#FFD456', fontSize: 9, fontWeight: '700', width: 65 },
  sheetBackdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end', alignItems: 'center', paddingTop: 20 }, sheet: { width: '100%', maxWidth: 520, backgroundColor: '#111114', borderWidth: 1, borderColor: '#FFFFFF20', borderRadius: 24, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderBottomWidth: 1, borderBottomColor: '#FFFFFF13' },
  sheetTitle: { color: '#fff', fontSize: 19, fontWeight: '600' }, sheetDetail: { color: '#AFAFB4', fontSize: 12, lineHeight: 18 }, sheetContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 20, gap: 15 },
  sheetError: { color: '#FFA1AE', fontSize: 12, lineHeight: 18 }, transferDetail: { gap: 8 }, progressTrack: { height: 3, backgroundColor: '#FFFFFF20', borderRadius: 2 }, progressFill: { height: 3, backgroundColor: '#EC134A', borderRadius: 2 },
  menuAction: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#1C1C20' }, menuText: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '500' },
  audioOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#1C1C20', borderWidth: 1, borderColor: 'transparent' },
  audioOptionSelected: { borderColor: '#EF50664D', backgroundColor: '#EF506611' }, audioOptionDetail: { fontSize: 10, lineHeight: 15, color: '#AFAFB4' }, audioNote: { fontSize: 11, lineHeight: 16, color: '#929298' },
});
