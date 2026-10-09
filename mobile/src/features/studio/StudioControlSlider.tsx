import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { colors } from '@/theme/colors';

export function studioSliderValue(value: number, min: number, max: number, step: number) {
  if (![min, max].every(Number.isFinite) || max <= min) return min;
  const safe = Number.isFinite(value) ? value : min;
  const quantum = Number.isFinite(step) && step > 0 ? step : (max - min) / 1000;
  return Math.max(min, Math.min(max, Math.round((min + Math.round((safe - min) / quantum) * quantum) * 1e6) / 1e6));
}
export function studioSliderPosition(x: number, width: number, min: number, max: number, step: number) {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return undefined;
  return studioSliderValue(min + Math.max(0, Math.min(1, x / width)) * (max - min), min, max, step);
}
type Props = {
  label: string; value: number; min: number; max: number; step: number; disabled?: boolean;
  onChange: (value: number) => void; formatValue?: (value: number) => string;
  onInteractionStart?: () => void; onInteractionEnd?: (cancelled: boolean) => void;
};
type Interaction = { original: number; last: number; width: number; min: number; max: number; step: number;
  change: Props['onChange']; end?: Props['onInteractionEnd'] };

/** A cancelled finger drag restores its own parameter, including after a tab change. */
export function StudioControlSlider(props: Props) {
  const [width, setWidth] = useState(1), [dragging, setDragging] = useState(false);
  const live = useRef(props); live.current = props;
  const active = useRef<Interaction | undefined>(undefined);
  const mounted = useRef(true);
  const blocked = !!props.disabled || props.max <= props.min;
  const value = studioSliderValue(props.value, props.min, props.max, props.step);
  const fraction = props.max > props.min ? (value - props.min) / (props.max - props.min) : 0;
  const finish = (cancelled: boolean) => {
    const interaction = active.current;
    if (!interaction) return;
    active.current = undefined;
    if (cancelled) interaction.change(interaction.original);
    interaction.end?.(cancelled);
    if (mounted.current) setDragging(false);
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; finish(true); };
  }, []);
  useEffect(() => { finish(true); }, [props.disabled, props.label, props.min, props.max, props.step]);
  const move = (event?: GestureResponderEvent) => {
    const interaction = active.current;
    if (!interaction) return;
    const next = studioSliderPosition((event?.nativeEvent?.locationX ?? NaN) - 10, Math.max(1, interaction.width - 20), interaction.min, interaction.max, interaction.step);
    if (next !== undefined && next !== interaction.last) { interaction.last = next; interaction.change(next); }
  };
  const grant = (event: GestureResponderEvent) => {
    const current = live.current;
    if (current.disabled || current.max <= current.min || active.current || width <= 1) return;
    const original = studioSliderValue(current.value, current.min, current.max, current.step);
    active.current = { original, last: original, width, min: current.min, max: current.max, step: current.step,
      change: current.onChange, end: current.onInteractionEnd };
    setDragging(true); current.onInteractionStart?.(); move(event);
  };
  const increment = (direction: number) => {
    const current = live.current;
    if (current.disabled || active.current || current.max <= current.min) return;
    current.onChange(studioSliderValue(current.value + current.step * direction, current.min, current.max, current.step));
    current.onInteractionEnd?.(false);
  };
  return <View style={[s.control, blocked && s.disabled]}>
    <View style={s.caption}><Text style={s.label}>{props.label}</Text><Text style={s.value}>{props.formatValue ? props.formatValue(value) : String(value)}</Text></View>
    <View style={s.row}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Diminuir ${props.label}`} disabled={blocked || dragging} onPress={() => increment(-1)} style={({ pressed }) => [s.button, pressed && s.pressed]}><Minus size={20} color={colors.text} strokeWidth={1.6} /></Pressable>
      <View accessibilityRole="adjustable" accessibilityLabel={props.label} accessibilityState={{ disabled: blocked }}
        accessibilityValue={{ min: props.min, max: props.max, now: value, text: props.formatValue?.(value) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') increment(1); else if (event.nativeEvent.actionName === 'decrement') increment(-1); }}
        onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width))}
        onStartShouldSetResponder={() => !blocked} onMoveShouldSetResponder={() => !blocked}
        onResponderGrant={grant} onResponderMove={move} onResponderRelease={event => { move(event); finish(false); }}
        onResponderTerminate={() => finish(true)} onResponderTerminationRequest={() => !active.current}
        style={s.hitArea}>
        <View pointerEvents="none" style={s.track}><View style={[s.fill, { width: `${fraction * 100}%` }]} /></View>
        <View pointerEvents="none" style={[s.thumb, { left: Math.max(0, Math.min(width - 20, fraction * (width - 20))) }]} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Aumentar ${props.label}`} disabled={blocked || dragging} onPress={() => increment(1)} style={({ pressed }) => [s.button, pressed && s.pressed]}><Plus size={20} color={colors.text} strokeWidth={1.6} /></Pressable>
    </View>
  </View>;
}
const s = StyleSheet.create({
  control: { paddingHorizontal: 10, paddingTop: 5, paddingBottom: 2 }, disabled: { opacity: 0.4 },
  caption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  label: { fontSize: 12, color: colors.textSecondary, fontWeight: '500' }, value: { fontSize: 12, color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  pressed: { backgroundColor: colors.surfaceMuted }, hitArea: { height: 48, flex: 1, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#3B3B3F', marginHorizontal: 10 }, fill: { height: 4, borderRadius: 2, backgroundColor: colors.text },
  thumb: { position: 'absolute', top: 14, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.text, borderWidth: 2, borderColor: '#D2D2D5' },
});
