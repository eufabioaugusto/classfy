import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Monitor, X } from 'lucide-react-native';
import { PlanCrown } from '@/components/PlanCrown';
import { StudioCaptureSheet } from '@/features/studio/StudioCaptureSheet';
import { StudioCameraMonitorPanel } from '@/features/studio/StudioCameraMonitorPanel';
import type { StudioMonitorPublisherSnapshot } from '@/features/studio/cameraMonitorPublisher';

/** Visual QA only: bundled sample, fake monitor states, zero RPC/media capture. */
export default function StudioCameraMonitorQA() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevelopmentMonitor />;
}
function DevelopmentMonitor() {
  const params = useLocalSearchParams<{ format?: string; plan?: string }>(), router = useRouter(), insets = useSafeAreaInsets();
  const [portrait, setPortrait] = useState(params.format !== 'landscape'), [premium, setPremium] = useState(params.plan !== 'free');
  const [opened, setOpened] = useState(true);
  const [state, setState] = useState<StudioMonitorPublisherSnapshot>({ enabled: false, phase: 'off', viewerPresent: false, monitor: null, error: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const player = useVideoPlayer(portrait ? require('../../assets/studio-qa/portrait.mp4') : require('../../assets/studio-qa/landscape.mp4'), value => {
    value.loop = true; value.muted = true; value.play();
  });
  useEffect(() => {
    void ScreenOrientation.lockAsync(portrait ? ScreenOrientation.OrientationLock.PORTRAIT_UP : ScreenOrientation.OrientationLock.LANDSCAPE_LEFT);
    return () => { void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP); };
  }, [portrait]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <View style={styles.screen}>
    <StatusBar hidden style="light" />
    <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
    <View style={[styles.header, { top: Math.max(insets.top, 14), left: Math.max(insets.left, 18) }]}>
      <Pressable accessibilityLabel="Fechar QA visual" onPress={() => router.back()} style={styles.icon}><X size={23} color="#FFF" /></Pressable>
      <Pressable accessibilityLabel="Ver no computador" onPress={() => setOpened(true)} style={styles.monitor}>
        <Monitor size={20} color={state.phase === 'connected' ? '#75DCAF' : '#B1E8CF'} />
        <View style={styles.crown}><PlanCrown plan="premium" size={10} /></View>
      </Pressable>
    </View>
    <View style={[styles.qa, { bottom: Math.max(insets.bottom, 18) }]}>
      <Text style={styles.qaLabel}>QA VISUAL · SEM CONEXÃO OU GRAVAÇÃO REAL</Text>
      <View style={styles.actions}>
        <Pressable accessibilityLabel="Visualizar Aula" onPress={() => setPortrait(false)} style={styles.action}><Text style={styles.label}>Aula</Text></Pressable>
        <Pressable accessibilityLabel="Visualizar Short" onPress={() => setPortrait(true)} style={styles.action}><Text style={styles.label}>Short</Text></Pressable>
        <Pressable accessibilityLabel="Alternar plano simulado" onPress={() => setPremium(value => !value)} style={styles.action}><Text style={styles.label}>{premium ? 'Premium' : 'Free'}</Text></Pressable>
        {state.enabled && <Pressable accessibilityLabel="Simular navegador conectado" onPress={() => setState(value => ({ ...value, viewerPresent: !value.viewerPresent }))} style={styles.action}><Text style={styles.label}>Navegador</Text></Pressable>}
      </View>
    </View>
    <StudioCaptureSheet visible={opened} title="Ver no computador" onClose={() => setOpened(false)}>
      <StudioCameraMonitorPanel premium={premium} available ready state={state} onEnable={() => {
        setState({ enabled: true, phase: 'connecting', viewerPresent: false, monitor: null, error: null });
        timer.current = setTimeout(() => { timer.current = null; setState(value => ({ ...value, phase: 'connected' })); }, 350);
      }} onDisable={() => {
        if (timer.current) clearTimeout(timer.current); timer.current = null;
        setState({ enabled: false, phase: 'off', viewerPresent: false, monitor: null, error: null });
      }} onUpgrade={() => setPremium(true)} />
    </StudioCaptureSheet>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' }, header: { position: 'absolute', flexDirection: 'row', gap: 10 },
  icon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#0007', alignItems: 'center', justifyContent: 'center' },
  monitor: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#12352AEB', borderWidth: 1, borderColor: '#285B47', alignItems: 'center', justifyContent: 'center' },
  crown: { position: 'absolute', right: 2, bottom: 2, padding: 2, borderRadius: 7, backgroundColor: '#14231D' },
  qa: { position: 'absolute', alignSelf: 'center', padding: 12, borderRadius: 14, backgroundColor: '#121212DB', gap: 8 },
  qaLabel: { color: '#BBB', fontSize: 9, textAlign: 'center' }, actions: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  action: { padding: 11, borderRadius: 10, backgroundColor: '#272727' }, label: { color: '#FFF', fontSize: 12 },
});
