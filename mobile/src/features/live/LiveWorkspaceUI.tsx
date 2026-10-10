import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LockKeyhole, Radio } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { LoadingImage } from '@/components/LoadingImage';
import { SkeletonBlock, SkeletonGroup } from '@/components/LoadingPlaceholder';
import { useAuth } from '@/features/auth/authContext';
import { StudioButton } from '@/features/studio/StudioUI';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';
import type { LiveRecord } from './model';

// Management remains available to the owner even when creator approval changes.
// The broadcasting screen owns the native transport capability gate.
export function LiveWorkspaceAccess({ children }: PropsWithChildren) {
  const { user, loading } = useAuth();
  const router = useRouter();
  if (loading) return <AppScreen scroll={false} header={<NavigationHeader title="Lives" back />}><LiveWorkspaceLoading /></AppScreen>;
  if (user) return <>{children}</>;
  return <AppScreen header={<NavigationHeader title="Lives" back />}>
    <View style={liveWorkspaceStyles.empty}><LockKeyhole size={28} color={colors.muted} strokeWidth={1.5} />
      <Text style={liveWorkspaceStyles.heading}>Suas lives na Classfy</Text>
      <Text style={liveWorkspaceStyles.detail}>Entre na sua conta para preparar e gerenciar transmissões.</Text>
      <StudioButton label="Entrar" onPress={() => router.push('/auth/sign-in')} />
    </View>
  </AppScreen>;
}

export function LiveWorkspaceLoading() {
  return <SkeletonGroup label="Carregando suas lives" style={{ gap: 16, paddingVertical: 16 }}>
    {[0, 1].map(index => <View key={index} style={{ gap: 12 }}><SkeletonBlock style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 14 }} />
      <SkeletonBlock style={{ width: '65%', height: 16 }} /><SkeletonBlock style={{ width: '40%', height: 12 }} /></View>)}
  </SkeletonGroup>;
}

export function liveWorkspaceStatus(live: LiveRecord): { label: string; color: string } {
  if (live.replay_published_at) return { label: 'Publicada', color: colors.free };
  if (live.replay_content_id) return { label: 'Em revisão', color: colors.amber };
  if (!live.mux_live_stream_id) return { label: 'Registro anterior', color: colors.muted };
  if (live.status === 'live') return { label: 'Ao vivo', color: colors.accent };
  if (live.status === 'waiting') return { label: live.livekit_egress_id ? 'Aguardando sinal' : 'Pronta para iniciar', color: colors.amber };
  if (live.status === 'scheduled') return { label: 'Agendada', color: colors.muted };
  if (live.status === 'cancelled') return { label: 'Cancelada', color: colors.muted };
  if (live.recording_ready_at) return { label: 'Gravação pronta', color: colors.free };
  return { label: 'Preparando gravação', color: colors.muted };
}

export function LiveWorkspaceCard({ live, onPress, disabled, children }: PropsWithChildren<{ live: LiveRecord; onPress?: () => void; disabled?: boolean }>) {
  const state = liveWorkspaceStatus(live);
  const created = new Date(live.created_at);
  const date = Number.isFinite(created.getTime()) ? created.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) : '';
  const cover = <View style={liveWorkspaceStyles.cover}>
    <Radio size={28} color={colors.mutedDim} strokeWidth={1.4} />
    {live.thumbnail_url ? <LoadingImage source={{ uri: live.thumbnail_url }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : null}
    <View style={liveWorkspaceStyles.coverBadge}><View style={[liveWorkspaceStyles.dot, { backgroundColor: state.color }]} /><Text style={liveWorkspaceStyles.badgeText}>{state.label}</Text></View>
  </View>;
  return <View style={liveWorkspaceStyles.card}>
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Abrir transmissão ${live.title}, ${state.label}`} disabled={disabled} onPress={onPress} style={({ pressed }) => [pressed && { opacity: 0.75 }]}>{cover}</Pressable> : cover}
    <View style={liveWorkspaceStyles.cardBody}><Text style={liveWorkspaceStyles.title} numberOfLines={2}>{live.title}</Text>
      <Text style={liveWorkspaceStyles.date}>{date}</Text>{children}</View>
  </View>;
}

export const liveWorkspaceStyles = StyleSheet.create({
  page: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 12, gap: 20 },
  heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
  sectionTitle: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 12 },
  detail: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  notice: { borderRadius: controls.buttonRadius, padding: 14, backgroundColor: colors.surface, gap: 8 },
  error: { color: colors.accent, fontSize: 12, lineHeight: 18 },
  empty: { alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 70 },
  card: { borderRadius: 14, overflow: 'hidden', backgroundColor: colors.backgroundElevated, borderWidth: 1, borderColor: colors.borderSubtle },
  cover: { width: '100%', aspectRatio: 16 / 9, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  coverBadge: { position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.8)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, flexDirection: 'row', gap: 6, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { color: colors.textSecondary, fontSize: 11, fontWeight: '500' },
  cardBody: { padding: 14, gap: 10 },
  title: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  date: { color: colors.mutedDim, fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  quietAction: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', gap: 7, alignItems: 'center', borderRadius: controls.buttonRadius },
  quietText: { color: colors.muted, fontSize: 12, fontWeight: '500' },
  primaryText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
});
