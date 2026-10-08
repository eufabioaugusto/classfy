import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import { colors } from '@/theme/colors';
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function StudioCaptureZoom({ value, onChange, label, disabled, style, controlName = 'zoom' }: {
  value: number; onChange: (value: number) => void; label: string; disabled?: boolean; style?: ViewStyle; controlName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const valueRef = useRef(value); valueRef.current = value;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const base = useRef(0);
  const collapse = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<ReturnType<typeof setInterval> | null>(null);
  const holding = useRef(false);
  function stopHold() { if (hold.current) clearInterval(hold.current); hold.current = null; }
  function keepOpen() { if (collapse.current) clearTimeout(collapse.current); collapse.current = null; setExpanded(true); }
  function scheduleClose() {
    if (collapse.current) clearTimeout(collapse.current);
    collapse.current = setTimeout(() => setExpanded(false), 2200);
  }
  function nudge(direction: number) { if (!disabledRef.current) onChangeRef.current(clamp(valueRef.current + direction * 0.025)); }
  function startHold(direction: number) {
    holding.current = true; keepOpen(); nudge(direction);
    hold.current = setInterval(() => nudge(direction), 85);
  }
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !disabledRef.current && Math.abs(gesture.dx) > 3,
    onMoveShouldSetPanResponderCapture: (_, gesture) => !disabledRef.current && Math.abs(gesture.dx) > 3,
    onPanResponderGrant: () => { base.current = valueRef.current; keepOpen(); },
    onPanResponderMove: (_, gesture) => onChangeRef.current(clamp(base.current + gesture.dx / 400)),
    onPanResponderRelease: scheduleClose,
    onPanResponderTerminate: scheduleClose,
    onPanResponderTerminationRequest: () => true,
  }), []);
  useEffect(() => () => { stopHold(); if (collapse.current) clearTimeout(collapse.current); }, []);
  useEffect(() => { if (disabled) { stopHold(); setExpanded(false); } }, [disabled]);
  return <View style={[zoomStyles.container, expanded && zoomStyles.expanded, style]}>
    {expanded && <View pointerEvents="none" style={zoomStyles.dial}>
      <View style={[zoomStyles.ticks, { transform: [{ translateX: -value * 400 }] }]}>
        {Array.from({ length: 41 }, (_, index) => <View key={index} style={zoomStyles.tickCell}>
          <View style={[zoomStyles.tick, index % 5 === 0 && zoomStyles.tickMajor]} />
        </View>)}
      </View><View style={zoomStyles.needle} />
    </View>}
    <View style={zoomStyles.controls}>
      {([-1, 1] as const).map((direction, index) => <View key={direction} style={index === 1 ? { flexDirection: 'row', alignItems: 'center' } : undefined}>
        {index === 1 && <Pressable {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={`${controlName} da câmera`}
          accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100), text: label }}
          accessibilityActions={[{ name: 'increment', label: `Aumentar ${controlName}` }, { name: 'decrement', label: `Diminuir ${controlName}` }]}
          onAccessibilityAction={event => nudge(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
          disabled={disabled} onPress={() => { if (expanded) setExpanded(false); else { keepOpen(); scheduleClose(); } }} onLongPress={keepOpen}
          style={zoomStyles.labelButton}><Text style={zoomStyles.label}>{label}</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={direction > 0 ? `Aumentar ${controlName}: segure para ajustar` : `Diminuir ${controlName}: segure para ajustar`}
          disabled={disabled || (direction < 0 ? value <= 0 : value >= 1)} delayLongPress={260}
          onPressIn={() => { holding.current = false; }} onLongPress={() => startHold(direction)}
          onPressOut={() => { stopHold(); if (holding.current) scheduleClose(); }}
          onPress={() => { if (!holding.current) nudge(direction); }}
          style={({ pressed }) => [zoomStyles.nudge, pressed && { backgroundColor: 'rgba(255,255,255,0.08)' }]}>
          {direction < 0 ? <Minus size={16} color={colors.text} /> : <Plus size={16} color={colors.text} />}
        </Pressable>
      </View>)}
    </View>
    {expanded && <Text pointerEvents="none" style={zoomStyles.hint}>Deslize para ajustar</Text>}
  </View>;
}

const distance = (event: GestureResponderEvent) => {
  const touches = event.nativeEvent.touches;
  return touches.length >= 2 ? Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY) : 0;
};
export function StudioCaptureFrame({ children, frame, zoom, onZoom, disabled, onFocus, canLockFocus }: {
  children: ReactNode; frame: { left: number; top: number; width: number; height: number }; zoom: number;
  onZoom: (value: number) => void; disabled?: boolean; onFocus?: (point: { x: number; y: number; locked: boolean }) => void; canLockFocus?: boolean;
}) {
  const live = useRef({ zoom, onZoom, disabled, onFocus, canLockFocus, frame }); live.current = { zoom, onZoom, disabled, onFocus, canLockFocus, frame };
  const pinch = useRef({ distance: 0, zoom: 0 });
  const tap = useRef({ x: 0, y: 0, started: 0, moved: false, pinched: false, locked: false });
  const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; locked: boolean } | null>(null);
  function clearLongPress() { if (longPress.current) clearTimeout(longPress.current); longPress.current = null; }
  function focus(x: number, y: number, locked: boolean) {
    if (!live.current.onFocus || live.current.disabled) return;
    const box = live.current.frame;
    const point = { x: clamp((x - box.left) / box.width), y: clamp((y - box.top) / box.height), locked };
    live.current.onFocus(point); setFocusPoint(point);
    if (hide.current) clearTimeout(hide.current);
    if (!locked) hide.current = setTimeout(() => setFocusPoint(null), 1500);
  }
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: event => !live.current.disabled && event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponderCapture: event => !live.current.disabled && event.nativeEvent.touches.length >= 2,
    onPanResponderGrant: event => { clearLongPress(); tap.current.pinched = true; pinch.current = { distance: distance(event), zoom: live.current.zoom }; },
    onPanResponderMove: event => {
      const next = distance(event);
      if (next > 0 && pinch.current.distance > 0) live.current.onZoom(clamp(pinch.current.zoom + Math.log(next / pinch.current.distance) * 0.22));
    },
    onPanResponderRelease: () => { pinch.current.distance = 0; },
    onPanResponderTerminate: () => { pinch.current.distance = 0; clearLongPress(); },
  }), []);
  useEffect(() => () => { clearLongPress(); if (hide.current) clearTimeout(hide.current); }, []);
  return <View {...pan.panHandlers} style={[frameStyles.frame, frame]} onTouchStart={event => {
    clearLongPress();
    if (event.nativeEvent.touches.length !== 1) { tap.current.pinched = true; return; }
    const touch = event.nativeEvent.touches[0];
    tap.current = { x: touch.pageX, y: touch.pageY, started: Date.now(), moved: false, pinched: false, locked: false };
    if (live.current.canLockFocus && live.current.onFocus && !live.current.disabled) longPress.current = setTimeout(() => {
      if (!tap.current.moved && !tap.current.pinched) { tap.current.locked = true; focus(tap.current.x, tap.current.y, true); }
    }, 650);
  }} onTouchMove={event => {
    const touch = event.nativeEvent.touches[0];
    if (event.nativeEvent.touches.length > 1 || !touch || Math.hypot(touch.pageX - tap.current.x, touch.pageY - tap.current.y) > 8) {
      tap.current.moved = true; clearLongPress();
    }
  }} onTouchEnd={() => {
    clearLongPress(); const press = tap.current;
    if (!press.moved && !press.pinched && !press.locked && Date.now() - press.started < 400) focus(press.x, press.y, false);
  }}>
    {children}
    {focusPoint && <View pointerEvents="none" style={[frameStyles.focus, { left: focusPoint.x * frame.width - 24, top: focusPoint.y * frame.height - 24 }]}>
      {focusPoint.locked && <Text style={frameStyles.focusLabel}>AF LOCK</Text>}
    </View>}
  </View>;
}
const zoomStyles = StyleSheet.create({
  container: { position: 'absolute', width: 160, backgroundColor: 'rgba(0,0,0,0.66)', borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  expanded: { width: 204, borderRadius: 18 },
  controls: { height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  labelButton: { minWidth: 76, height: 40, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.text, fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  nudge: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  dial: { height: 31, marginTop: 8, overflow: 'hidden' },
  ticks: { position: 'absolute', left: '50%', width: 410, flexDirection: 'row', alignItems: 'flex-end', height: 25 },
  tickCell: { width: 10, height: 25, alignItems: 'center', justifyContent: 'flex-end' },
  tick: { width: 1, height: 8, backgroundColor: '#777777' },
  tickMajor: { height: 17, backgroundColor: '#C7C7C7' },
  needle: { position: 'absolute', width: 2, height: 25, left: '50%', backgroundColor: '#FFFFFF', top: 0 },
  hint: { fontSize: 9, color: '#AEAEAE', textAlign: 'center', paddingBottom: 9 },
});
const frameStyles = StyleSheet.create({
  frame: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000000' },
  focus: { position: 'absolute', width: 48, height: 48, borderWidth: 1.5, borderColor: '#FFD456', borderRadius: 7 },
  focusLabel: { position: 'absolute', top: -19, color: '#FFD456', fontSize: 8, fontWeight: '700', width: 75 },
});
