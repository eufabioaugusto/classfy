import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Camera as ExpoCamera } from 'expo-camera';
import { ArrowLeft, Bell, Camera, CameraOff, MessageCircle, Mic, MicOff, Radio, RefreshCw, Send, Share2, Users, X } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { useAuth } from '@/features/auth/authContext';
import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { StudioButton, StudioLoading } from '@/features/studio/StudioUI';
import { colors } from '@/theme/colors';
import { createBroadcastController, type BroadcastPhase, type BroadcastSnapshot } from '@/features/live/broadcastController';
import { connectHost, endLive, getLive, notifyLiveFollowers, setLiveChat, startBridge, syncLive } from '@/features/live/backend';
import { useLive, useLiveChat } from '@/features/live/useLives';
import type { LiveRecord } from '@/features/live/model';
import { createNativeLiveTransport, getNativeLiveAvailability, type NativeLiveSnapshot } from '@/features/live/transport';
import { NativeLivePreview } from '@/features/live/NativeLivePreview';

const labels: Record<BroadcastPhase, string> = {
  idle: 'Prévia privada', preparing: 'Abrindo câmera', preview: 'Prévia privada', countdown: 'Preparando',
  connecting: 'Conectando', 'awaiting-signal': 'Aguardando sinal', live: 'AO VIVO', reconnecting: 'Reconectando',
  interrupted: 'Sinal interrompido', ending: 'Encerrando', ended: 'Encerrada', error: 'Câmera indisponível',
};
const duration = (started: string | null, now: number) => {
  const seconds = started ? Math.max(0, Math.floor((now - Date.parse(started)) / 1000)) : 0;
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const busyPhases: BroadcastPhase[] = ['preparing', 'countdown', 'connecting', 'ending'];

export default function LiveBroadcastScreen() {
  const { id: rawId } = useLocalSearchParams<{ id: string | string[] }>();
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const { user } = useAuth();
  const router = useRouter();
  const { live, loading, error, reload } = useLive(user?.id, id);
  const availability = getNativeLiveAvailability();
  if (loading) return <AppScreen scroll={false} header={<NavigationHeader title="Live" back />}><StudioLoading /></AppScreen>;
  if (!live || live.creator_id !== user?.id) return <AppScreen header={<NavigationHeader title="Live" back />}>
    <View style={styles.empty}><Radio color={colors.muted} size={30} /><Text style={styles.heading}>{error || 'Não encontramos esta live na sua conta.'}</Text>
      <StudioButton label="Tentar novamente" onPress={() => { void reload(); }} secondary /></View>
  </AppScreen>;
  if (live.status === 'ended' || live.status === 'cancelled') return <AppScreen header={<NavigationHeader title="Live" back />}>
    <View style={styles.empty}><Text style={styles.heading}>Transmissão encerrada</Text><Text style={styles.body}>Acompanhe a gravação no Studio.</Text>
      <StudioButton label="Minhas lives" onPress={() => router.replace('/studio/live')} /></View>
  </AppScreen>;
  if (!availability.available || !live.mux_live_stream_id) return <AppScreen header={<NavigationHeader title="Live" back />}>
    <View style={styles.empty}><Radio color={colors.muted} size={30} /><Text style={styles.heading}>{live.mux_live_stream_id ? 'Atualize o aplicativo para transmitir' : 'Prepare uma nova live'}</Text>
      <Text style={styles.body}>{live.mux_live_stream_id ? availability.reason : 'Esta preparação antiga não possui sinal de vídeo.'}</Text>
      {live.mux_live_stream_id ? <StudioButton label="Abrir transmissão no navegador" secondary onPress={() => { void Linking.openURL(`https://classfy.com.br/live/${encodeURIComponent(live.id)}/broadcast`); }} /> : null}
      <StudioButton label="Minhas lives" onPress={() => router.replace('/studio/live')} />
    </View>
  </AppScreen>;
  return <NativeHost key={`${user!.id}:${live.id}`} owner={user!.id} live={live} reload={reload} refreshError={error} />;
}

function NativeHost({ owner, live, reload, refreshError }: { owner: string; live: LiveRecord; reload: () => Promise<unknown>; refreshError: string | null }) {
  const router = useRouter(), navigation = useNavigation(), focused = useIsFocused();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const miniPlayer = useMiniPlayer();
  const context = useRef({ owner: user?.id, focused }); context.current = { owner: user?.id, focused };
  const alive = useRef(true);
  const transport = useMemo(() => createNativeLiveTransport(), []);
  const controller = useMemo(() => createBroadcastController({ owner, liveId: live.id, transport,
    backend: { connectHost, endLive, getLive, startBridge, syncLive },
    isCurrent: () => alive.current && context.current.owner === owner && context.current.focused,
  }), [owner, live.id, transport]);
  const [state, setState] = useState<BroadcastSnapshot>(controller.getSnapshot);
  const [media, setMedia] = useState<NativeLiveSnapshot>(transport.getSnapshot);
  const [now, setNow] = useState(Date.now);
  const [chatOpen, setChatOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const actionReserved = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [allowLeave, setAllowLeave] = useState(false);
  const [exitToManager, setExitToManager] = useState(false);
  const pendingNavigation = useRef<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const confirms = useRef(false);
  const sameOwner = () => alive.current && context.current.owner === owner;
  const sameScreen = () => sameOwner() && context.current.focused;
  const busy = busyPhases.includes(state.phase) || permissionBusy;
  const captureOn = !!media.videoTrack;
  const confirmedLive = live.status === 'live';
  const canStart = captureOn && state.phase === 'preview' && media.cameraEnabled && media.microphoneEnabled;

  useEffect(() => {
    alive.current = true;
    const unsubscribe = controller.subscribe(setState);
    const unsubscribeMedia = transport.subscribe(snapshot => {
      if (!sameScreen()) return;
      setMedia(snapshot); controller.connectionChanged(snapshot.connectionState);
      if (snapshot.phase === 'error') controller.captureInterrupted();
    });
    const appState = AppState.addEventListener('change', value => { void controller.setForeground(value === 'active'); if (value === 'active') void reload(); });
    let tick = 0;
    const timer = setInterval(() => { setNow(Date.now()); ++tick;
      const phase = controller.getSnapshot().phase;
      if (phase === 'awaiting-signal' && tick % 2 === 0 || tick % 10 === 0) void controller.sync();
    }, 1000);
    return () => { alive.current = false; clearInterval(timer); appState.remove(); unsubscribe(); unsubscribeMedia(); void controller.dispose().catch(() => {}); };
  }, [controller, transport]);
  useEffect(() => { controller.updateLive(live); }, [live, controller]);
  useEffect(() => {
    void controller.setForeground(focused && AppState.currentState === 'active');
    if (focused) { setMedia(transport.getSnapshot()); setState(controller.getSnapshot()); }
  }, [focused, controller, transport]);
  useEffect(() => {
    const tag = `classfy-live-${live.id}`;
    let released = false;
    if (captureOn && focused) void activateKeepAwakeAsync(tag).then(() => { if (released) void deactivateKeepAwake(tag).catch(() => {}); }).catch(() => {});
    return () => { released = true; void deactivateKeepAwake(tag).catch(() => {}); };
  }, [captureOn, focused, live.id]);
  useEffect(() => {
    if (allowLeave && pendingNavigation.current) { const action = pendingNavigation.current; pendingNavigation.current = null; navigation.dispatch(action); }
    else if (allowLeave && exitToManager) router.replace('/studio/live');
  }, [allowLeave, exitToManager, navigation, router]);

  const finish = useCallback(async () => {
    if (await controller.end() && sameScreen()) { setAllowLeave(true); if (!pendingNavigation.current) setExitToManager(true); }
  }, [controller, router]);
  const confirmEnd = () => {
    if (busy || confirms.current) return;
    confirms.current = true;
    Alert.alert('Encerrar a live?', 'A transmissão terminará para todos. A gravação ficará no Studio após o processamento.', [
      { text: 'Continuar', style: 'cancel', onPress: () => { confirms.current = false; } },
      { text: 'Encerrar', style: 'destructive', onPress: () => { confirms.current = false; void finish(); } },
    ], { onDismiss: () => { confirms.current = false; } });
  };
  usePreventRemove(!allowLeave && controller.mustConfirmLeave(), ({ data }) => {
    if (confirms.current) return;
    confirms.current = true;
    if (!state.mayBeOnAir && !state.localPublishing && !confirmedLive) {
      Alert.alert('Cancelar conexão?', 'Sua preparação continuará disponível no Studio.', [
        { text: 'Continuar', style: 'cancel', onPress: () => { confirms.current = false; } },
        { text: 'Sair', onPress: () => { confirms.current = false; pendingNavigation.current = data.action; void controller.cancelPreparation().then(() => { if (sameScreen()) setAllowLeave(true); }); } },
      ], { onDismiss: () => { confirms.current = false; } });
      return;
    }
    Alert.alert('A live pode continuar no ar', 'Encerre a transmissão antes de sair desta tela.', [
      { text: 'Continuar aqui', style: 'cancel', onPress: () => { confirms.current = false; } },
      { text: 'Encerrar e sair', style: 'destructive', onPress: () => { confirms.current = false; if (!busy) { pendingNavigation.current = data.action; void finish(); } } },
    ], { onDismiss: () => { confirms.current = false; } });
  });
  const prepare = async () => {
    if (actionReserved.current || busy || !sameScreen()) return;
    actionReserved.current = true; setPermissionBusy(true); setNotice(null);
    try {
      const camera = await ExpoCamera.requestCameraPermissionsAsync();
      if (!sameScreen()) return;
      const microphone = camera.granted ? await ExpoCamera.requestMicrophonePermissionsAsync() : null;
      if (!sameScreen()) return;
      if (!camera.granted || !microphone?.granted) { setNotice('Permita câmera e microfone nos Ajustes para transmitir sua live.'); return; }
      if (AppState.currentState !== 'active') return;
      await controller.setForeground(true);
      miniPlayer.closeMiniPlayer(); await controller.prepare();
    } catch { if (sameScreen()) setNotice('Não foi possível acessar câmera e microfone. Confira as permissões.'); }
    finally { actionReserved.current = false; if (sameOwner()) setPermissionBusy(false); }
  };
  const start = () => {
    if (!canStart) return;
    if (confirmedLive) Alert.alert('Retomar nesta câmera?', 'A conexão deste aparelho substituirá a transmissão da sua conta em outro dispositivo.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Retomar', onPress: () => { void controller.start(); } },
    ]);
    else void controller.start();
  };
  const runAction = async (work: () => Promise<string>) => {
    if (actionReserved.current || !sameScreen()) return;
    actionReserved.current = true; setActionBusy(true); setNotice(null);
    try { const message = await work(); if (sameScreen()) { setNotice(message); void reload(); } }
    catch (error) { if (sameScreen()) setNotice(error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { actionReserved.current = false; if (sameOwner()) setActionBusy(false); }
  };
  const deviceAction = (work: () => Promise<void>) => { void runAction(async () => { await work(); return ''; }); };
  const notify = () => {
    if (!confirmedLive || live.followers_notified_at || actionBusy) return;
    Alert.alert('Avisar seus seguidores?', 'Enviaremos uma notificação com o link desta live.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Avisar', onPress: () => { void runAction(async () => {
        const result = await notifyLiveFollowers(owner, live.id);
        return result.alreadyNotified ? 'Seus seguidores já foram avisados.' : `${result.notifiedCount} seguidores avisados.`;
      }); } },
    ]);
  };

  return <View style={styles.host}>
    <Stack.Screen options={{ gestureEnabled: false }} />
    <NativeLivePreview transport={transport} style={StyleSheet.absoluteFill} objectFit="contain" mirror={media.facing === 'front'} />
    {!captureOn || !media.cameraEnabled ? <View style={styles.previewPlaceholder}><CameraOff size={38} color={colors.muted} />
      <Text style={styles.body}>{busy ? 'Preparando câmera e microfone…' : 'Sua prévia aparece aqui'}</Text></View> : null}
    <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
      <View style={styles.headerRow}><IconButton label="Voltar ao Studio" onPress={() => router.back()} icon={<ArrowLeft color="white" size={22} />} />
        <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.title}>{live.title}</Text><Text style={styles.quality}>CLASSFY LIVE · 720p · 30 FPS</Text></View>
        <IconButton label="Compartilhar live" icon={<Share2 color="white" size={21} />} onPress={() => { void Share.share({ message: `https://classfy.com.br/live/${live.id}` }).catch(() => {}); }} />
      </View>
      <View style={styles.chips}><View style={[styles.chip, state.phase === 'live' && styles.onAir]}><View style={[styles.dot, { backgroundColor: state.phase === 'live' ? colors.accent : colors.muted }]} />
        <Text style={styles.chipText}>{labels[state.phase]}{confirmedLive ? ` · ${duration(live.started_at, now)}` : ''}</Text></View>
        {confirmedLive ? <View style={styles.chip}><Users color="white" size={14} /><Text style={styles.chipText}>{live.viewer_count}</Text></View> : null}</View>
    </View>
    {state.countdown > 0 ? <View pointerEvents="none" style={styles.countdown}><Text style={styles.countdownText}>{state.countdown}</Text></View> : null}
    <View style={[styles.bottom, { paddingBottom: Math.max(20, insets.bottom + 12) }]}>
      {state.error || notice || refreshError ? <Text accessibilityRole="alert" style={styles.notice}>{state.error || notice || refreshError}</Text> : null}
      {state.phase === 'awaiting-signal' || state.phase === 'reconnecting' ? <View style={styles.signal}><ActivityIndicator color="white" size="small" />
        <Text style={styles.body}>{state.phase === 'reconnecting' ? 'Recuperando sua conexão…' : 'Aguardando confirmação do sinal público…'}</Text></View> : null}
      {captureOn && !state.localPublishing && !busy && !state.mayBeOnAir ? <Text style={styles.privateNote}>Só você vê esta prévia.</Text> : null}
      <View style={styles.controls}>
        <IconButton label={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'} disabled={!captureOn || busy || actionBusy} onPress={() => deviceAction(() => transport.setCameraEnabled(!media.cameraEnabled))} icon={media.cameraEnabled ? <Camera color="white" size={22} /> : <CameraOff color={colors.accent} size={22} />} />
        <IconButton label={media.microphoneEnabled ? 'Silenciar microfone' : 'Ligar microfone'} disabled={!captureOn || busy || actionBusy} onPress={() => deviceAction(() => transport.setMicrophoneEnabled(!media.microphoneEnabled))} icon={media.microphoneEnabled ? <Mic color="white" size={22} /> : <MicOff color={colors.accent} size={22} />} />
        <IconButton label="Trocar câmera" disabled={!captureOn || busy || actionBusy} onPress={() => deviceAction(() => transport.flipCamera())} icon={<RefreshCw color="white" size={22} />} />
        <IconButton label="Chat da live" disabled={busy} onPress={() => setChatOpen(true)} icon={<MessageCircle color="white" size={22} />} />
        <IconButton label={live.followers_notified_at ? 'Seguidores avisados' : 'Avisar seguidores'} disabled={!confirmedLive || !!live.followers_notified_at || actionBusy} onPress={notify} icon={<Bell color="white" size={22} />} />
      </View>
      {state.phase === 'ended' ? <StudioButton label="Minhas lives" onPress={() => { setAllowLeave(true); router.replace('/studio/live'); }} />
        : state.localPublishing ? <StudioButton label={state.phase === 'ending' ? 'Encerrando…' : 'Encerrar live'} onPress={confirmEnd} disabled={busy} secondary />
        : <View style={{ gap: 10 }}><StudioButton label={canStart ? confirmedLive ? 'Retomar transmissão' : 'Iniciar transmissão' : busy ? labels[state.phase] : 'Ativar câmera e microfone'}
          loading={busy} onPress={canStart ? start : () => { void prepare(); }} disabled={captureOn && !canStart && !busy && state.phase === 'preview'} />
          {state.mayBeOnAir || confirmedLive ? <StudioButton label="Encerrar live" onPress={confirmEnd} secondary disabled={busy} /> : null}</View>}
    </View>
    <LiveChatModal owner={owner} live={live} open={chatOpen} onClose={() => setChatOpen(false)}
      toggling={actionBusy} toggle={() => { void runAction(async () => { await setLiveChat(owner, live.id, live.chat_enabled === false); return live.chat_enabled === false ? 'Chat ativado.' : 'Chat desativado.'; }); }} />
  </View>;
}

function IconButton({ label, icon, onPress, disabled }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.iconButton, disabled && { opacity: 0.35 }, pressed && { opacity: 0.65 }]}>{icon}</Pressable>;
}
function LiveChatModal({ owner, live, open, onClose, toggle, toggling }: { owner: string; live: LiveRecord; open: boolean; onClose: () => void; toggle: () => void; toggling: boolean }) {
  const chat = useLiveChat(owner, live.id, live.chat_enabled !== false);
  const [text, setText] = useState('');
  const insets = useSafeAreaInsets();
  const send = async () => { const draft = text; if (!draft.trim() || chat.sending) return;
    try { await chat.send(draft); setText(previous => previous === draft ? '' : previous); }
    catch { /* The hook retains the draft and presents the actual backend error. */ }
  };
  return <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}><Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Fechar chat" />
      <View style={[styles.chatSheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <View style={styles.headerRow}><Text style={[styles.heading, { flex: 1 }]}>Chat da live</Text><IconButton label="Fechar chat" onPress={onClose} icon={<X color="white" size={22} />} /></View>
        <Pressable disabled={toggling} onPress={toggle} accessibilityRole="switch" accessibilityState={{ checked: live.chat_enabled !== false, disabled: toggling }} style={styles.chatToggle}>
          <Text style={styles.body}>{live.chat_enabled === false ? 'Chat desativado' : 'Chat ativado'}</Text><Text style={{ color: colors.text }}>{toggling ? 'Alterando…' : live.chat_enabled === false ? 'Ativar' : 'Desativar'}</Text></Pressable>
        {chat.loading ? <ActivityIndicator color="white" /> : null}
        <FlatList data={chat.messages} keyExtractor={message => message.id} style={{ flex: 1 }} keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={[styles.body, { textAlign: 'center', marginVertical: 24 }]}>As mensagens aparecerão aqui.</Text>}
          renderItem={({ item }) => <Pressable style={styles.message} onLongPress={() => Alert.alert('Excluir mensagem?', 'Ela será removida do chat para todos.', [
            { text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: () => { void chat.delete(item.id).catch(error => Alert.alert('Não foi possível excluir', error instanceof Error ? error.message : 'Tente novamente.')); } },
          ])}><Text style={styles.messageAuthor}>{item.user?.display_name || 'Participante'}</Text><Text style={styles.messageText}>{item.content}</Text></Pressable>} />
        {chat.error ? <Text accessibilityRole="alert" style={styles.notice}>{chat.error}</Text> : null}
        <View style={styles.composer}><TextInput value={text} onChangeText={setText} maxLength={1000} placeholder={live.chat_enabled === false ? 'Chat desativado' : 'Enviar mensagem'}
          placeholderTextColor={colors.muted} editable={live.chat_enabled !== false && !chat.sending} accessibilityLabel="Mensagem para o chat" style={styles.messageInput} returnKeyType="send" onSubmitEditing={() => { void send(); }} />
          <IconButton label="Enviar mensagem" icon={<Send color="white" size={21} />} disabled={live.chat_enabled === false || !text.trim() || chat.sending} onPress={() => { void send(); }} /></View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: '#090D10' }, empty: { alignItems: 'center', padding: 24, gap: 18, marginTop: 40 },
  heading: { fontSize: 21, fontWeight: '600', color: colors.text }, body: { fontSize: 14, lineHeight: 21, color: colors.muted },
  top: { paddingHorizontal: 16, gap: 16, backgroundColor: 'rgba(9,13,16,0.72)' }, headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: 'white', fontSize: 16, fontWeight: '600' }, quality: { color: colors.muted, fontSize: 9, letterSpacing: 1.4, marginTop: 5 },
  chips: { flexDirection: 'row', gap: 8, paddingBottom: 14 }, chip: { flexDirection: 'row', gap: 7, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.65)' },
  onAir: { backgroundColor: '#431623' }, dot: { width: 6, height: 6, borderRadius: 3 }, chipText: { color: 'white', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  previewPlaceholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 14 },
  countdown: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' }, countdownText: { color: 'white', fontSize: 100, fontWeight: '600' },
  bottom: { marginTop: 'auto', paddingTop: 14, paddingHorizontal: 20, backgroundColor: 'rgba(9,13,16,0.86)', gap: 12 },
  notice: { fontSize: 12, lineHeight: 18, color: '#FF9CAC' }, privateNote: { textAlign: 'center', color: colors.muted, fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  signal: { flexDirection: 'row', justifyContent: 'center', gap: 10, alignItems: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' }, chatSheet: { height: '68%', backgroundColor: colors.backgroundElevated, paddingHorizontal: 20, paddingTop: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 12 },
  chatToggle: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomColor: colors.border, borderBottomWidth: 1 },
  message: { paddingVertical: 9, gap: 4 }, messageAuthor: { color: colors.muted, fontSize: 11, fontWeight: '600' }, messageText: { color: 'white', fontSize: 14, lineHeight: 20 },
  composer: { flexDirection: 'row', gap: 8, alignItems: 'center' }, messageInput: { flex: 1, minHeight: 46, color: 'white', borderRadius: 14, backgroundColor: colors.surface, paddingHorizontal: 14 },
});
