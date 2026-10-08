import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { measure, runOnJS, runOnUI, scrollTo, useAnimatedProps, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { Film, Mic, Minus, Plus } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { formatStudioDuration, formatStudioEditorTime, type StudioTake } from './model';
import { canContinueStudioTrim, clampStudioTimelineScale, defaultStudioTimelineScale, freezeStudioTrim, maximumStudioTimelineScale, minimumStudioTimelineScale, studioTimelineLayout, studioTimelineSeconds, studioTimelineTicks, studioTrimRange, type StudioTimelineTrim, type StudioTrimGesture } from './timelineLayout';
import { studioLiveSegment, studioTimelineAutoScrollVelocity, studioTrimAutoscrollStep, studioTrimDragValues } from './timelineMotion';
import { useStudioFilmstrip } from './useStudioFilmstrip';

export type { StudioTimelineTrim } from './timelineLayout';
type Edge = 'start' | 'end';
type Trim = { frozen: StudioTrimGesture; edge: Edge; scale: number; range: StudioTimelineTrim };
// Only UI-thread values determine moving geometry. React supplies thumbnails,
// labels and durable edits; it never draws a second provisional clip.
type Motion = {
  scale: SharedValue<number>; offset: SharedValue<number>; viewport: SharedValue<number>;
  phase: SharedValue<number>; trimIndex: SharedValue<number>; start: SharedValue<number>; end: SharedValue<number>;
  originalStart: SharedValue<number>; originalEnd: SharedValue<number>; sourceDuration: SharedValue<number>;
  leading: SharedValue<number>; translation: SharedValue<number>; initialOffset: SharedValue<number>; finger: SharedValue<number>;
  edge: SharedValue<number>; virtual: SharedValue<number>; epoch: SharedValue<number>;
};
const rulerHeight = 26;
const tileWidth = 48;
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function StudioTimeline({ takes, position, activeTakeId, audio = false, onSeek, onSelect, compact = false, locked = false, busy = false, cancelEpoch = 0, onAppend, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, pixelsPerSecond = defaultStudioTimelineScale }: {
  takes: readonly StudioTake[]; position: number; activeTakeId?: string; audio?: boolean; compact?: boolean; showClips?: boolean;
  locked?: boolean; busy?: boolean; cancelEpoch?: number; pixelsPerSecond?: number; onAppend?: () => void; onScrubStart?: () => void;
  onSeek: (seconds: number) => void; onSelect: (take: StudioTake) => void;
  onTrimChange?: (range: StudioTimelineTrim) => void; onTrimCommit?: (range: StudioTimelineTrim) => void | Promise<void>; onTrimCancel?: () => void;
}) {
  const [scale, setScale] = useState(() => clampStudioTimelineScale(pixelsPerSecond));
  const [viewport, setViewport] = useState(1);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<StudioTimelineTrim | null>(null);
  const [dragging, setDragging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pinching, setPinching] = useState(false);
  const layout = useMemo(() => {
    try { return { ...studioTimelineLayout(takes, scale), error: false }; }
    catch { return { segments: [], duration: 0, width: 0, error: true }; }
  }, [takes, scale]);
  const selected = layout.segments.find(segment => segment.take.id === activeTakeId);
  const trackHeight = compact ? 54 : 64;
  const strip = useAnimatedRef<Animated.ScrollView>();
  const host = useAnimatedRef<Animated.View>();
  const mounted = useRef(true);
  const gesture = useRef<Trim | null>(null);
  const commitPending = useRef(false);
  const live = useRef({ takes, activeTakeId, locked, busy, onSeek, onSelect, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, scale, duration: layout.duration });
  live.current = { takes, activeTakeId, locked, busy, onSeek, onSelect, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, scale, duration: layout.duration };
  const m: Motion = {
    scale: useSharedValue(scale), offset: useSharedValue(0), viewport: useSharedValue(1), phase: useSharedValue(0),
    trimIndex: useSharedValue(-1), start: useSharedValue(0), end: useSharedValue(0), originalStart: useSharedValue(0), originalEnd: useSharedValue(0), sourceDuration: useSharedValue(0),
    leading: useSharedValue(0), translation: useSharedValue(0), initialOffset: useSharedValue(0), finger: useSharedValue(0),
    edge: useSharedValue(0), virtual: useSharedValue(0), epoch: useSharedValue(0),
  };
  const baseDuration = useSharedValue(layout.duration);
  const playerPosition = useSharedValue(position);
  const blocked = useSharedValue(!!busy);
  const lastVisible = useSharedValue(0);
  const lastSeek = useSharedValue(0);
  const lastPreview = useSharedValue(0);
  const pinchScale = useSharedValue(scale);
  const pinchAnchor = useSharedValue(0);
  const total = useDerivedValue(() => Math.max(0, baseDuration.value + (m.trimIndex.value < 0 ? 0 : m.end.value - m.start.value - (m.originalEnd.value - m.originalStart.value))));

  useEffect(() => { m.scale.value = clampStudioTimelineScale(pixelsPerSecond); setScale(clampStudioTimelineScale(pixelsPerSecond)); }, [pixelsPerSecond]);
  useEffect(() => { playerPosition.value = Number.isFinite(position) ? position : 0; }, [position]);
  useEffect(() => { blocked.value = !!busy; }, [busy]);
  useEffect(() => {
    baseDuration.value = layout.duration;
    // The saved geometry already contains this cut. Never apply its delta twice.
    if (!gesture.current) { m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; }
  }, [takes, layout.duration]);
  const cancelTrim = useCallback(() => {
    gesture.current = null;
    m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.phase.value = 0;
    if (mounted.current) { setDraft(null); setDragging(false); }
    live.current.onTrimCancel?.();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (gesture.current) { gesture.current = null; live.current.onTrimCancel?.(); } };
  }, []);
  useEffect(() => {
    const current = gesture.current;
    if (current && (locked || busy || !canContinueStudioTrim(current.frozen, takes, activeTakeId))) cancelTrim();
  }, [takes, activeTakeId, locked, busy, cancelTrim]);
  useEffect(() => { if (gesture.current) cancelTrim(); }, [cancelEpoch, cancelTrim]);

  const receiveOffset = useCallback((value: number) => { if (mounted.current) setOffset(value); }, []);
  const receiveScale = useCallback((value: number) => { if (mounted.current) setScale(value); }, []);
  const startScrub = useCallback(() => { if (!live.current.busy) live.current.onScrubStart?.(); }, []);
  const seekOffset = useCallback((value: number, nextScale: number) => {
    if (!live.current.busy && !commitPending.current && !gesture.current && m.phase.value !== 3 && m.phase.value !== 5) live.current.onSeek(studioTimelineSeconds(value, nextScale, live.current.duration));
  }, []);
  const finishScrub = useCallback((value: number, nextScale: number, epoch: number) => {
    if (live.current.busy || commitPending.current || gesture.current || m.phase.value !== 6 || m.epoch.value !== epoch) return;
    const seconds = studioTimelineSeconds(value, nextScale, live.current.duration);
    seekOffset(value, nextScale);
    // Release only after the final seek intent reached JS. The last native
    // scroll event must not snap back to an older player notification.
    runOnUI(() => {
      'worklet';
      if (m.phase.value !== 6 || m.epoch.value !== epoch) return;
      playerPosition.value = seconds; m.phase.value = 0;
    })();
  }, [seekOffset]);
  const beginTrim = useCallback((edge: Edge, accessible = false) => {
    const current = live.current;
    if (current.locked || current.busy || commitPending.current || !current.activeTakeId || !current.onTrimCommit) { cancelTrim(); return; }
    try {
      const frozen = freezeStudioTrim(current.takes, current.activeTakeId);
      const range = studioTrimRange(frozen, edge, 0);
      gesture.current = { frozen, edge, scale: current.scale, range };
      if (accessible) {
        m.trimIndex.value = frozen.preceding.length; m.originalStart.value = frozen.start; m.originalEnd.value = frozen.end; m.sourceDuration.value = frozen.duration;
        m.start.value = frozen.start; m.end.value = frozen.end; m.leading.value = 0; m.virtual.value = 0; m.epoch.value += 1; m.phase.value = 3;
      }
      current.onScrubStart?.(); setDragging(true); setDraft(range); current.onTrimChange?.(range);
    } catch { cancelTrim(); }
  }, [cancelTrim]);
  const previewTrim = useCallback((start: number, end: number) => {
    const drag = gesture.current;
    const current = live.current;
    if (!drag) return;
    if (current.locked || current.busy || !canContinueStudioTrim(drag.frozen, current.takes, current.activeTakeId)) { cancelTrim(); return; }
    const range = studioTrimRange(drag.frozen, drag.edge, (drag.edge === 'start' ? start - drag.frozen.start : end - drag.frozen.end));
    drag.range = range;
    setDraft(range); current.onTrimChange?.(range);
  }, [cancelTrim]);
  const commitTrim = useCallback(async (start: number, end: number) => {
    const current = live.current;
    const drag = gesture.current;
    if (!drag || current.locked || current.busy || !canContinueStudioTrim(drag.frozen, current.takes, current.activeTakeId) || !current.onTrimCommit) { cancelTrim(); return; }
    const range = studioTrimRange(drag.frozen, drag.edge, drag.edge === 'start' ? start - drag.frozen.start : end - drag.frozen.end);
    if (Math.abs(range.start - drag.frozen.start) < 0.0005 && Math.abs(range.end - drag.frozen.end) < 0.0005) { cancelTrim(); return; }
    gesture.current = null; commitPending.current = true; m.phase.value = 5;
    setDragging(false); setCommitting(true); setDraft(range); current.onTrimChange?.(range);
    try { await current.onTrimCommit(range); }
    catch { current.onTrimCancel?.(); }
    finally {
      commitPending.current = false; m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.phase.value = 0;
      if (mounted.current) { setDraft(null); setCommitting(false); }
    }
  }, [cancelTrim]);
  const accessibleTrim = (edge: Edge, delta: number) => {
    beginTrim(edge, true);
    const drag = gesture.current;
    if (!drag) return;
    const range = studioTrimRange(drag.frozen, edge, delta);
    m.start.value = range.start; m.end.value = range.end; m.leading.value = edge === 'start' ? range.start - drag.frozen.start : 0;
    previewTrim(range.start, range.end); void commitTrim(range.start, range.end);
  };

  useAnimatedReaction(() => ({ phase: m.phase.value, position: playerPosition.value, scale: m.scale.value, offset: m.offset.value, duration: total.value, viewport: m.viewport.value }), state => {
    if (state.phase !== 0 || state.viewport <= 1) return;
    const target = Math.max(0, Math.min(state.duration, state.position)) * state.scale;
    if (Math.abs(target - state.offset) > 0.75) scrollTo(strip, target, 0, false);
  });
  useAnimatedReaction(() => ({ phase: m.phase.value, start: m.start.value, end: m.end.value }), state => {
    if (state.phase !== 3) return;
    const now = Date.now();
    if (now - lastPreview.value >= 40) { lastPreview.value = now; runOnJS(previewTrim)(state.start, state.end); }
  });
  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => { if ((m.phase.value >= 3 && m.phase.value !== 6) || blocked.value) return; m.epoch.value += 1; m.phase.value = 1; runOnJS(startScrub)(); },
    onScroll: event => {
      m.offset.value = Math.max(0, event.contentOffset.x);
      const now = Date.now();
      if (now - lastVisible.value >= 64) { lastVisible.value = now; runOnJS(receiveOffset)(m.offset.value + m.virtual.value); }
      if ((m.phase.value === 1 || m.phase.value === 2) && now - lastSeek.value >= 40) { lastSeek.value = now; runOnJS(seekOffset)(m.offset.value, m.scale.value); }
    },
    onEndDrag: event => {
      if (m.phase.value !== 1) return;
      const target = event.targetContentOffset?.x;
      const stationary = Number.isFinite(target) && Math.abs(target! - event.contentOffset.x) <= 0.5;
      if (Math.abs(event.velocity?.x ?? 0) <= 0.05 || stationary) { m.phase.value = 6; runOnJS(finishScrub)(event.contentOffset.x, m.scale.value, m.epoch.value); }
      else runOnJS(seekOffset)(event.contentOffset.x, m.scale.value);
    },
    onMomentumBegin: () => { if (m.phase.value === 1) m.phase.value = 2; },
    onMomentumEnd: event => {
      if (m.phase.value !== 1 && m.phase.value !== 2) return;
      m.phase.value = 6; runOnJS(finishScrub)(event.contentOffset.x, m.scale.value, m.epoch.value);
    },
  });
  useFrameCallback(frame => {
    if (m.phase.value !== 3) return;
    const speed = studioTimelineAutoScrollVelocity(m.finger.value, m.viewport.value);
    if (speed === 0) return;
    const range = studioTrimAutoscrollStep(m.edge.value === 0 ? 'start' : 'end', m.originalStart.value, m.originalEnd.value, m.sourceDuration.value, m.translation.value, m.initialOffset.value, m.offset.value, m.virtual.value, m.scale.value, speed * Math.min(32, frame.timeSincePreviousFrame ?? 16) / 1000, total.value * m.scale.value + Math.max(0, m.leading.value * m.scale.value));
    m.offset.value = range.offset; m.virtual.value = range.virtualOffset;
    m.start.value = range.start; m.end.value = range.end; m.leading.value = range.leadingSeconds;
    scrollTo(strip, range.offset, 0, false);
    const now = Date.now();
    if (now - lastVisible.value >= 64) { lastVisible.value = now; runOnJS(receiveOffset)(range.offset + range.virtualOffset); }
  });
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const pinch = useMemo(() => Gesture.Pinch().enabled(!busy && !committing && !dragging).simultaneousWithExternalGesture(nativeGesture)
    .onStart(() => {
      if (m.phase.value === 3 || m.phase.value === 5 || blocked.value) return;
      pinchScale.value = m.scale.value; pinchAnchor.value = Math.max(0, Math.min(total.value, m.offset.value / m.scale.value));
      m.epoch.value += 1; m.phase.value = 4; runOnJS(setPinching)(true); runOnJS(startScrub)();
    }).onUpdate(event => {
      if (m.phase.value !== 4) return;
      m.scale.value = Math.max(minimumStudioTimelineScale, Math.min(maximumStudioTimelineScale, pinchScale.value * event.scale));
      const next = pinchAnchor.value * m.scale.value; m.offset.value = next; scrollTo(strip, next, 0, false);
      const now = Date.now(); if (now - lastVisible.value >= 64) { lastVisible.value = now; runOnJS(receiveScale)(m.scale.value); runOnJS(receiveOffset)(next); }
    }).onFinalize(() => {
      if (m.phase.value !== 4) return;
      playerPosition.value = pinchAnchor.value; m.phase.value = 0;
      runOnJS(receiveScale)(m.scale.value); runOnJS(setPinching)(false); runOnJS(seekOffset)(pinchAnchor.value * m.scale.value, m.scale.value);
    }), [busy, committing, dragging, nativeGesture]);
  const changeZoom = (factor: number) => {
    if (busy || dragging || committing || pinching) return;
    const next = clampStudioTimelineScale(scale * factor);
    m.scale.value = next; setScale(next);
  };
  const scrollProps = useAnimatedProps(() => ({ scrollEnabled: !blocked.value && m.phase.value < 3 }));
  const canvasStyle = useAnimatedStyle(() => ({ width: Math.max(m.viewport.value, m.viewport.value + total.value * m.scale.value + Math.max(0, m.leading.value * m.scale.value) + Math.max(0, -m.virtual.value) + (onAppend ? 68 : 0)), transform: [{ translateX: -m.virtual.value }] }));
  const appendStyle = useAnimatedStyle(() => ({ left: m.viewport.value / 2 + (total.value + m.leading.value) * m.scale.value + 12 }));
  const visibleStart = offset - viewport / 2 - 64;
  const visibleEnd = offset + viewport / 2 + 64;
  const previewDuration = layout.duration + (draft && selected ? draft.end - draft.start - (selected.take.end - selected.take.start) : 0);
  const ticks = studioTimelineTicks(scale, Math.max(0, visibleStart / scale), Math.max(0, visibleEnd / scale), previewDuration);
  const trimDisabled = !!(locked || busy || committing || pinching || !onTrimCommit || layout.error);

  if (!takes.length || layout.error) return <View style={[styles.empty, { height: rulerHeight + trackHeight + 26 }]}>
    {audio ? <Mic size={19} color={colors.mutedDim} strokeWidth={1.4} /> : <Film size={19} color={colors.mutedDim} strokeWidth={1.4} />}
    <Text style={styles.emptyText}>{layout.error ? 'Revise os limites dos takes' : 'Grave ou importe seu primeiro take'}</Text>
    {onAppend ? <AppendButton disabled={locked || busy} onPress={onAppend} /> : null}
  </View>;
  return <GestureDetector gesture={pinch}><Animated.View ref={host} onLayout={event => { const width = Math.max(1, event.nativeEvent.layout.width); m.viewport.value = width; setViewport(width); }} style={[styles.timeline, { height: rulerHeight + trackHeight + 50 }]}>
    <GestureDetector gesture={nativeGesture}><Animated.ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} bounces={false} scrollEventThrottle={16} decelerationRate="normal" animatedProps={scrollProps} onScroll={scrollHandler} keyboardShouldPersistTaps="handled">
      <Animated.View style={[{ height: rulerHeight + trackHeight + 6 }, canvasStyle]}>
        {ticks.map(tick => <TimelineTick key={tick.seconds} tick={tick} motion={m} />)}
        {layout.segments.map(segment => <TimelineClip key={segment.take.id} segment={segment} motion={m} selected={segment.take.id === activeTakeId} audio={audio} height={trackHeight} draft={draft} draftIndex={draft ? selected?.index ?? -1 : -1} draftOriginal={selected?.take} visibleStart={visibleStart} visibleEnd={visibleEnd} scale={scale}
          disabled={!!(busy || dragging || committing || pinching)} onSelect={() => { live.current.onSelect(segment.take); }} />)}
        {selected && !locked && onTrimCommit ? (['start', 'end'] as const).map(edge => <TrimHandle key={edge} edge={edge} take={selected.take} index={selected.index} startSeconds={selected.start} endSeconds={selected.end} motion={m} host={host} nativeGesture={nativeGesture} disabled={trimDisabled} height={trackHeight} onBegin={beginTrim} onCommit={commitTrim} onCancel={cancelTrim} onAccessibleChange={accessibleTrim} />) : null}
        {onAppend ? <Animated.View style={[{ position: 'absolute', top: rulerHeight + (trackHeight - 44) / 2 }, appendStyle]}><AppendButton disabled={locked || busy || committing || dragging || pinching} onPress={onAppend} /></Animated.View> : null}
      </Animated.View>
    </Animated.ScrollView></GestureDetector>
    <View pointerEvents="none" accessible accessibilityRole="adjustable" accessibilityLabel="Posição da montagem" accessibilityState={{ disabled: busy || dragging || committing || pinching }}
      accessibilityValue={{ min: 0, max: layout.duration, now: Math.max(0, Math.min(layout.duration, position)), text: formatStudioEditorTime(position) }}
      accessibilityActions={[{ name: 'increment', label: 'Avançar um segundo' }, { name: 'decrement', label: 'Voltar um segundo' }]}
      onAccessibilityAction={event => { if (!busy && !dragging && !committing && !pinching) { onScrubStart?.(); onSeek(Math.max(0, Math.min(layout.duration, position + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))); } }}
      style={{ position: 'absolute', width: 44, left: viewport / 2 - 22, top: 18, height: trackHeight + 14, zIndex: 4 }}>
      <View style={[styles.playhead, { left: 21, height: trackHeight + 14 }]}><View style={styles.playheadCap} /></View>
    </View>
    <View style={styles.caption}>
      <Text numberOfLines={1} style={styles.rangeLabel}>{selected ? `Take ${selected.index + 1} · ${formatStudioEditorTime(draft?.start ?? selected.take.start)} — ${formatStudioEditorTime(draft?.end ?? selected.take.end)}` : `${takes.length} ${takes.length === 1 ? 'take' : 'takes'}`}</Text>
      <Text style={styles.rangeDuration}>{committing ? 'Salvando…' : draft ? formatStudioEditorTime(draft.end - draft.start) : selected ? formatStudioEditorTime(selected.end - selected.start) : ''}</Text>
      <View style={styles.scaleControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Diminuir zoom da timeline" disabled={busy || dragging || committing || pinching || scale <= minimumStudioTimelineScale} onPress={() => changeZoom(1 / 1.5)} style={styles.scaleButton}><Minus size={15} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
        <Text accessible accessibilityRole="adjustable" accessibilityLabel="Zoom da timeline" accessibilityValue={{ min: minimumStudioTimelineScale, max: maximumStudioTimelineScale, now: scale, text: `${Math.round(scale / defaultStudioTimelineScale * 100)} por cento` }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => changeZoom(event.nativeEvent.actionName === 'increment' ? 1.5 : 1 / 1.5)} style={styles.scaleLabel}>{(scale / defaultStudioTimelineScale).toFixed(1).replace('.', ',')}×</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Aumentar zoom da timeline" disabled={busy || dragging || committing || pinching || scale >= maximumStudioTimelineScale} onPress={() => changeZoom(1.5)} style={styles.scaleButton}><Plus size={15} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
      </View>
    </View>
  </Animated.View></GestureDetector>;
}

function TimelineTick({ tick, motion: m }: { tick: { seconds: number; major: boolean }; motion: Motion }) {
  const style = useAnimatedStyle(() => ({ left: m.viewport.value / 2 + (tick.seconds + m.leading.value) * m.scale.value }));
  return <Animated.View pointerEvents="none" style={[styles.tick, { height: tick.major ? 8 : 4, top: tick.major ? 18 : 22 }, style]}>{tick.major ? <Text style={styles.tickLabel}>{formatStudioDuration(tick.seconds)}</Text> : null}</Animated.View>;
}
function TimelineClip({ segment, motion: m, selected, audio, height, draft, draftIndex, draftOriginal, visibleStart, visibleEnd, scale, disabled, onSelect }: {
  segment: ReturnType<typeof studioTimelineLayout>['segments'][number]; motion: Motion; selected: boolean; audio: boolean; height: number; draft: StudioTimelineTrim | null; draftIndex: number; draftOriginal?: StudioTake; visibleStart: number; visibleEnd: number; scale: number; disabled: boolean; onSelect: () => void;
}) {
  const style = useAnimatedStyle(() => {
    const current = studioLiveSegment(segment.start, segment.end, segment.index, m.trimIndex.value, m.originalStart.value, m.originalEnd.value, m.start.value, m.end.value, m.scale.value, m.leading.value);
    return { left: m.viewport.value / 2 + current.x, width: current.width };
  });
  const displayTake = draft?.takeId === segment.take.id ? { ...segment.take, start: draft.start, end: draft.end } : segment.take;
  const displayGeometry = studioLiveSegment(segment.start, segment.end, segment.index, draftIndex, draftOriginal?.start ?? 0, draftOriginal?.end ?? 0, draft?.start ?? 0, draft?.end ?? 0, scale, draft && draftOriginal ? draft.start - draftOriginal.start : 0);
  return <AnimatedPressable disabled={disabled} onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Selecionar take ${segment.index + 1}, ${formatStudioEditorTime(displayTake.end - displayTake.start)}`} accessibilityState={{ selected, disabled }}
    style={[styles.clip, { top: rulerHeight, height }, selected && styles.selected, style]}>
    <ClipFrames take={displayTake} audio={audio} canvasX={displayGeometry.x} visibleStart={visibleStart} visibleEnd={visibleEnd} scale={scale} />
    <View pointerEvents="none" style={styles.shade} />
    {segment.width > 28 ? <Text pointerEvents="none" style={styles.number}>{String(segment.index + 1).padStart(2, '0')}</Text> : null}
    {segment.width > 64 ? <Text pointerEvents="none" style={styles.duration}>{formatStudioDuration(displayTake.end - displayTake.start)}</Text> : null}
  </AnimatedPressable>;
}
function ClipFrames({ take, audio, canvasX, visibleStart, visibleEnd, scale }: { take: StudioTake; audio: boolean; canvasX: number; visibleStart: number; visibleEnd: number; scale: number }) {
  const width = (take.end - take.start) * scale;
  const first = Math.max(0, Math.floor((visibleStart - canvasX) / tileWidth));
  const last = Math.min(Math.ceil(width / tileWidth) - 1, Math.ceil((visibleEnd - canvasX) / tileWidth));
  const samples = useMemo(() => {
    const result: { key: string; seconds: number }[] = [];
    for (let index = first; index <= last; index++) result.push({ key: String(index), seconds: Math.min(take.end - 0.01, take.start + (index + 0.5) * tileWidth / scale) });
    return result;
  }, [first, last, take.start, take.end, scale]);
  const frames = useStudioFilmstrip(take, samples, !audio);
  if (audio) return <View pointerEvents="none" style={styles.audio}>{width >= 32 ? <Mic size={18} color={colors.muted} strokeWidth={1.4} /> : null}</View>;
  return <>{samples.map(sample => {
    const uri = frames[sample.key] || take.thumbnailUri;
    return uri ? <Image pointerEvents="none" key={sample.key} source={{ uri }} contentFit="cover" transition={0} cachePolicy="memory-disk" style={{ position: 'absolute', left: Number(sample.key) * tileWidth, top: 0, bottom: 0, width: tileWidth }} /> : null;
  })}</>;
}
function TrimHandle({ edge, take, index, startSeconds, endSeconds, motion: m, host, nativeGesture, disabled, height, onBegin, onCommit, onCancel, onAccessibleChange }: {
  edge: Edge; take: StudioTake; index: number; startSeconds: number; endSeconds: number; motion: Motion; host: ReturnType<typeof useAnimatedRef<Animated.View>>; nativeGesture: ReturnType<typeof Gesture.Native>; disabled: boolean; height: number;
  onBegin: (edge: Edge) => void; onCommit: (start: number, end: number) => void; onCancel: () => void; onAccessibleChange: (edge: Edge, delta: number) => void;
}) {
  const style = useAnimatedStyle(() => {
    const geometry = studioLiveSegment(startSeconds, endSeconds, index, m.trimIndex.value, m.originalStart.value, m.originalEnd.value, m.start.value, m.end.value, m.scale.value, m.leading.value);
    return { left: m.viewport.value / 2 + geometry.x + (edge === 'end' ? geometry.width - 4 : -40) };
  });
  const pan = useMemo(() => Gesture.Pan().enabled(!disabled).maxPointers(1).minDistance(1).shouldCancelWhenOutside(false).blocksExternalGesture(nativeGesture)
    .onStart(event => {
      m.trimIndex.value = index; m.edge.value = edge === 'start' ? 0 : 1; m.originalStart.value = take.start; m.originalEnd.value = take.end; m.sourceDuration.value = take.duration;
      m.start.value = take.start; m.end.value = take.end; m.leading.value = 0; m.virtual.value = 0; m.translation.value = 0; m.initialOffset.value = m.offset.value; m.epoch.value += 1;
      m.finger.value = event.absoluteX - (measure(host)?.pageX ?? 0); m.phase.value = 3;
      runOnJS(onBegin)(edge);
    }).onUpdate(event => {
      if (m.phase.value !== 3) return;
      m.translation.value = event.translationX;
      m.finger.value = event.absoluteX - (measure(host)?.pageX ?? 0);
      const range = studioTrimDragValues(edge, take.start, take.end, take.duration, event.translationX, m.offset.value - m.initialOffset.value + m.virtual.value, m.scale.value);
      m.start.value = range.start; m.end.value = range.end; m.leading.value = range.leadingSeconds;
    }).onEnd(() => {
      if (m.phase.value !== 3) return;
      m.phase.value = 5; runOnJS(onCommit)(m.start.value, m.end.value);
    }).onFinalize((_, success) => {
      if (!success && m.phase.value === 3) { m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.phase.value = 0; runOnJS(onCancel)(); }
    }), [disabled, take.id, take.uri, take.start, take.end, take.duration, index, edge, nativeGesture, onBegin, onCommit, onCancel]);
  return <GestureDetector gesture={pan}><Animated.View accessible accessibilityRole="adjustable" accessibilityLabel={edge === 'start' ? 'Início do take' : 'Fim do take'} accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: take.duration, now: take[edge], text: formatStudioEditorTime(take[edge]) }} accessibilityActions={[{ name: 'increment', label: 'Avançar um décimo de segundo' }, { name: 'decrement', label: 'Voltar um décimo de segundo' }]} onAccessibilityAction={event => { if (!disabled) onAccessibleChange(edge, event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1); }}
    style={[styles.handleTouch, { top: rulerHeight - 4, height: height + 8, alignItems: edge === 'start' ? 'flex-end' : 'flex-start' }, style]}><View style={[styles.handle, disabled && { opacity: 0.45 }]}><View style={styles.grip} /></View></Animated.View></GestureDetector>;
}
function AppendButton({ disabled, onPress }: { disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Adicionar take à montagem" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.append, disabled && { opacity: 0.4 }, pressed && { backgroundColor: colors.surfaceAlt }]}><Plus size={22} color={colors.text} strokeWidth={1.5} /></Pressable>;
}
const styles = StyleSheet.create({
  timeline: { width: '100%', overflow: 'hidden' },
  clip: { position: 'absolute', overflow: 'hidden', borderRadius: 4, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.background },
  selected: { borderWidth: 2, borderColor: colors.accent },
  audio: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceAlt },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  number: { position: 'absolute', left: 6, top: 4, color: colors.text, fontSize: 10, fontWeight: '600' },
  duration: { position: 'absolute', right: 5, bottom: 4, color: colors.text, fontSize: 10, fontVariant: ['tabular-nums'] },
  tick: { position: 'absolute', width: 1, backgroundColor: colors.mutedDim },
  tickLabel: { position: 'absolute', width: 64, left: -32, top: -17, textAlign: 'center', color: colors.mutedDim, fontSize: 9, fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', width: 2, backgroundColor: colors.text, zIndex: 4 },
  playheadCap: { position: 'absolute', width: 6, height: 6, borderRadius: 2, left: -2, top: -2, backgroundColor: colors.text },
  handleTouch: { position: 'absolute', width: 44, justifyContent: 'center', zIndex: 5 },
  handle: { width: 8, height: '100%', maxHeight: 72, borderRadius: 3, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2, height: 18, borderRadius: 1, backgroundColor: colors.text },
  append: { width: 44, height: 44, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 8 },
  rangeLabel: { flex: 1, color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  rangeDuration: { color: colors.textSecondary, fontSize: 10, fontVariant: ['tabular-nums'] },
  scaleControls: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  scaleButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scaleLabel: { width: 30, textAlign: 'center', color: colors.muted, fontSize: 10, fontVariant: ['tabular-nums'] },
  empty: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: colors.mutedDim, fontSize: 12, flexShrink: 1 },
});
