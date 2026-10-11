import { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

export const authColors = { brand: '#EF5066', text: '#F7F5F6', secondary: '#AAA5A9', surface: '#121114', border: '#302B30' };

function AmbientLight() {
  const motion = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (mounted) setReduceMotion(enabled); });
    const accessibility = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const appState = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => { mounted = false; accessibility.remove(); appState.remove(); };
  }, []);
  useFocusEffect(useCallback(() => {
    motion.setValue(0);
    if (reduceMotion || !active) return;
    // Animate only opacity/translation, keeping vector lighting static.
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(motion, { toValue: 1, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(motion, { toValue: 0, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [active, motion, reduceMotion]));
  return <Animated.View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, {
    opacity: motion.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }),
    transform: [{ translateY: motion.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] }) }],
  }]}>
    <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 400 900">
      <Defs>
        <RadialGradient id="auth-light-top" cx="88%" cy="22%" rx="85%" ry="42%"><Stop offset="0" stopColor={authColors.brand} stopOpacity="0.23" /><Stop offset="0.45" stopColor={authColors.brand} stopOpacity="0.08" /><Stop offset="1" stopColor={authColors.brand} stopOpacity="0" /></RadialGradient>
        <RadialGradient id="auth-light-bottom" cx="0%" cy="78%" rx="75%" ry="35%"><Stop offset="0" stopColor={authColors.brand} stopOpacity="0.12" /><Stop offset="1" stopColor={authColors.brand} stopOpacity="0" /></RadialGradient>
      </Defs>
      <Rect width="400" height="900" fill="url(#auth-light-top)" /><Rect width="400" height="900" fill="url(#auth-light-bottom)" />
    </Svg>
  </Animated.View>;
}

export function AuthScene({ children, title, subtitle, onBack, dense = false }: PropsWithChildren<{ title: string; subtitle: string; onBack?: () => void; dense?: boolean }>) {
  const { height } = useWindowDimensions();
  const compact = dense || height < 740;
  return <View style={styles.screen}>
    <AmbientLight />
    <SafeAreaView style={styles.safe}>
      <View style={styles.navigation}><Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onBack ?? (() => router.canGoBack() ? router.back() : router.replace('/(tabs)'))} style={({ pressed }) => [styles.back, pressed && styles.pressed]}><ArrowLeft color={authColors.text} size={21} strokeWidth={1.8} /></Pressable></View>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, compact && styles.compactContent]}>
          <View style={styles.column}>
            <View style={[styles.brand, compact && styles.compactBrand]} accessible accessibilityLabel="Classfy">
              <Svg width={42} height={44} viewBox="0 0 312 324" accessible={false}><G transform="scale(0.9876543209876543) translate(-94 -75)"><Path fill={authColors.brand} d="M146 79 C205 105 322 154 380 204 C397 219 405 230 405 242 C405 256 395 270 380 282 C326 323 226 384 171 395 C156 399 144 397 135 391 C117 380 109 359 109 341 C109 324 113 310 122 319 C136 328 156 332 179 328 C211 323 236 301 252 273 C225 292 195 305 168 305 C125 305 99 277 95 231 C94 216 93 208 101 214 C122 232 146 242 172 245 C201 249 229 239 247 217 C221 230 194 227 169 218 C132 204 110 175 103 145 C95 116 105 89 121 80 C129 75 138 75 146 79 Z" /></G></Svg>
              <Text style={styles.wordmark}>Classfy</Text>
            </View>
            <View style={[styles.heading, compact && styles.compactHeading]}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
            {children}
          </View>
          {!dense && <Text style={[styles.signature, compact && styles.compactSignature]}>APRENDA. CRIE. VÁ ALÉM.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#050405' }, safe: { flex: 1 },
  navigation: { height: 52, paddingHorizontal: 22, justifyContent: 'center' },
  back: { width: 44, height: 44, borderRadius: 22, borderColor: 'rgba(255,255,255,0.12)', borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)' },
  pressed: { opacity: 0.7 },
  content: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingTop: 20, paddingBottom: 24 },
  compactContent: { paddingTop: 12, paddingBottom: 20 }, column: { width: '100%', maxWidth: 420 },
  brand: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12, marginBottom: 28 }, compactBrand: { marginBottom: 18 },
  wordmark: { fontSize: 34, fontWeight: '700', letterSpacing: -1.8, color: authColors.text },
  heading: { alignItems: 'center', gap: 8, marginBottom: 24 },
  compactHeading: { marginBottom: 18 },
  title: { color: authColors.text, fontSize: 27, fontWeight: '600', letterSpacing: -0.9, textAlign: 'center' },
  subtitle: { color: authColors.secondary, fontSize: 14, lineHeight: 21, textAlign: 'center', maxWidth: 340 },
  signature: { color: '#847B80', fontSize: 10, letterSpacing: 2.2, marginTop: 24, textAlign: 'center' },
  compactSignature: { marginTop: 16 },
});
