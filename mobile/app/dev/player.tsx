import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import * as ScreenOrientation from 'expo-screen-orientation';
import { Pressable, StyleSheet, Text, View, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ClassfyVideoPlayer } from '@/components/ClassfyVideoPlayer';
import { useMiniPlayer } from '@/features/watch/miniPlayerContext';
import { colors } from '@/theme/colors';

const session = { id: 'dev-player', title: 'Prévia do player nativo', creatorName: 'Classfy Dev', trackingEnabled: false };
export default function PlayerPreview() {
  const playback = useMiniPlayer();
  const insets = useSafeAreaInsets();
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => () => { StatusBar.setHidden(false); void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); }, []);
  const toggleFullscreen = (next: boolean) => {
    setFullscreen(next); StatusBar.setHidden(next);
    void ScreenOrientation.lockAsync(next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP);
  };
  if (!__DEV__) return <Redirect href="/" />;
  const minimize = () => { playback.startMiniPlayer(session); router.replace('/'); };
  return <View style={[styles.screen, { paddingTop: fullscreen ? 0 : insets.top }]}>
    <ClassfyVideoPlayer session={session} src="https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" title={session.title} creatorName={session.creatorName} onMinimize={minimize} isFullscreen={fullscreen} onFullscreenToggle={toggleFullscreen} />
    <View style={styles.details}><Text style={styles.title}>Player • prévia de desenvolvimento</Text><Text style={styles.description}>Vídeo público de exemplo. Este teste não registra progresso nem concede Points.</Text><Text style={styles.description}>Posição: {Math.floor(playback.position)}s · {playback.playing ? 'Reproduzindo' : 'Pausado'}</Text>
    <Pressable style={styles.button} onPress={minimize}><Text style={styles.title}>Minimizar e navegar</Text></Pressable>
    <Pressable style={styles.button} onPress={() => playback.seek(playback.position + 30)}><Text style={styles.title}>Avançar 30 segundos</Text></Pressable>
    <Pressable style={styles.button} onPress={() => { playback.closeMiniPlayer(); router.replace('/'); }}><Text style={styles.title}>Encerrar prévia</Text></Pressable></View>
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: colors.background }, details: { padding: 20, gap: 16 }, title: { color: colors.text, fontSize: 16, fontWeight: '600' }, description: { color: colors.muted, fontSize: 14 }, button: { backgroundColor: colors.surfaceAlt, borderRadius: 12, padding: 16 } });
