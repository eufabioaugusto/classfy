import { useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';
import { formatStudioEditorTime } from './model';

export function StudioTrimControl({ duration, start, end, onChange, disabled = false }: {
  duration: number; start: number; end: number; onChange: (start: number, end: number) => void; disabled?: boolean;
}) {
  const [width, setWidth] = useState(1);
  const current = useRef({ duration, start, end, onChange, disabled, width });
  current.current = { duration, start, end, onChange, disabled, width };
  const beginning = useRef(0);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 1;
  const safeStart = Math.max(0, Math.min(safeDuration, Number.isFinite(start) ? start : 0));
  const safeEnd = Math.max(safeStart, Math.min(safeDuration, Number.isFinite(end) ? end : safeDuration));
  const change = (handle: 'start' | 'end', value: number) => {
    const live = current.current;
    if (live.disabled) return;
    const rounded = Math.round(value * 10) / 10;
    const previousStart = Number.isFinite(live.start) ? live.start : 0;
    const previousEnd = Number.isFinite(live.end) ? live.end : live.duration;
    if (handle === 'start') live.onChange(Math.max(0, Math.min(previousEnd - 0.1, rounded)), previousEnd);
    else live.onChange(previousStart, Math.max(previousStart + 0.1, Math.min(live.duration, rounded)));
  };
  const startPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !current.current.disabled && Math.abs(gesture.dx) > 2,
    onPanResponderGrant: () => { beginning.current = current.current.start; },
    onPanResponderMove: (_, gesture) => change('start', beginning.current + gesture.dx / current.current.width * current.current.duration),
    onPanResponderTerminationRequest: () => false,
  }), []);
  const endPan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => !current.current.disabled,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !current.current.disabled && Math.abs(gesture.dx) > 2,
    onPanResponderGrant: () => { beginning.current = current.current.end; },
    onPanResponderMove: (_, gesture) => change('end', beginning.current + gesture.dx / current.current.width * current.current.duration),
    onPanResponderTerminationRequest: () => false,
  }), []);
  const gestureWidth = Math.max(1, width);
  return <View style={{ gap: 5 }}>
    <View style={styles.control} onLayout={event => setWidth(Math.max(1, event.nativeEvent.layout.width - 44))}>
      <View style={styles.track}><View style={[styles.selection, { left: `${safeStart / safeDuration * 100}%`, width: `${(safeEnd - safeStart) / safeDuration * 100}%` }]} /></View>
      <View {...startPan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Início do corte"
        accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: safeDuration, now: safeStart }}
        accessibilityActions={[{ name: 'increment', label: 'Avançar meio segundo' }, { name: 'decrement', label: 'Voltar meio segundo' }]}
        onAccessibilityAction={event => change('start', safeStart + (event.nativeEvent.actionName === 'increment' ? 0.5 : -0.5))}
        style={[styles.handleTouch, { left: safeStart / safeDuration * gestureWidth }]}><View style={styles.handle}><View style={styles.grip} /></View></View>
      <View {...endPan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel="Fim do corte"
        accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: safeDuration, now: safeEnd }}
        accessibilityActions={[{ name: 'increment', label: 'Avançar meio segundo' }, { name: 'decrement', label: 'Voltar meio segundo' }]}
        onAccessibilityAction={event => change('end', safeEnd + (event.nativeEvent.actionName === 'increment' ? 0.5 : -0.5))}
        style={[styles.handleTouch, { left: safeEnd / safeDuration * gestureWidth }]}><View style={styles.handle}><View style={styles.grip} /></View></View>
    </View>
    <View style={styles.labels}><Text style={styles.label}>{formatStudioEditorTime(safeStart)}</Text><Text style={styles.label}>{formatStudioEditorTime(Math.max(0, safeEnd - safeStart))} selecionados</Text><Text style={styles.label}>{formatStudioEditorTime(safeEnd)}</Text></View>
  </View>;
}

const styles = StyleSheet.create({
  control: { height: 52, width: '100%' },
  track: { position: 'absolute', top: 12, left: 22, right: 22, height: 28, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  selection: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.accent, opacity: 0.6 },
  handleTouch: { position: 'absolute', top: 0, width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 12, height: 38, backgroundColor: colors.text, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2, height: 16, borderRadius: 1, backgroundColor: colors.surfaceAlt },
  labels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  label: { fontSize: 10, color: colors.muted, fontVariant: ['tabular-nums'] },
});
