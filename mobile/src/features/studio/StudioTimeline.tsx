import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Film, Mic } from 'lucide-react-native';
import { LoadingImage } from '@/components/LoadingImage';
import { colors } from '@/theme/colors';
import { formatStudioDuration, timelineDuration, type StudioTake } from './model';

export function StudioTimeline({ takes, position, activeTakeId, audio, onSeek, onSelect, compact = false, showClips = true }: {
  takes: readonly StudioTake[]; position: number; activeTakeId?: string; audio?: boolean; compact?: boolean; showClips?: boolean;
  onSeek: (seconds: number) => void; onSelect: (take: StudioTake) => void;
}) {
  const duration = timelineDuration(takes);
  const width = useRef(1);
  const lastSeek = useRef(0);
  const live = useRef({ duration, onSeek }); live.current = { duration, onSeek };
  const strip = useRef<ScrollView>(null);
  const clipWidths = takes.map(take => Math.min(190, Math.max(90, Math.sqrt(take.end - take.start) * 42)));
  const selectedIndex = takes.findIndex(take => take.id === activeTakeId);
  useEffect(() => {
    if (selectedIndex >= 0) strip.current?.scrollTo({ x: Math.max(0, clipWidths.slice(0, selectedIndex).reduce((sum, value) => sum + value + 4, 0) - 24), animated: true });
  }, [activeTakeId]);
  const scrub = (x: number, final = false) => {
    const now = Date.now();
    if (!final && now - lastSeek.current < 33) return;
    lastSeek.current = now;
    live.current.onSeek(Math.max(0, Math.min(1, x / width.current)) * live.current.duration);
  };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => live.current.duration > 0,
    onMoveShouldSetPanResponder: () => live.current.duration > 0,
    onPanResponderGrant: event => scrub(event.nativeEvent.locationX, true),
    onPanResponderMove: event => scrub(event.nativeEvent.locationX),
    onPanResponderRelease: event => scrub(event.nativeEvent.locationX, true),
    onPanResponderTerminationRequest: () => false,
  }), []);
  let cursor = 0;
  return <View style={styles.timeline}>
    {showClips ? <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {takes.map((take, index) => {
        const start = cursor; cursor += take.end - take.start;
        const fraction = Math.max(0, Math.min(1, (position - start) / Math.max(0.1, take.end - take.start)));
        const active = take.id === activeTakeId;
        return <Pressable key={take.id} accessibilityRole="button" accessibilityLabel={`Selecionar take ${index + 1}, ${formatStudioDuration(take.end - take.start)}`} accessibilityState={{ selected: active }} onPress={() => onSelect(take)}
          style={[styles.clip, { width: clipWidths[index], height: compact ? 44 : 58 }, active && styles.selected]}>
          {take.thumbnailUri && !audio ? <LoadingImage source={{ uri: take.thumbnailUri }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : <View style={styles.audio}><Mic size={18} color={colors.muted} strokeWidth={1.4} /></View>}
          <View style={styles.shade} />
          <Text style={styles.number}>{String(index + 1).padStart(2, '0')}</Text>
          <Text style={styles.duration}>{formatStudioDuration(take.end - take.start)}</Text>
          {active ? <View pointerEvents="none" style={[styles.playhead, { left: `${fraction * 100}%` }]} /> : null}
        </Pressable>;
      })}
      {!takes.length ? <View style={[styles.empty, { height: compact ? 44 : 58 }]}><Film size={17} color={colors.mutedDim} strokeWidth={1.4} /><Text style={styles.emptyText}>Seus takes aparecem aqui</Text></View> : null}
    </ScrollView> : null}
    {takes.length ? <View {...pan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Posição da montagem"
      accessibilityValue={{ min: 0, max: duration, now: position }} accessibilityActions={[{ name: 'increment', label: 'Avançar um segundo' }, { name: 'decrement', label: 'Voltar um segundo' }]}
      onAccessibilityAction={event => onSeek(Math.max(0, Math.min(duration, position + (event.nativeEvent.actionName === 'increment' ? 1 : -1))))}
      onLayout={event => { width.current = Math.max(1, event.nativeEvent.layout.width); }} style={styles.scrub}>
      <View pointerEvents="none" style={styles.track}><View style={[styles.progress, { width: `${Math.max(0, Math.min(1, position / Math.max(0.1, duration))) * 100}%` }]} /></View>
      <View pointerEvents="none" style={[styles.dot, { left: `${Math.max(0, Math.min(1, position / Math.max(0.1, duration))) * 100}%` }]} />
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  timeline: { gap: 0 }, strip: { gap: 4, alignItems: 'center', paddingHorizontal: 2 },
  clip: { borderRadius: 7, overflow: 'hidden', backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  selected: { borderColor: colors.text, borderWidth: 2 }, audio: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)' },
  number: { position: 'absolute', left: 6, top: 4, color: colors.text, fontSize: 10, fontWeight: '600' },
  duration: { position: 'absolute', right: 6, bottom: 4, color: colors.text, fontSize: 10, fontVariant: ['tabular-nums'] },
  playhead: { width: 2, top: 0, bottom: 0, position: 'absolute', backgroundColor: colors.accent },
  empty: { width: '100%', minWidth: 240, gap: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 8 },
  emptyText: { fontSize: 12, color: colors.mutedDim },
  scrub: { height: 32, justifyContent: 'center', marginHorizontal: 6 }, track: { height: 2, backgroundColor: colors.border, borderRadius: 2 },
  progress: { height: 2, backgroundColor: colors.text, borderRadius: 2 },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, marginLeft: -4, backgroundColor: colors.text },
});
