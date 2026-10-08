import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Film, Mic, Minus, Plus } from 'lucide-react-native';
import { LoadingImage } from '@/components/LoadingImage';
import { colors } from '@/theme/colors';
import { formatStudioDuration, formatStudioEditorTime, type StudioTake } from './model';
import { canContinueStudioTrim, clampStudioTimelineScale, defaultStudioTimelineScale, freezeStudioTrim, maximumStudioTimelineScale, minimumStudioTimelineScale, studioTimelineLayout, studioTimelinePinchScale, studioTimelineSeconds, studioTimelineTicks, studioTimelineZoomAnchor, studioTrimRange, studioTrimTimelinePosition, type StudioTimelineTrim, type StudioTrimGesture } from './timelineLayout';

export type { StudioTimelineTrim } from './timelineLayout';
type Edge = 'start' | 'end';
type Gesture = { frozen: StudioTrimGesture; edge: Edge; scale: number; range: StudioTimelineTrim };
type Pinch = { distance: number; scale: number; anchor: number };
type Touch = { pageX: number; pageY: number };
const rulerHeight = 26;
const tileWidth = 48;
function touchDistance(touches: readonly Touch[]) {
  return touches.length >= 2 ? Math.hypot(touches[1].pageX - touches[0].pageX, touches[1].pageY - touches[0].pageY) : 0;
}

export function StudioTimeline({ takes, position, activeTakeId, audio = false, onSeek, onSelect, compact = false, locked = false, busy = false, onAppend, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, pixelsPerSecond = defaultStudioTimelineScale }: {
  takes: readonly StudioTake[]; position: number; activeTakeId?: string; audio?: boolean; compact?: boolean; showClips?: boolean;
  locked?: boolean; busy?: boolean; pixelsPerSecond?: number; onAppend?: () => void; onScrubStart?: () => void;
  onSeek: (seconds: number) => void; onSelect: (take: StudioTake) => void;
  onTrimChange?: (range: StudioTimelineTrim) => void; onTrimCommit?: (range: StudioTimelineTrim) => void | Promise<void>; onTrimCancel?: () => void;
}) {
  const [scale, setScale] = useState(() => clampStudioTimelineScale(pixelsPerSecond));
  const layout = useMemo(() => {
    try { return { ...studioTimelineLayout(takes, scale), error: false }; }
    catch { return { segments: [], duration: 0, width: 0, error: true }; }
  }, [takes, scale]);
  const [viewport, setViewport] = useState(1);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<StudioTimelineTrim | null>(null);
  const [dragging, setDragging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pinching, setPinching] = useState(false);
  const strip = useRef<ScrollView>(null);
  const mounted = useRef(true);
  const scrollOffset = useRef(0);
  const scrollPhase = useRef<'idle' | 'drag' | 'momentum' | 'pinch'>('idle');
  const gesture = useRef<Gesture | null>(null);
  const draftOrigin = useRef<StudioTrimGesture | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const pendingZoom = useRef<{ seconds: number; scale: number } | null>(null);
  const zoomFrame = useRef<number | null>(null);
  const viewportLive = useRef(viewport); viewportLive.current = viewport;
  const commitPending = useRef(false);
  const lastSeek = useRef(0);
  const lastTrimPreview = useRef(0);
  const live = useRef({ takes, activeTakeId, locked, busy, onSeek, onSelect, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, scale, duration: layout.duration });
  live.current = { takes, activeTakeId, locked, busy, onSeek, onSelect, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, scale, duration: layout.duration };
  const selected = layout.segments.find(segment => segment.take.id === activeTakeId);
  const trackHeight = compact ? 54 : 64;
  const padding = viewport / 2;
  const canvasWidth = Math.max(viewport, viewport + layout.width + (onAppend ? 68 : 0));
  const visibleStart = offset - padding - 64;
  const visibleEnd = offset + viewport - padding + 64;
  const ticks = studioTimelineTicks(scale, Math.max(0, visibleStart / scale), Math.max(0, visibleEnd / scale), layout.duration);
  const trimDisabled = locked || busy || committing || pinching || !onTrimCommit || layout.error;

  const cancelTrim = useCallback(() => {
    gesture.current = null;
    draftOrigin.current = null;
    if (mounted.current) { setDraft(null); setDragging(false); }
    live.current.onTrimCancel?.();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
      if (gesture.current) { gesture.current = null; live.current.onTrimCancel?.(); }
    };
  }, []);
  useEffect(() => { setScale(clampStudioTimelineScale(pixelsPerSecond)); }, [pixelsPerSecond]);
  useEffect(() => {
    const current = gesture.current;
    if (current && (locked || busy || scale !== current.scale || !canContinueStudioTrim(current.frozen, takes, activeTakeId))) cancelTrim();
  }, [takes, activeTakeId, locked, busy, scale, cancelTrim]);
  useEffect(() => {
    if (gesture.current || committing || viewport <= 1 || (scrollPhase.current !== 'idle' && scrollPhase.current !== 'pinch')) return;
    const anchor = pendingZoom.current?.seconds ?? pinch.current?.anchor ?? position;
    const target = Math.max(0, Math.min(layout.duration, Number.isFinite(anchor) ? anchor : 0)) * scale;
    if (Math.abs(target - scrollOffset.current) > 0.75) strip.current?.scrollTo({ x: target, animated: false });
  }, [position, activeTakeId, scale, viewport, layout.duration, committing]);

  const seekOffset = (value: number, final = false) => {
    const now = Date.now();
    if (live.current.busy || commitPending.current || gesture.current || pinch.current || (!final && now - lastSeek.current < 32)) return;
    lastSeek.current = now;
    live.current.onSeek(studioTimelineSeconds(value, live.current.scale, live.current.duration));
  };
  const endScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (pinch.current || (scrollPhase.current !== 'drag' && scrollPhase.current !== 'momentum')) return;
    scrollPhase.current = 'idle';
    seekOffset(event.nativeEvent.contentOffset.x, true);
    const target = Math.max(0, Math.min(layout.width, event.nativeEvent.contentOffset.x));
    if (Math.abs(target - event.nativeEvent.contentOffset.x) > 0.75) strip.current?.scrollTo({ x: target, animated: true });
  };
  const beginTrim = (edge: Edge) => {
    const current = live.current;
    if (current.locked || current.busy || commitPending.current || pinch.current || !current.onTrimCommit || !current.activeTakeId) return;
    try {
      const frozen = freezeStudioTrim(current.takes, current.activeTakeId);
      const range = studioTrimRange(frozen, edge, 0);
      gesture.current = { frozen, edge, scale: current.scale, range };
      draftOrigin.current = frozen;
      scrollPhase.current = 'idle';
      current.onScrubStart?.();
      setDragging(true); setDraft(range);
      current.onTrimChange?.(range);
      lastTrimPreview.current = Date.now();
    } catch { cancelTrim(); }
  };
  const moveTrim = (dx: number) => {
    const current = live.current;
    const drag = gesture.current;
    if (!drag) return;
    if (current.locked || current.busy || !canContinueStudioTrim(drag.frozen, current.takes, current.activeTakeId)) { cancelTrim(); return; }
    const range = studioTrimRange(drag.frozen, drag.edge, dx / drag.scale);
    drag.range = range;
    setDraft(range);
    const now = Date.now();
    if (now - lastTrimPreview.current >= 32) { lastTrimPreview.current = now; current.onTrimChange?.(range); }
  };
  const commitTrim = async () => {
    const current = live.current;
    const drag = gesture.current;
    if (!drag) return;
    if (current.locked || current.busy || !canContinueStudioTrim(drag.frozen, current.takes, current.activeTakeId) || !current.onTrimCommit) { cancelTrim(); return; }
    if (Math.abs(drag.range.start - drag.frozen.start) < 0.0005 && Math.abs(drag.range.end - drag.frozen.end) < 0.0005) { cancelTrim(); return; }
    gesture.current = null; commitPending.current = true;
    setDragging(false); setCommitting(true);
    current.onTrimChange?.(drag.range);
    try { await current.onTrimCommit(drag.range); }
    catch { current.onTrimCancel?.(); }
    finally {
      commitPending.current = false;
      draftOrigin.current = null;
      if (mounted.current) { setDraft(null); setCommitting(false); }
    }
  };
  const accessibleTrim = (edge: Edge, delta: number) => {
    beginTrim(edge);
    const drag = gesture.current;
    if (!drag) return;
    moveTrim(delta * drag.scale);
    void commitTrim();
  };

  const syncZoomOffset = () => {
    const pending = pendingZoom.current;
    if (!pending || !mounted.current) return;
    const target = Math.max(0, Math.min(live.current.duration, pending.seconds)) * pending.scale;
    strip.current?.scrollTo({ x: target, animated: false });
    // At zero (or a clamped scale), the native offset may stay unchanged and
    // emit no scroll event. Release the anchor so later playback can advance.
    if (!pinch.current && Math.abs(scrollOffset.current - target) < 0.75) pendingZoom.current = null;
  };
  const zoomTo = (next: number, anchor: number) => {
    const current = live.current;
    if (current.busy || gesture.current || commitPending.current) return;
    const nextScale = clampStudioTimelineScale(next);
    pendingZoom.current = { seconds: Math.max(0, Math.min(current.duration, anchor)), scale: nextScale };
    current.scale = nextScale;
    setScale(nextScale);
    if (zoomFrame.current !== null) cancelAnimationFrame(zoomFrame.current);
    zoomFrame.current = requestAnimationFrame(() => { zoomFrame.current = null; syncZoomOffset(); });
  };
  const changeZoom = (factor: number) => {
    const current = live.current;
    if (current.busy || gesture.current || commitPending.current || pinch.current) return;
    const anchor = studioTimelineZoomAnchor(scrollOffset.current, current.scale, current.scale * factor, current.duration);
    scrollPhase.current = 'idle';
    current.onScrubStart?.(); current.onSeek(anchor.seconds);
    zoomTo(current.scale * factor, anchor.seconds);
  };
  const canPinch = (touches: readonly Touch[]) => touches.length >= 2 && !live.current.busy && !gesture.current && !commitPending.current && live.current.duration > 0;
  const beginPinch = (touches: readonly Touch[]) => {
    if (!canPinch(touches)) return;
    const distance = touchDistance(touches);
    if (distance <= 0) return;
    const current = live.current;
    const anchor = studioTimelineZoomAnchor(scrollOffset.current, current.scale, current.scale, current.duration).seconds;
    pinch.current = { distance, scale: current.scale, anchor };
    scrollPhase.current = 'pinch'; setPinching(true);
    current.onScrubStart?.(); current.onSeek(anchor);
    // Stop a native momentum scroll at the cursor before changing its scale.
    strip.current?.scrollTo({ x: anchor * current.scale, animated: false });
  };
  const finishPinch = () => {
    if (!pinch.current) return;
    const anchor = pinch.current.anchor;
    pinch.current = null; scrollPhase.current = 'idle';
    if (mounted.current) setPinching(false);
    syncZoomOffset();
    if (!live.current.busy) live.current.onSeek(Math.max(0, Math.min(live.current.duration, anchor)));
  };
  const pinchPan = useMemo(() => PanResponder.create({
    // One finger remains owned by the ScrollView or trim handle. Only a second
    // touch claims this responder, so ordinary clip selection stays native.
    onStartShouldSetPanResponder: event => canPinch(event.nativeEvent.touches),
    onStartShouldSetPanResponderCapture: event => canPinch(event.nativeEvent.touches),
    onMoveShouldSetPanResponder: event => canPinch(event.nativeEvent.touches),
    onMoveShouldSetPanResponderCapture: event => canPinch(event.nativeEvent.touches),
    onPanResponderGrant: event => beginPinch(event.nativeEvent.touches),
    onPanResponderMove: event => {
      const current = pinch.current;
      if (!current) return;
      if (event.nativeEvent.touches.length < 2) { finishPinch(); return; }
      zoomTo(studioTimelinePinchScale(current.scale, current.distance, touchDistance(event.nativeEvent.touches)), current.anchor);
    },
    onPanResponderRelease: finishPinch,
    onPanResponderTerminate: finishPinch,
    onPanResponderTerminationRequest: () => true,
  }), []);
  useEffect(() => { if (busy && pinch.current) finishPinch(); }, [busy]);

  if (!takes.length || layout.error) return <View style={[styles.empty, { height: rulerHeight + trackHeight + 26 }]}>
    {audio ? <Mic size={19} color={colors.mutedDim} strokeWidth={1.4} /> : <Film size={19} color={colors.mutedDim} strokeWidth={1.4} />}
    <Text style={styles.emptyText}>{layout.error ? 'Revise os limites dos takes' : 'Grave ou importe seu primeiro take'}</Text>
    {onAppend ? <AppendButton disabled={locked || busy} onPress={onAppend} /> : null}
  </View>;

  const trimRange = draft?.takeId === selected?.take.id ? draft : null;
  const selectedX = selected ? selected.x + ((trimRange?.start ?? selected.take.start) - selected.take.start) * scale : 0;
  const selectedWidth = selected ? ((trimRange?.end ?? selected.take.end) - (trimRange?.start ?? selected.take.start)) * scale : 0;
  const trimCursor = trimRange && draftOrigin.current ? studioTrimTimelinePosition(draftOrigin.current, trimRange) : null;
  const cursorLeft = trimCursor === null ? padding : padding + trimCursor * scale - offset;
  return <View {...pinchPan.panHandlers} onLayout={event => setViewport(Math.max(1, event.nativeEvent.layout.width))} style={[styles.timeline, { height: rulerHeight + trackHeight + 50 }]}>
    <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} bounces={false} scrollEventThrottle={16}
      decelerationRate="fast" scrollEnabled={!busy && !dragging && !committing && !pinching} keyboardShouldPersistTaps="handled"
      onContentSizeChange={contentWidth => {
        const expected = viewportLive.current + live.current.duration * live.current.scale + (onAppend ? 68 : 0);
        if (pendingZoom.current && Math.abs(contentWidth - expected) < 2) syncZoomOffset();
      }}
      onScrollBeginDrag={event => { if (pinch.current) return; scrollPhase.current = 'drag'; live.current.onScrubStart?.(); seekOffset(event.nativeEvent.contentOffset.x, true); }}
      onScroll={event => {
        const next = Math.max(0, event.nativeEvent.contentOffset.x);
        scrollOffset.current = next; setOffset(next);
        const zoom = pendingZoom.current;
        if (zoom && !pinch.current && Math.abs(next - zoom.seconds * zoom.scale) < 0.75) pendingZoom.current = null;
        if (scrollPhase.current === 'drag' || scrollPhase.current === 'momentum') seekOffset(next);
      }}
      onScrollEndDrag={event => {
        if (pinch.current) return;
        seekOffset(event.nativeEvent.contentOffset.x, true);
        if (Math.abs(event.nativeEvent.velocity?.x ?? 0) > 0.05) scrollPhase.current = 'momentum';
        else endScroll(event);
      }}
      onMomentumScrollBegin={() => { if (!pinch.current && scrollPhase.current === 'drag') scrollPhase.current = 'momentum'; }} onMomentumScrollEnd={endScroll}>
      <View style={{ width: canvasWidth, height: rulerHeight + trackHeight + 6 }}>
        {ticks.map(tick => <View pointerEvents="none" key={tick.seconds} style={[styles.tick, { left: padding + tick.seconds * scale, height: tick.major ? 8 : 4, top: tick.major ? 18 : 22 }]}>
          {tick.major ? <Text style={styles.tickLabel}>{formatStudioDuration(tick.seconds)}</Text> : null}
        </View>)}
        {layout.segments.map(segment => <Pressable key={segment.take.id} accessibilityRole="button" accessibilityLabel={`Selecionar take ${segment.index + 1}, ${formatStudioEditorTime(segment.end - segment.start)}`}
          accessibilityState={{ selected: segment.take.id === activeTakeId, disabled: busy || dragging || committing || pinching }} disabled={busy || dragging || committing || pinching}
          onPress={() => {
            scrollPhase.current = 'idle';
            live.current.onSelect(segment.take);
            // Accessibility may scroll the same clip into view without changing
            // the selected ID or player time. Keep its start under the cursor.
            strip.current?.scrollTo({ x: segment.start * live.current.scale, animated: false });
          }} style={[styles.clip, { left: padding + segment.x, top: rulerHeight, width: segment.width, height: trackHeight }, segment.take.id === activeTakeId && styles.selected, trimRange?.takeId === segment.take.id && { opacity: 0.32 }]}>
          <ClipFrames take={segment.take} audio={audio} width={segment.width} canvasX={segment.x} visibleStart={visibleStart} visibleEnd={visibleEnd} />
          <View pointerEvents="none" style={styles.shade} />
          {segment.width > 28 ? <Text pointerEvents="none" style={styles.number}>{String(segment.index + 1).padStart(2, '0')}</Text> : null}
          {segment.width > 64 ? <Text pointerEvents="none" style={styles.duration}>{formatStudioDuration(segment.end - segment.start)}</Text> : null}
        </Pressable>)}
        {selected && !locked ? <>
          {trimRange ? <View pointerEvents="none" style={[styles.trimPreview, { left: padding + selectedX, top: rulerHeight, width: selectedWidth, height: trackHeight }]}>
            <ClipFrames take={selected.take} audio={audio} width={selectedWidth} canvasX={selectedX} visibleStart={visibleStart} visibleEnd={visibleEnd} />
            <View style={styles.shade} />
          </View> : null}
          <View pointerEvents="none" style={[styles.selectionBorder, { left: padding + selectedX, top: rulerHeight, width: selectedWidth, height: trackHeight }]} />
          {onTrimCommit ? <>
            <TrimHandle edge="start" disabled={trimDisabled} value={trimRange?.start ?? selected.take.start} duration={selected.take.duration} left={padding + selectedX - 40} top={rulerHeight - 5} height={trackHeight + 10} onBegin={beginTrim} onMove={moveTrim} onEnd={() => { void commitTrim(); }} onCancel={cancelTrim} onAccessibleChange={accessibleTrim} />
            <TrimHandle edge="end" disabled={trimDisabled} value={trimRange?.end ?? selected.take.end} duration={selected.take.duration} left={padding + selectedX + selectedWidth - 4} top={rulerHeight - 5} height={trackHeight + 10} onBegin={beginTrim} onMove={moveTrim} onEnd={() => { void commitTrim(); }} onCancel={cancelTrim} onAccessibleChange={accessibleTrim} />
          </> : null}
        </> : null}
        {onAppend ? <View style={{ position: 'absolute', left: padding + layout.width + 12, top: rulerHeight + (trackHeight - 44) / 2 }}><AppendButton disabled={locked || busy || committing || dragging || pinching} onPress={onAppend} /></View> : null}
      </View>
    </ScrollView>
    <View pointerEvents="none" accessible accessibilityRole="adjustable" accessibilityLabel="Posição da montagem" accessibilityState={{ disabled: busy || dragging || committing || pinching }}
      accessibilityValue={{ min: 0, max: layout.duration, now: Math.max(0, Math.min(layout.duration, position)), text: formatStudioEditorTime(position) }}
      accessibilityActions={[{ name: 'increment', label: 'Avançar um segundo' }, { name: 'decrement', label: 'Voltar um segundo' }]}
      onAccessibilityAction={event => { if (!busy && !dragging && !committing && !pinching) { onScrubStart?.(); onSeek(Math.max(0, Math.min(layout.duration, position + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))); } }}
      style={{ position: 'absolute', width: 44, left: cursorLeft - 22, top: 18, height: trackHeight + 14, zIndex: 4 }}>
      <View style={[styles.playhead, { left: 21, top: 0, height: trackHeight + 14 }]}><View style={styles.playheadCap} /></View>
    </View>
    <View style={styles.caption}>
      <Text numberOfLines={1} style={styles.rangeLabel}>{selected ? `Take ${selected.index + 1} · ${formatStudioEditorTime(trimRange?.start ?? selected.take.start)} — ${formatStudioEditorTime(trimRange?.end ?? selected.take.end)}` : `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`}</Text>
      <Text style={styles.rangeDuration}>{committing ? 'Salvando…' : trimRange ? formatStudioEditorTime(trimRange.end - trimRange.start) : selected ? formatStudioEditorTime(selected.end - selected.start) : ''}</Text>
      <View style={styles.scaleControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Diminuir zoom da timeline" disabled={busy || dragging || committing || pinching || scale <= minimumStudioTimelineScale} onPress={() => changeZoom(1 / 1.5)} style={({ pressed }) => [styles.scaleButton, pressed && styles.scalePressed, (busy || dragging || committing || scale <= minimumStudioTimelineScale) && { opacity: 0.35 }]}><Minus size={15} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
        <Text accessible accessibilityRole="adjustable" accessibilityLabel="Zoom da timeline" accessibilityState={{ disabled: busy || dragging || committing || pinching }} accessibilityValue={{ min: minimumStudioTimelineScale, max: maximumStudioTimelineScale, now: scale, text: `${Math.round(scale / defaultStudioTimelineScale * 100)} por cento` }}
          accessibilityActions={[{ name: 'increment', label: 'Aproximar timeline' }, { name: 'decrement', label: 'Afastar timeline' }]} onAccessibilityAction={event => changeZoom(event.nativeEvent.actionName === 'increment' ? 1.5 : 1 / 1.5)} style={styles.scaleLabel}>{(scale / defaultStudioTimelineScale).toFixed(1).replace('.', ',')}×</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Aumentar zoom da timeline" disabled={busy || dragging || committing || pinching || scale >= maximumStudioTimelineScale} onPress={() => changeZoom(1.5)} style={({ pressed }) => [styles.scaleButton, pressed && styles.scalePressed, (busy || dragging || committing || scale >= maximumStudioTimelineScale) && { opacity: 0.35 }]}><Plus size={15} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
      </View>
    </View>
  </View>;
}

function ClipFrames({ take, audio, width, canvasX, visibleStart, visibleEnd }: { take: StudioTake; audio: boolean; width: number; canvasX: number; visibleStart: number; visibleEnd: number }) {
  if (audio || !take.thumbnailUri) return <View pointerEvents="none" style={styles.audio}>{width >= 32 ? audio ? <Mic size={18} color={colors.muted} strokeWidth={1.4} /> : <Film size={18} color={colors.mutedDim} strokeWidth={1.4} /> : null}</View>;
  const first = Math.max(0, Math.floor((visibleStart - canvasX) / tileWidth));
  const last = Math.min(Math.ceil(width / tileWidth) - 1, Math.ceil((visibleEnd - canvasX) / tileWidth));
  const frames = [];
  for (let index = first; index <= last; index++) frames.push(<LoadingImage key={index} source={{ uri: take.thumbnailUri }} contentFit="cover" style={{ position: 'absolute', left: index * tileWidth, top: 0, bottom: 0, width: tileWidth }} />);
  return <>{frames}</>;
}
function AppendButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Adicionar take à montagem" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.append, disabled && { opacity: 0.4 }, pressed && { backgroundColor: colors.surfaceAlt }]}><Plus size={22} color={colors.text} strokeWidth={1.5} /></Pressable>;
}
function TrimHandle({ edge, disabled, value, duration, left, top, height, onBegin, onMove, onEnd, onCancel, onAccessibleChange }: {
  edge: Edge; disabled: boolean; value: number; duration: number; left: number; top: number; height: number;
  onBegin: (edge: Edge) => void; onMove: (dx: number) => void; onEnd: () => void; onCancel: () => void; onAccessibleChange: (edge: Edge, delta: number) => void;
}) {
  const live = useRef({ disabled, edge, onBegin, onMove, onEnd, onCancel });
  live.current = { disabled, edge, onBegin, onMove, onEnd, onCancel };
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: event => !live.current.disabled && event.nativeEvent.touches.length === 1,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponder: (event, state) => !live.current.disabled && event.nativeEvent.touches.length === 1 && Math.abs(state.dx) > 1,
    onPanResponderGrant: () => live.current.onBegin(live.current.edge),
    onPanResponderMove: (event, state) => {
      // A second finger ends this cut before the parent can claim a pinch;
      // its averaged dx must never be applied to the original source range.
      if (event.nativeEvent.touches.length > 1) { live.current.onCancel(); return; }
      live.current.onMove(state.dx);
    },
    onPanResponderRelease: (_, state) => { live.current.onMove(state.dx); live.current.onEnd(); },
    onPanResponderTerminate: () => live.current.onCancel(),
    onPanResponderTerminationRequest: event => event.nativeEvent.touches.length >= 2,
  }), []);
  return <View {...pan.panHandlers} accessible accessibilityRole="adjustable" accessibilityLabel={edge === 'start' ? 'Início do take' : 'Fim do take'} accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: duration, now: value, text: formatStudioEditorTime(value) }}
    accessibilityActions={[{ name: 'increment', label: 'Avançar um décimo de segundo' }, { name: 'decrement', label: 'Voltar um décimo de segundo' }]}
    onAccessibilityAction={event => { if (!disabled) onAccessibleChange(edge, event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1); }}
    style={[styles.handleTouch, { left, top, height, alignItems: edge === 'start' ? 'flex-end' : 'flex-start' }]}><View style={[styles.handle, disabled && { opacity: 0.45 }]}><View style={styles.grip} /></View></View>;
}

const styles = StyleSheet.create({
  timeline: { width: '100%', overflow: 'hidden' },
  clip: { position: 'absolute', overflow: 'hidden', borderRadius: 4, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.background },
  selected: { borderColor: colors.accent },
  audio: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceAlt },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  number: { position: 'absolute', left: 6, top: 4, color: colors.text, fontSize: 10, fontWeight: '600' },
  duration: { position: 'absolute', right: 5, bottom: 4, color: colors.text, fontSize: 10, fontVariant: ['tabular-nums'] },
  tick: { position: 'absolute', width: 1, backgroundColor: colors.mutedDim },
  tickLabel: { position: 'absolute', width: 64, left: -32, top: -17, textAlign: 'center', color: colors.mutedDim, fontSize: 9, fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', width: 2, backgroundColor: colors.text, zIndex: 4 },
  playheadCap: { position: 'absolute', width: 6, height: 6, borderRadius: 2, left: -2, top: -2, backgroundColor: colors.text },
  selectionBorder: { position: 'absolute', borderWidth: 2, borderColor: colors.accent, borderRadius: 4 },
  trimPreview: { position: 'absolute', overflow: 'hidden', borderRadius: 4, backgroundColor: colors.surfaceAlt },
  handleTouch: { position: 'absolute', width: 44, justifyContent: 'center', zIndex: 5 },
  handle: { width: 8, height: '100%', maxHeight: 66, borderRadius: 3, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2, height: 16, borderRadius: 1, backgroundColor: colors.text },
  append: { width: 44, height: 44, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, height: 44, flexShrink: 0, paddingHorizontal: 8 },
  rangeLabel: { flex: 1, color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  rangeDuration: { color: colors.textSecondary, fontSize: 10, fontVariant: ['tabular-nums'] },
  scaleControls: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  scaleButton: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  scalePressed: { backgroundColor: colors.surface },
  scaleLabel: { width: 30, textAlign: 'center', color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  empty: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: colors.mutedDim, fontSize: 12, flexShrink: 1 },
});
