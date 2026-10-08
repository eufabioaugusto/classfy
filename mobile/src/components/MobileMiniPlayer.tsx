import { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { VideoView } from 'expo-video';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { colors } from '@/theme/colors';

export function MobileMiniPlayer() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const playback = useMiniPlayer();
  const { content, visible, player } = playback;
  const inStudio = pathname.startsWith('/studio');
  useEffect(() => {
    if (inStudio) playback.closeMiniPlayer();
  }, [inStudio]);
  if (inStudio || !visible || !content) return null;
  const expand = () => {
    playback.expand();
    if (__DEV__ && content.id === 'dev-player') { router.push('/dev/player'); return; }
    router.push({ pathname: '/watch/[id]', params: { id: content.id, ...(content.studyId ? { studyId: content.studyId } : {}), ...(content.lessonId ? { lessonId: content.lessonId } : {}) } });
  };
  const onTabs = ['/', '/study', '/messages', '/rewards', '/profile'].includes(pathname);
  return <View style={[styles.container, { bottom: insets.bottom + (onTabs ? 60 : 8) }]}>
    <Pressable accessibilityLabel={`Voltar ao vídeo ${content.title}`} style={styles.preview} onPress={expand}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} fullscreenOptions={{ enable: false }} />
    </Pressable>
    <Pressable style={styles.meta} onPress={expand}><Text style={styles.title} numberOfLines={1}>{content.title}</Text><Text style={styles.creator} numberOfLines={1}>{content.creatorName || 'Classfy'}</Text></Pressable>
    <Pressable accessibilityLabel={playback.playing ? 'Pausar miniplayer' : 'Reproduzir miniplayer'} style={styles.button} onPress={playback.togglePlay}><Ionicons name={playback.playing ? 'pause' : 'play'} size={24} color={colors.text} /></Pressable>
    <Pressable accessibilityLabel="Fechar miniplayer" style={styles.button} onPress={playback.closeMiniPlayer}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
    <View style={styles.track}><View style={[styles.progress, { width: `${playback.duration ? Math.min(100, playback.position / playback.duration * 100) : 0}%` }]} /></View>
  </View>;
}
const styles = StyleSheet.create({
  container: { position: 'absolute', left: 8, right: 8, height: 66, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceAlt, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  preview: { width: 100, height: 64, backgroundColor: '#000' },
  meta: { flex: 1, paddingHorizontal: 12, gap: 3 },
  title: { color: colors.text, fontSize: 13, fontWeight: '600' },
  creator: { color: colors.muted, fontSize: 11 },
  button: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, backgroundColor: colors.border },
  progress: { height: 2, backgroundColor: colors.accent },
});
