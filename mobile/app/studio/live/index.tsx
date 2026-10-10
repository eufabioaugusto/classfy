import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUpRight, Play, Plus, Radio, RefreshCw, Send, Trash2 } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { useAuth } from '@/features/auth/authContext';
import { useStudioLives } from '@/features/live/useLives';
import { canDiscardStudioLive, canSubmitLiveReplay, type LiveRecord } from '@/features/live/model';
import { LiveWorkspaceAccess, LiveWorkspaceCard, LiveWorkspaceLoading, liveWorkspaceStyles as styles } from '@/features/live/LiveWorkspaceUI';
import { StudioButton } from '@/features/studio/StudioUI';
import { colors } from '@/theme/colors';

const isOpen = (live: LiveRecord) => !!live.mux_live_stream_id && (live.status === 'waiting' || live.status === 'live');
const canSendReplay = (live: LiveRecord) => canSubmitLiveReplay(live) && !live.replay_published_at;
const canDiscard = canDiscardStudioLive;

export default function StudioLivesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { lives, loading, error, refresh, publishReplay, discard, canCreate, accessLoading } = useStudioLives();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const busy = useRef(false);
  const confirming = useRef(false);
  const context = useRef({ owner: user?.id, focused, epoch: 0, lives });
  if (context.current.owner !== user?.id || context.current.focused !== focused) context.current.epoch++;
  context.current = { ...context.current, owner: user?.id, focused, lives };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; context.current.epoch++; }; }, []);
  useEffect(() => { if (!focused) confirming.current = false; setRefreshing(false); }, [focused, user?.id]);
  const openLive = lives.find(isOpen);
  const history = lives.filter(live => live.id !== openLive?.id);
  const locked = busyId !== null || busy.current;
  const valid = (request: { owner: string; epoch: number }) => mounted.current && context.current.focused && context.current.owner === request.owner && context.current.epoch === request.epoch;
  const openBroadcast = (live: LiveRecord) => {
    if (busy.current || !context.current.focused || live.creator_id !== context.current.owner || !context.current.lives.some(row => row.id === live.id && isOpen(row))) return;
    router.push({ pathname: '/studio/live/[id]', params: { id: live.id } });
  };
  const confirmAction = (live: LiveRecord, action: 'publish' | 'discard') => {
    const owner = context.current.owner;
    if (!owner || !focused || busy.current || confirming.current || live.creator_id !== owner) return;
    const request = { owner, epoch: context.current.epoch };
    confirming.current = true;
    const close = () => { if (context.current.epoch === request.epoch) confirming.current = false; };
    Alert.alert(action === 'publish' ? 'Enviar gravação para revisão?' : 'Descartar esta live?',
      action === 'publish' ? 'A gravação entra na curadoria. Ela aparece no catálogo após a aprovação.' : live.status === 'waiting' ? 'Esta preparação ainda não foi transmitida e será removida.' : 'A preparação e a gravação serão removidas. Essa ação não pode ser desfeita.', [
        { text: 'Cancelar', style: 'cancel', onPress: close },
        { text: action === 'publish' ? 'Enviar para revisão' : 'Descartar', style: action === 'discard' ? 'destructive' : 'default', onPress: () => {
          close();
          const latest = context.current.lives.find(row => row.id === live.id && row.creator_id === request.owner);
          if (!valid(request) || busy.current || !latest || !(action === 'publish' ? canSendReplay(latest) : canDiscard(latest))) return;
          busy.current = true; setBusyId(live.id);
          const scope = { isCurrent: () => valid(request) };
          void (action === 'publish' ? publishReplay(live.id, scope) : discard(live.id, scope)).catch(cause => {
            if (valid(request)) Alert.alert('Não foi possível concluir', cause instanceof Error ? cause.message : 'Tente novamente.');
          }).finally(() => { busy.current = false; if (mounted.current) setBusyId(null); });
        } },
      ], { cancelable: true, onDismiss: close });
  };
  const reload = async () => {
    if (refreshing || busy.current) return;
    const request = { owner: user?.id || '', epoch: context.current.epoch };
    setRefreshing(true);
    try { await refresh(); } finally { if (valid(request)) setRefreshing(false); }
  };
  const newLive = () => {
    if (busy.current || !focused || loading || accessLoading || !canCreate) return;
    if (openLive) openBroadcast(openLive); else router.push('/studio/live/new');
  };
  return <LiveWorkspaceAccess><AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Lives" back right={
    <Pressable accessibilityRole="button" accessibilityLabel={openLive ? 'Retomar live' : 'Nova live'} accessibilityState={{ disabled: locked || loading || accessLoading || !canCreate }} disabled={locked || loading || accessLoading || !canCreate} onPress={newLive} style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.surface }, (!canCreate || locked) && { opacity: 0.4 }]}><Plus size={23} color={colors.text} strokeWidth={1.6} /></Pressable>
  } />}>
    <ScrollView style={styles.page} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void reload(); }} tintColor={colors.muted} />} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}>
      {error ? <View style={styles.notice}><Text style={styles.error}>{error}</Text><Pressable accessibilityRole="button" accessibilityLabel="Recarregar lives" onPress={() => { void reload(); }} style={styles.quietAction}><RefreshCw size={16} color={colors.text} /><Text style={styles.primaryText}>Tentar novamente</Text></Pressable></View> : null}
      {loading ? <LiveWorkspaceLoading /> : <>
        {openLive ? <LiveWorkspaceCard live={openLive} disabled={locked} onPress={() => openBroadcast(openLive)}>
          <StudioButton label={openLive.status === 'live' ? 'Retomar transmissão' : 'Abrir prévia'} disabled={locked} loading={busyId === openLive.id} onPress={() => openBroadcast(openLive)} icon={<ArrowUpRight size={16} color={colors.text} />} />
          {canDiscard(openLive) ? <Pressable accessibilityRole="button" accessibilityLabel="Descartar preparação" disabled={locked} onPress={() => confirmAction(openLive, 'discard')} style={({ pressed }) => [styles.quietAction, pressed && { opacity: 0.65 }]}><Trash2 size={15} color={colors.muted} /><Text style={styles.quietText}>Descartar preparação</Text></Pressable> : null}
        </LiveWorkspaceCard> : canCreate ? <StudioButton label="Preparar live" disabled={locked || accessLoading} onPress={newLive} icon={<Radio size={18} color={colors.text} strokeWidth={1.6} />} /> : null}
        {!accessLoading && !canCreate ? <View style={styles.notice}><Text style={styles.detail}>Novas lives estão disponíveis para creators aprovados. Suas transmissões e gravações continuam aqui.</Text></View> : null}
        {history.length ? <View><Text style={styles.sectionTitle}>Histórico</Text><View style={{ gap: 18 }}>{history.map(live => <LiveWorkspaceCard key={live.id} live={live}>
          <View style={styles.actions}>
            {(live.status === 'ended' && live.recording_ready_at || live.replay_published_at) ? <Pressable accessibilityRole="button" accessibilityLabel={`Ver gravação de ${live.title}`} disabled={locked} onPress={() => {
              if (!busy.current && context.current.focused && live.creator_id === context.current.owner) router.push({ pathname: '/live/[id]', params: { id: live.id } });
            }} style={({ pressed }) => [styles.quietAction, pressed && { opacity: 0.65 }]}><Play size={15} color={colors.textSecondary} strokeWidth={1.6} /><Text style={styles.quietText}>Ver gravação</Text></Pressable> : null}
            {canSendReplay(live) ? <StudioButton label="Enviar para revisão" disabled={locked} loading={busyId === live.id} onPress={() => confirmAction(live, 'publish')} icon={<Send size={15} color={colors.text} strokeWidth={1.6} />} /> : null}
            {canDiscard(live) ? <Pressable accessibilityRole="button" accessibilityLabel={`Descartar ${live.title}`} disabled={locked} onPress={() => confirmAction(live, 'discard')} style={({ pressed }) => [styles.quietAction, pressed && { opacity: 0.65 }]}>{busyId === live.id ? <ActivityIndicator color={colors.muted} size="small" /> : <Trash2 size={15} color={colors.muted} strokeWidth={1.6} />}<Text style={styles.quietText}>Descartar</Text></Pressable> : null}
          </View>
        </LiveWorkspaceCard>)}</View></View> : !openLive && !error ? <View style={styles.empty}><Radio size={30} color={colors.mutedDim} strokeWidth={1.4} /><Text style={styles.heading}>Seu espaço ao vivo</Text><Text style={styles.detail}>Suas transmissões e gravações aparecem aqui.</Text></View> : null}
      </>}
    </ScrollView>
  </AppScreen></LiveWorkspaceAccess>;
}
