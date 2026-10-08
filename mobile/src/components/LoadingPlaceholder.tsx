import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

// One slow opacity animation per group, with no flashing or moving highlight.
export function SkeletonGroup({ children, label = 'Carregando conteúdo', style }: PropsWithChildren<{ label?: string; style?: ViewStyle }>) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) setReduceMotion(value); });
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const app = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);
  useEffect(() => {
    if (reduceMotion || !active) { opacity.setValue(1); return; }
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.7, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    pulse.start();
    return () => { pulse.stop(); opacity.setValue(1); };
  }, [active, reduceMotion, opacity]);
  return <Animated.View accessible accessibilityLabel={label} accessibilityState={{ busy: true }} style={[style, { opacity }]}>
    {children}
  </Animated.View>;
}
export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  return <View style={[styles.block, style]} />;
}
function CardShape() {
  return <View style={styles.card}>
    <SkeletonBlock style={{ aspectRatio: 16 / 9, borderRadius: 12 }} />
    <View style={styles.row}>
      <SkeletonBlock style={{ width: 36, height: 36, borderRadius: 18 }} />
      <View style={styles.copy}><SkeletonBlock style={{ height: 14 }} /><SkeletonBlock style={{ width: '75%', height: 14 }} /><SkeletonBlock style={{ width: '45%', height: 10 }} /></View>
    </View>
  </View>;
}
export function LoadingPlaceholder({ variant = 'cards', inset = true }: {
  variant?: 'home' | 'discovery' | 'cards' | 'library' | 'list' | 'dashboard' | 'creator'; inset?: boolean;
}) {
  return <SkeletonGroup><View style={inset ? styles.inset : undefined}>
    {variant === 'home' ? <>
      <SkeletonBlock style={{ height: 480, borderRadius: 18, marginBottom: 32 }} />
      <SkeletonBlock style={{ width: '60%', height: 20, marginBottom: 18 }} />
      <View style={[styles.row, { overflow: 'hidden', marginBottom: 32 }]}>
        <SkeletonBlock style={{ width: '64%', aspectRatio: 3 / 5, borderRadius: 16 }} />
        <SkeletonBlock style={{ width: '64%', aspectRatio: 3 / 5, borderRadius: 16 }} />
      </View><CardShape />
    </> : variant === 'discovery' ? <>
      <SkeletonBlock style={{ aspectRatio: 16 / 9, borderRadius: 0, marginBottom: 2 }} />
      {[0, 1, 2].map(row => <View key={row} style={{ flexDirection: 'row', gap: 2, marginBottom: 2 }}>
        {[0, 1, 2].map(column => <SkeletonBlock key={column} style={{ flex: 1, aspectRatio: 3 / 4, borderRadius: 0 }} />)}
      </View>)}
    </> : variant === 'dashboard' ? <>
      {[180, 240, 160].map((height, index) => <View key={index} style={[styles.panel, { minHeight: height }]}>
        <SkeletonBlock style={{ height: 16, width: '55%' }} />
        <SkeletonBlock style={{ height: 28, width: '40%' }} />
        <SkeletonBlock style={{ height: 12, width: '85%' }} />
        <SkeletonBlock style={{ height: 12, width: '65%' }} />
      </View>)}
    </> : variant === 'creator' ? <>
      <SkeletonBlock style={{ height: 190, borderRadius: 0 }} />
      <View style={{ padding: 24, gap: 16 }}>
        <SkeletonBlock style={{ width: 88, height: 88, borderRadius: 44 }} />
        <SkeletonBlock style={{ height: 20, width: '65%' }} />
        <SkeletonBlock style={{ height: 12, width: '80%' }} /><CardShape />
      </View>
    </> : variant === 'cards' ? <><CardShape /><CardShape /><CardShape /></> : <>
      {[0, 1, 2, 3].map(index => <View key={index} style={styles.listRow}>
        <SkeletonBlock style={variant === 'list' ? { width: 40, height: 40, borderRadius: 20 } : { width: 112, aspectRatio: 16 / 9, borderRadius: 8 }} />
        <View style={styles.copy}><SkeletonBlock style={{ height: 14 }} /><SkeletonBlock style={{ height: 12, width: '75%' }} /><SkeletonBlock style={{ height: 10, width: '45%' }} /></View>
      </View>)}
    </>}
  </View></SkeletonGroup>;
}
const styles = StyleSheet.create({
  block: { backgroundColor: '#1B1B1B', borderRadius: 6 },
  inset: { paddingHorizontal: 20, paddingTop: 16 },
  card: { marginBottom: 24 },
  row: { flexDirection: 'row', gap: 12, marginTop: 12 },
  copy: { flex: 1, gap: 8 },
  listRow: { flexDirection: 'row', gap: 12, paddingVertical: 16 },
  panel: { padding: 20, gap: 20, borderRadius: 16, borderWidth: 1, borderColor: '#181818', marginBottom: 24 },
});
