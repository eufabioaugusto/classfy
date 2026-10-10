import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Mic, Video } from 'lucide-react-native';
import { LoadingImage } from '@/components/LoadingImage';
import { colors } from '@/theme/colors';
import { formatStudioDuration, studioTakeDuration, type StudioTake } from './model';

type Props = {
  takes: StudioTake[];
  disabled: boolean;
  onContinue: () => void;
  compact?: boolean;
};

/** Shows persisted takes only; recording and project ownership remain with the capture route. */
export function StudioCaptureTakes(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const mounted = useRef(true);
  const scroll = useRef<ScrollView | null>(null);
  const revealed = useRef<string | undefined>(undefined);
  const lastTake = props.takes.at(-1);
  const revealKey = lastTake ? `${props.takes.length}:${lastTake.id}` : undefined;
  const pendingReveal = useRef(revealKey);
  const previousKey = useRef(revealKey);
  if (previousKey.current !== revealKey) {
    previousKey.current = revealKey;
    pendingReveal.current = revealKey;
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const revealLatest = () => {
    if (!mounted.current || !pendingReveal.current || !scroll.current) return;
    const key = pendingReveal.current;
    scroll.current.scrollToEnd({ animated: revealed.current !== undefined });
    revealed.current = key;
    pendingReveal.current = undefined;
  };
  const count = props.takes.length;
  if (!count) return null;

  return <View style={[styles.bar, props.compact && styles.compactBar]}>
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false}
      accessibilityLabel="Takes gravados" style={styles.scroll} contentContainerStyle={styles.takes}
      onContentSizeChange={revealLatest}>
      {props.takes.map((take, index) => {
        const duration = formatStudioDuration(studioTakeDuration(take));
        const Fallback = take.kind === 'audio' ? Mic : Video;
        return <View key={take.id} accessible accessibilityLabel={`Take ${index + 1}, ${duration}`}
          style={styles.take}>
          <View style={styles.fallback}><Fallback color={colors.muted} size={21} strokeWidth={1.5} /></View>
          {take.thumbnailUri && <LoadingImage source={{ uri: take.thumbnailUri }} style={styles.thumbnail}
            contentFit="cover" transition={0} accessible={false} />}
          <View pointerEvents="none" style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View>
          <View pointerEvents="none" style={styles.duration}><Text style={styles.durationText}>{duration}</Text></View>
        </View>;
      })}
    </ScrollView>
    <Pressable accessibilityRole="button"
      accessibilityLabel={`Avançar para editar ${count} ${count === 1 ? 'take' : 'takes'}`}
      accessibilityState={{ disabled: props.disabled }} disabled={props.disabled}
      onPress={() => {
        const current = latest.current;
        if (mounted.current && !current.disabled && current.takes.length) current.onContinue();
      }}
      style={({ pressed }) => [styles.continue, props.disabled && styles.disabled, pressed && styles.pressed]}>
      <View style={styles.continueCircle}><ChevronRight color="#080808" size={24} strokeWidth={1.8} /></View>
      <Text style={styles.continueText}>Avançar</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  bar: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 14,
    borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: 'rgba(8,8,8,0.94)' },
  compactBar: { gap: 12 },
  scroll: { flex: 1, minWidth: 0, height: 62 },
  takes: { alignItems: 'center', gap: 7 },
  take: { width: 52, height: 62, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceAlt,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  thumbnail: { width: '100%', height: '100%' },
  number: { position: 'absolute', left: 3, top: 3, minWidth: 16, height: 16, paddingHorizontal: 3,
    alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.65)' },
  numberText: { color: '#FFFFFF', fontSize: 10, fontWeight: '600' },
  duration: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingVertical: 3,
    backgroundColor: 'rgba(0,0,0,0.64)' },
  durationText: { color: '#FFFFFF', fontSize: 10, fontWeight: '500', fontVariant: ['tabular-nums'] },
  continue: { width: 58, height: 64, alignItems: 'center', justifyContent: 'center', gap: 3 },
  continueCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  continueText: { color: '#FFFFFF', fontSize: 11, lineHeight: 12, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
});
