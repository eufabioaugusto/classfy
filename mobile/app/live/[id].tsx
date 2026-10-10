import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Maximize, Pause, Play, Radio, RefreshCw, Send, Share2, Volume2, VolumeX } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { SkeletonBlock, SkeletonGroup } from '@/components/LoadingPlaceholder';
import { useAuth } from '@/features/auth/authContext';
import { useLive, useLiveChat, useLiveViewerPresence } from '@/features/live/useLives';
import { getLivePlayback } from '@/features/live/backend';
import { LiveBackendError, type LiveMessage } from '@/features/live/model';
import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { replaceStudioPreviewSource } from '@/features/studio/videoSourceReady';
import { StudioButton } from '@/features/studio/StudioUI';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';

type SourceState = { identity: string; mode: 'live' | 'replay'; loaded: boolean; revision: number; expiresAt?: string };
type FrameRequest = { identity: string; epoch: number; revision: number; uri: string; mode: 'live' | 'replay'; applied: boolean; frame: boolean; ready: boolean };

export default function LiveWatchScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : undefined;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id;
  const identity = `${owner || ''}:${id || ''}`;
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { closeMiniPlayer } = useMiniPlayer();
  const { live, loading, error, reload } = useLive(owner, id);
  const chatEnabled = !!live && live.chat_enabled && (live.status === 'waiting' || live.status === 'live');
  const chat = useLiveChat(owner, id, chatEnabled);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [source, setSource] = useState<SourceState | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [playbackError, setPlaybackError] = useState<{ message: string; retryable: boolean; browserTarget?: { identity: string; id: string } } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [viewLayoutIdentity, setViewLayoutIdentity] = useState<string | null>(null);
  const [playedReplayIdentity, setPlayedReplayIdentity] = useState<string | null>(null);
  const [tailFinished, setTailFinished] = useState(false);
  const [message, setMessage] = useState('');
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const playerView = useRef<VideoView>(null);
  const chatList = useRef<FlatList<LiveMessage>>(null);
  const nearBottom = useRef(true);
  const mounted = useRef(true);
  const replacements = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const frameRequest = useRef<FrameRequest | null>(null);
  const moving = useRef(false);
  const sending = useRef(false);
  const intent = useRef(false);
  const context = useRef({ identity, focused, foreground, chatEnabled, epoch: 0 });
  if (context.current.identity !== identity || context.current.focused !== focused || context.current.foreground !== foreground) context.current.epoch++;
  context.current = { ...context.current, identity, focused, foreground, chatEnabled };
  const replayAvailable = live?.status === 'ended' && (!!live.replay_published_at || live.creator_id === owner && !!live.recording_ready_at);
  const hasLiveSource = source?.identity === identity && source.mode === 'live' && source.loaded && hasFrame;
  const mode = live?.status === 'live' ? 'live' : live?.status === 'ended' && hasLiveSource && !tailFinished ? 'draining' : replayAvailable ? 'replay' : null;
  const viewReady = viewLayoutIdentity === identity && viewport.width > 0 && viewport.height > 0;
  const replayStarted = playedReplayIdentity === identity;
  const videoVisible = source?.identity === identity && source.loaded && hasFrame && (source.mode === 'live' || replayStarted);
  const player = useVideoPlayer(null, instance => {
    instance.audioMixingMode = 'doNotMix'; instance.staysActiveInBackground = false; instance.timeUpdateEventInterval = 0.5;
  });
  const presence = useLiveViewerPresence(owner, id, !!owner && focused && foreground && live?.status === 'live'
    && live.creator_id !== owner && source?.identity === identity && source.loaded && hasFrame && playing && !buffering && !playbackError);
  const safePause = useCallback(() => { try { player.pause(); } catch { /* Released Expo object. */ } }, [player]);
  const current = (request: { identity: string; epoch: number }) => mounted.current && context.current.identity === request.identity && context.current.epoch === request.epoch && context.current.focused && context.current.foreground;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { if (focused) closeMiniPlayer(); else { intent.current = false; safePause(); } }, [focused, closeMiniPlayer, safePause]);
  useEffect(() => {
    setSource(null); setPlaybackError(null); setTailFinished(false); setMessage(''); setSendError(null); setHasFrame(false); setPlayedReplayIdentity(null); intent.current = false;
    safePause();
  }, [identity, safePause]);
  useEffect(() => { if (mode !== 'replay') setPlayedReplayIdentity(null); }, [mode]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') { context.current.epoch++; context.current.foreground = false; intent.current = false; safePause(); }
      setForeground(state === 'active');
    });
    return () => { subscription.remove(); safePause(); };
  }, [safePause]);
  useEffect(() => {
    const subscriptions = [
      player.addListener('playingChange', event => { if (context.current.focused && context.current.foreground && !moving.current) { intent.current = event.isPlaying; setPlaying(event.isPlaying); } }),
      player.addListener('statusChange', event => {
        if (!context.current.focused || !context.current.foreground || moving.current) return;
        setBuffering(event.status === 'loading');
        if (event.status === 'error') { intent.current = false; setPlaybackError({ message: 'O vídeo não carregou. Tente novamente.', retryable: true }); }
      }),
      player.addListener('playToEnd', () => { if (context.current.focused && context.current.foreground && !moving.current) { intent.current = false; setPlaying(false); setTailFinished(true); } }),
      player.addListener('sourceChange', event => {
        const request = frameRequest.current;
        const uri = typeof event.source === 'string' ? event.source : typeof event.source === 'object' ? event.source?.uri : undefined;
        if (request && request.revision === generation.current && current(request) && request.uri === uri) request.applied = true;
      }),
      player.addListener('timeUpdate', event => {
        const request = frameRequest.current;
        // AVKit's initial paused frame can arrive before its inline video
        // geometry settles. Keep the replay poster until actual playback has
        // advanced; never prime it by playing/seeking on the user's behalf.
        if (request?.mode === 'replay' && request.revision === generation.current && current(request)
          && request.applied && request.frame && request.ready && player.playing && Number.isFinite(event.currentTime) && event.currentTime > 0) setPlayedReplayIdentity(request.identity);
      }),
    ];
    return () => { for (const subscription of subscriptions) { try { subscription.remove(); } catch { /* Released Expo object. */ } } };
  }, [player]);
  useEffect(() => { try { player.muted = muted; } catch { /* Released Expo object. */ } }, [player, muted]);
  useEffect(() => {
    if (mode !== 'draining') return;
    // Preserve the already-buffered end of the broadcast, with the same upper
    // bound as the web HLS player. The server's ended state is visible at once.
    const timer = setTimeout(() => { safePause(); setTailFinished(true); }, 18_000);
    return () => clearTimeout(timer);
  }, [mode, safePause]);
  useEffect(() => {
    const request = { identity, epoch: context.current.epoch };
    const version = ++generation.current;
    let active = true, cancelLoad: (() => void) | undefined;
    const isCurrent = () => active && version === generation.current && current(request);
    if (!owner || !id || !focused || !foreground || !mode || !viewReady) {
      safePause(); setPlaying(false);
      moving.current = false; setBuffering(false);
      if (!mode || !owner) { setSource(null); setHasFrame(false); }
      return;
    }
    if (mode === 'draining') { moving.current = false; setBuffering(false); return; }
    const previousPosition = mode === 'replay' && source?.identity === identity && source.mode === 'replay' ? player.currentTime : 0;
    const continuePlaying = source?.identity === identity && source.loaded ? intent.current || player.playing : mode === 'live';
    moving.current = true; safePause(); setPlaying(false); setBuffering(true); setPlaybackError(null);
    replacements.current = replacements.current.catch(() => undefined).then(async () => {
      if (!isCurrent()) return;
      const playback = await getLivePlayback(owner, id, { isCurrent });
      if (!isCurrent()) return;
      const frame: FrameRequest = { ...request, revision: version, uri: playback.url, mode, applied: false, frame: false, ready: false };
      frameRequest.current = frame;
      const adapter = {
        get status() { return player.status; },
        addListener: player.addListener.bind(player),
        replaceAsync: (uri: string | null) => player.replaceAsync(uri ? { uri, contentType: playback.type === 'hls' ? 'hls' : 'progressive', metadata: { title: live?.title || 'Live Classfy' } } : null),
      };
      const replacement = replaceStudioPreviewSource(adapter, playback.url, isCurrent);
      cancelLoad = replacement.cancel;
      try { await replacement.promise; } finally { await replacement.settled; }
      if (!isCurrent()) return;
      if (mode === 'replay') player.currentTime = Math.max(0, Number.isFinite(previousPosition) ? previousPosition : 0);
      frame.ready = true;
      moving.current = false; setBuffering(false); setHasFrame(frame.frame);
      setSource({ identity, mode, loaded: true, revision: version, expiresAt: playback.expiresAt });
      intent.current = continuePlaying;
      if (continuePlaying) player.play();
    }).catch(cause => {
      if (isCurrent()) {
        moving.current = false; setBuffering(false);
        setPlaybackError(cause instanceof LiveBackendError ? { message: cause.message, retryable: cause.code !== 'live_access_unsupported' && ![401, 403, 404].includes(cause.status || 0),
          ...(cause.code === 'live_access_unsupported' ? { browserTarget: { identity, id } } : {}) }
          : { message: 'Não foi possível carregar o vídeo. Tente novamente.', retryable: true });
      }
    });
    return () => { active = false; cancelLoad?.(); };
    // Metadata updates/polling never replace a loaded stream or reset its cursor.
  }, [identity, mode, focused, foreground, attempt, owner, id, player, safePause, viewReady]);
  useEffect(() => {
    if (source?.identity !== identity || !source.loaded || !focused || !foreground || mode === 'draining') return;
    const expires = source.expiresAt ? Date.parse(source.expiresAt) : NaN;
    const wait = Number.isFinite(expires) ? Math.max(1000, expires - Date.now() - 60_000) : 50 * 60_000;
    const timer = setTimeout(() => setAttempt(value => value + 1), Math.min(wait, 50 * 60_000));
    return () => clearTimeout(timer);
  }, [source, identity, focused, foreground, mode]);
  const togglePlayback = () => {
    if (!focused || !foreground || moving.current || !source?.loaded || source.identity !== identity || playbackError) return;
    try {
      if (player.playing) { intent.current = false; player.pause(); }
      else { intent.current = true; if (mode === 'replay' && player.currentTime >= player.duration - 0.05) player.currentTime = 0; player.play(); }
    } catch { setPlaybackError({ message: 'Não foi possível reproduzir o vídeo. Tente novamente.', retryable: true }); }
  };
  const sendMessage = async () => {
    if (!owner || !id || !focused || !foreground || !chatEnabled || sending.current || !message.trim()) return;
    const request = { identity, epoch: context.current.epoch }, text = message;
    sending.current = true; setSendBusy(true); setSendError(null);
    try {
      await chat.send(text, { isCurrent: () => current(request) && context.current.chatEnabled });
      if (current(request)) setMessage(previous => previous === text ? '' : previous);
    } catch (cause) { if (current(request)) setSendError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.'); }
    finally { sending.current = false; if (mounted.current) setSendBusy(false); }
  };
  const retry = () => { if (focused && foreground) { setPlaybackError(null); setAttempt(value => value + 1); void reload(); } };
  const openBrowser = () => {
    const target = playbackError?.browserTarget;
    if (target && mounted.current && context.current.identity === target.identity && context.current.focused && context.current.foreground) {
      void Linking.openURL(`https://classfy.com.br/live/${encodeURIComponent(target.id)}`).catch(() => undefined);
    }
  };
  const loadingText = live?.status === 'waiting' ? 'Aguardando o início da live' : live?.status === 'ended' || live?.status === 'cancelled' ? 'Live encerrada' : live?.status === 'scheduled' ? 'Live agendada' : 'Carregando live';
  if (!authLoading && !user) return <AppScreen header={<NavigationHeader title="Live" back />}><View style={styles.empty}><Radio size={30} color={colors.muted} strokeWidth={1.4} /><Text style={styles.heading}>Assista pela Classfy</Text><Text style={styles.detail}>Entre para assistir e participar da conversa.</Text><StudioButton label="Entrar" onPress={() => router.push({ pathname: '/auth/sign-in', params: { liveId: id } })} /></View></AppScreen>;
  return <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title={mode === 'replay' ? 'Gravação da live' : 'Live'} back right={<Pressable accessibilityRole="button" accessibilityLabel="Compartilhar live" disabled={!live} onPress={() => { if (live) void Share.share({ message: `${live.title} — https://classfy.com.br/live/${live.id}` }).catch(() => undefined); }} style={styles.iconButton}><Share2 size={20} color={colors.text} strokeWidth={1.6} /></Pressable>} />}>
    <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.player} onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        if (mounted.current && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
      }}>
        {owner && viewport.width > 0 && viewport.height > 0 ? <VideoView key={identity} ref={playerView} player={player} style={{ width: viewport.width, height: viewport.height }} contentFit="contain" nativeControls={mode === 'replay' && replayStarted} allowsFullscreen allowsPictureInPicture={false} onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          if (mounted.current && context.current.identity === identity && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) setViewLayoutIdentity(identity);
        }} onFirstFrameRender={() => {
          const request = frameRequest.current;
          if (!request || request.identity !== identity || request.revision !== generation.current || !current(request) || !request.applied) return;
          request.frame = true;
          if (request.ready) setHasFrame(true);
        }} /> : null}
        {!videoVisible ? <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.background }]}>{live?.thumbnail_url ? <LoadingImage source={{ uri: live.thumbnail_url }} contentFit="contain" style={StyleSheet.absoluteFillObject} /> : null}</View> : null}
        {buffering || authLoading || loading && !live || mode === 'replay' && playing && !videoVisible && !playbackError ? <View style={styles.playerOverlay}><ActivityIndicator color={colors.text} /><Text style={styles.playerDetail}>Carregando vídeo…</Text></View> : playbackError ? <View style={styles.playerOverlay}><Text accessibilityRole="alert" style={styles.playerDetail}>{playbackError.message}</Text>{playbackError.retryable ? <Pressable accessibilityRole="button" accessibilityLabel="Tentar carregar vídeo novamente" onPress={retry} style={styles.retryButton}><RefreshCw size={18} color={colors.text} strokeWidth={1.5} /><Text style={styles.playerDetail}>Tentar novamente</Text></Pressable> : null}{playbackError.browserTarget?.identity === identity ? <StudioButton label="Abrir live no navegador" secondary onPress={openBrowser} /> : null}</View> : !mode ? <View style={styles.playerOverlay}><Radio size={28} color={colors.muted} strokeWidth={1.5} /><Text style={styles.playerDetail}>{error || loadingText}</Text></View> : !playing && (mode !== 'replay' || !replayStarted) ? <Pressable accessibilityRole="button" accessibilityLabel={mode === 'replay' ? 'Reproduzir gravação' : 'Reproduzir live'} onPress={togglePlayback} style={styles.playerOverlay}><Play size={32} color={colors.text} strokeWidth={1.5} /></Pressable> : null}
      </View>
      {live ? <View style={styles.info}><Text style={styles.title} numberOfLines={2}>{live.title}</Text><View style={styles.metaRow}><Text style={[styles.badge, live.status === 'live' && { color: colors.accent }]}>{live.status === 'live' ? 'AO VIVO' : mode === 'replay' ? 'GRAVAÇÃO' : loadingText}</Text>{live.status === 'live' ? <Text style={styles.detail}>{live.viewer_count} assistindo</Text> : null}<View style={{ flex: 1 }} />
        {source?.loaded && source.identity === identity ? <><Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pausar vídeo' : 'Reproduzir vídeo'} onPress={togglePlayback} style={styles.iconButton}>{playing ? <Pause size={19} color={colors.text} strokeWidth={1.6} /> : <Play size={19} color={colors.text} strokeWidth={1.6} />}</Pressable><Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Ativar som' : 'Silenciar vídeo'} onPress={() => setMuted(value => !value)} style={styles.iconButton}>{muted ? <VolumeX size={19} color={colors.text} strokeWidth={1.6} /> : <Volume2 size={19} color={colors.text} strokeWidth={1.6} />}</Pressable><Pressable accessibilityRole="button" accessibilityLabel="Tela inteira" onPress={() => { void playerView.current?.enterFullscreen().catch(() => undefined); }} style={styles.iconButton}><Maximize size={19} color={colors.text} strokeWidth={1.6} /></Pressable></> : null}
      </View></View> : null}
      {error && live ? <Text style={styles.error}>{error}</Text> : null}
      {presence.error ? <Text style={styles.error}>Não foi possível atualizar sua presença na live.</Text> : null}
      <View style={styles.chatHeading}><Text style={styles.heading}>Conversa</Text>{!chatEnabled ? <Text style={styles.detail}>{live?.status === 'ended' || live?.status === 'cancelled' ? 'Encerrada' : 'Chat desativado'}</Text> : null}</View>
      {chat.loading && !chat.messages.length ? <SkeletonGroup label="Carregando conversa" style={{ padding: 20, gap: 12 }}><SkeletonBlock style={{ width: '75%', height: 14 }} /><SkeletonBlock style={{ width: '55%', height: 14 }} /></SkeletonGroup> : <FlatList ref={chatList} data={chat.messages} keyExtractor={item => item.id} style={{ flex: 1 }} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" onScroll={event => { const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent; nearBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 60; }} scrollEventThrottle={16} onContentSizeChange={() => { if (nearBottom.current && focused) chatList.current?.scrollToEnd({ animated: true }); }} ListEmptyComponent={<Text style={styles.detail}>{chatEnabled ? 'Seja o primeiro a enviar uma mensagem.' : 'As mensagens desta live aparecem aqui.'}</Text>} renderItem={({ item }) => <View style={styles.message}><Text style={styles.messageAuthor}>{item.user?.display_name || (item.user_id === owner ? 'Você' : 'Membro Classfy')}</Text><Text style={styles.messageText}>{item.content}</Text></View>} />}
      {sendError || chat.error ? <Text accessibilityRole="alert" style={styles.error}>{sendError || chat.error}</Text> : null}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}><TextInput accessibilityLabel="Mensagem no chat da live" value={message} onChangeText={setMessage} editable={chatEnabled && !sendBusy} placeholder={chatEnabled ? 'Enviar mensagem…' : 'Chat fechado'} placeholderTextColor={colors.mutedDim} maxLength={2000} returnKeyType="send" onSubmitEditing={() => { void sendMessage(); }} style={styles.chatInput} /><Pressable accessibilityRole="button" accessibilityLabel="Enviar mensagem" accessibilityState={{ disabled: !chatEnabled || sendBusy || !message.trim(), busy: sendBusy }} disabled={!chatEnabled || sendBusy || !message.trim()} onPress={() => { void sendMessage(); }} style={[styles.iconButton, (!chatEnabled || sendBusy || !message.trim()) && { opacity: 0.4 }]}>{sendBusy ? <ActivityIndicator size="small" color={colors.text} /> : <Send size={21} color={colors.text} strokeWidth={1.5} />}</Pressable></View>
    </KeyboardAvoidingView>
  </AppScreen>;
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.backgroundElevated },
  playerOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: 'rgba(0,0,0,0.55)' },
  playerDetail: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retryButton: { minHeight: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  info: { paddingHorizontal: 20, paddingTop: 12 },
  title: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  badge: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  heading: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 11, lineHeight: 17 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  chatHeading: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle, flexDirection: 'row', justifyContent: 'space-between' },
  messages: { paddingHorizontal: 20, paddingVertical: 14, gap: 14 },
  message: { gap: 3 },
  messageAuthor: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  messageText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  composer: { paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  chatInput: { flex: 1, minHeight: 44, borderRadius: controls.buttonRadius, paddingHorizontal: 12, color: colors.text, backgroundColor: colors.surface, fontSize: 13 },
  error: { color: colors.accent, paddingHorizontal: 20, paddingVertical: 8, fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', gap: 16, paddingVertical: 60 },
});
