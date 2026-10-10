import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { colors } from '@/theme/colors';
const clamp = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/** A continuous wheel; geometry moves on UI while hardware targets are coalesced. */
export function StudioCaptureZoom({ value, onChange, label, disabled, style, controlName = 'zoom', confirmedValue, pending, confirmation }: {
  value: number; onChange: (value: number) => void; label: string; disabled?: boolean; style?: ViewStyle; controlName?: string;
  /** Hardware receipt; optional so exposure/intensity keep their controlled API. */
  confirmedValue?: number; pending?: boolean; confirmation?: number;
}) {
  const live = useRef({ onChange, disabled: !!disabled, mounted: true, epoch: 0 });
  if (live.current.disabled !== !!disabled) live.current.epoch++;
  live.current.onChange = onChange; live.current.disabled = !!disabled;
  const progress = useSharedValue(Number.isFinite(value) ? clamp(value) : 0);
  const base = useSharedValue(0), dragging = useSharedValue(false), lastSent = useSharedValue(0);
  const controls = useSharedValue({ disabled: !!disabled, epoch: live.current.epoch });
  const gestureEpoch = useSharedValue(0);
  const receipt = useSharedValue({ value: clamp(confirmedValue ?? value), confirmation: confirmation ?? 0, explicit: confirmedValue !== undefined || pending !== undefined || confirmation !== undefined });
  const awaiting = useSharedValue(!!pending), requestedConfirmation = useSharedValue(confirmation ?? 0);
  const receivedDuringDrag = useSharedValue(false);
  const deliver = useCallback((next: number, epoch: number) => {
    if (live.current.mounted && !live.current.disabled && live.current.epoch === epoch && Number.isFinite(next)) live.current.onChange(clamp(next));
  }, []);
  useEffect(() => {
    runOnUI((blocked: boolean, epoch: number) => {
      'worklet';
      controls.value = { disabled: blocked, epoch }; dragging.value = false;
      if (blocked) { awaiting.value = false; progress.value = receipt.value.value; }
    })(!!disabled, live.current.epoch);
  }, [disabled]);
  useEffect(() => {
    runOnUI((next: number, inFlight: boolean, version: number, explicit: boolean) => {
      'worklet';
      receipt.value = { value: Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : 0, confirmation: version, explicit };
      if (explicit) {
        if (inFlight) awaiting.value = true;
        else if (!awaiting.value || version !== requestedConfirmation.value) awaiting.value = false;
        if (!dragging.value && !awaiting.value) progress.value = receipt.value.value;
      } else if (dragging.value) receivedDuringDrag.value = true;
      else progress.value = receipt.value.value;
    })(confirmedValue ?? value, !!pending, confirmation ?? 0, confirmedValue !== undefined || pending !== undefined || confirmation !== undefined);
  }, [value, confirmedValue, pending, confirmation]);
  useEffect(() => { live.current.mounted = true; return () => { live.current.mounted = false; live.current.epoch++; }; }, []);
  const pan = useMemo(() => Gesture.Pan().maxPointers(1).activeOffsetX([-2, 2]).failOffsetY([-14, 14])
    .onStart(() => {
      'worklet';
      if (controls.value.disabled) return;
      gestureEpoch.value = controls.value.epoch; base.value = progress.value; dragging.value = true; lastSent.value = 0; receivedDuringDrag.value = false;
    })
    .onUpdate(event => {
      'worklet';
      if (!dragging.value || controls.value.disabled || gestureEpoch.value !== controls.value.epoch || !Number.isFinite(event.translationX)) return;
      progress.value = Math.max(0, Math.min(1, base.value + event.translationX / 360));
      const now = Date.now();
      if (now - lastSent.value >= 30) {
        lastSent.value = now;
        if (receipt.value.explicit) { awaiting.value = true; requestedConfirmation.value = receipt.value.confirmation; }
        runOnJS(deliver)(progress.value, gestureEpoch.value);
      }
    })
    .onEnd((event, success) => {
      'worklet';
      if (!success || !dragging.value || controls.value.disabled || gestureEpoch.value !== controls.value.epoch) return;
      if (Number.isFinite(event.translationX)) progress.value = Math.max(0, Math.min(1, base.value + event.translationX / 360));
      // JS may still be blocked when FINALIZE runs. Reserve this request on UI
      // first, so the dial cannot jump to the preceding hardware receipt.
      if (receipt.value.explicit) { awaiting.value = true; requestedConfirmation.value = receipt.value.confirmation; }
      runOnJS(deliver)(progress.value, gestureEpoch.value);
    })
    .onFinalize(() => {
      'worklet'; dragging.value = false;
      if (receipt.value.explicit ? !awaiting.value : receivedDuringDrag.value) progress.value = receipt.value.value;
    }), []);
  const ticks = useAnimatedStyle(() => ({ transform: [{ translateX: -progress.value * 360 }] }));
  const adjust = (direction: number) => {
    runOnUI((delta: number) => {
      'worklet';
      if (controls.value.disabled) return;
      progress.value = Math.max(0, Math.min(1, progress.value + delta * 0.025));
      if (receipt.value.explicit) { awaiting.value = true; requestedConfirmation.value = receipt.value.confirmation; }
      runOnJS(deliver)(progress.value, controls.value.epoch);
    })(direction);
  };
  return <GestureDetector gesture={pan}><Animated.View accessible accessibilityRole="adjustable" accessibilityLabel={`${controlName} da câmera`}
    accessibilityState={{ disabled: !!disabled }} accessibilityValue={{ min: 0, max: 100, now: Math.round(clamp(value) * 100), text: label }}
    accessibilityActions={[{ name: 'increment', label: `Aumentar ${controlName}` }, { name: 'decrement', label: `Diminuir ${controlName}` }]}
    onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'increment') adjust(1); else if (event.nativeEvent.actionName === 'decrement') adjust(-1); }}
    style={[zoomStyles.container, disabled && zoomStyles.disabled, style]}>
    <Text pointerEvents="none" style={zoomStyles.label}>{label}</Text>
    {!disabled && <View pointerEvents="none" style={zoomStyles.dial}>
      <Animated.View style={[zoomStyles.ticks, ticks]}>
        {Array.from({ length: 41 }, (_, index) => <View key={index} style={zoomStyles.tickCell}><View style={[zoomStyles.tick, index % 5 === 0 && zoomStyles.tickMajor]} /></View>)}
      </Animated.View><View style={zoomStyles.needle} />
    </View>}
  </Animated.View></GestureDetector>;
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
    onPanResponderGrant: event => { clearLongPress(); if (live.current.disabled) return; tap.current.pinched = true; pinch.current = { distance: distance(event), zoom: live.current.zoom }; },
    onPanResponderMove: event => {
      if (live.current.disabled) { pinch.current.distance = 0; return; }
      const next = distance(event);
      if (next > 0 && pinch.current.distance > 0) live.current.onZoom(clamp(pinch.current.zoom + Math.log(next / pinch.current.distance) * 0.22));
    },
    onPanResponderRelease: () => { pinch.current.distance = 0; },
    onPanResponderTerminate: () => { pinch.current.distance = 0; clearLongPress(); },
  }), []);
  useEffect(() => () => { clearLongPress(); if (hide.current) clearTimeout(hide.current); }, []);
  useEffect(() => {
    if (!disabled) return;
    clearLongPress(); pinch.current.distance = 0; tap.current.pinched = true;
    if (hide.current) clearTimeout(hide.current); hide.current = null; setFocusPoint(null);
  }, [disabled]);
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
  container: { position: 'absolute', width: 194, minHeight: 62, backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', overflow: 'hidden', paddingTop: 7, paddingBottom: 5 },
  disabled: { minHeight: 44, justifyContent: 'center', opacity: 0.45 },
  label: { color: colors.text, textAlign: 'center', fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  dial: { height: 25, marginTop: 4, overflow: 'hidden' },
  ticks: { position: 'absolute', left: '50%', marginLeft: -4.5, width: 369, flexDirection: 'row', alignItems: 'flex-end', height: 23 },
  tickCell: { width: 9, height: 23, alignItems: 'center', justifyContent: 'flex-end' },
  tick: { width: 1, height: 7, backgroundColor: 'rgba(255,255,255,0.46)' },
  tickMajor: { height: 15, backgroundColor: 'rgba(255,255,255,0.9)' },
  needle: { position: 'absolute', width: 2, height: 21, left: '50%', marginLeft: -1, backgroundColor: '#FFDB00', top: 1 },
});

const frameStyles = StyleSheet.create({
  frame: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000000' },
  focus: { position: 'absolute', width: 48, height: 48, borderWidth: 1.5, borderColor: '#FFD456', borderRadius: 7 },
  focusLabel: { position: 'absolute', top: -19, color: '#FFD456', fontSize: 8, fontWeight: '700', width: 75 },
});
