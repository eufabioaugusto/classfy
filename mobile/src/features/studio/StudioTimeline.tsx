import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { measure, runOnJS, runOnUI, scrollTo, useAnimatedProps, useAnimatedReaction, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useDerivedValue, useFrameCallback, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { ChevronDown, ChevronUp, Film, Mic, Minus, Plus } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { formatStudioDuration, formatStudioEditorTime, type StudioTake, type StudioRecipeClip, type StudioEditing } from './model';
import { canContinueStudioTrim, clampStudioTimelineScale, defaultStudioTimelineScale, freezeStudioTrim, maximumStudioTimelineScale, minimumStudioTimelineScale, studioTimelineLayout, studioTimelineSeconds, studioTimelineTicks, studioTrimRange, type StudioTimelineTrim, type StudioTrimGesture } from './timelineLayout';
import { studioLiveSegment, studioTimelineAutoScrollVelocity, studioTrimAutoscrollStep, studioTrimDragValues } from './timelineMotion';
import { useStudioFilmstrip } from './useStudioFilmstrip';
import { canContinueStudioLayerTimeline, freezeStudioLayerTimeline, studioLayerDragDestination, studioLayerDragRange,
  type StudioLayerTimelineMode, type StudioLayerTimelineRange, type StudioLayerTimelineSnapshot } from './layerTimelineInteraction';
import { snapStudioTimelineRange, studioTimelineSnapPoints, studioTimelineSnapTargets,
  type StudioTimelineSnapPoint, type StudioTimelineSnapMatch } from './timelineSnap';
import { advanceStudioTimelinePlayback, resetStudioTimelinePlayback, sampleStudioTimelinePlayback } from './timelinePlayback';
import type { StudioTimelinePlaybackChannel } from './timelinePlaybackChannel';

export type { StudioTimelineTrim } from './timelineLayout';
export type { StudioLayerTimelineRange } from './layerTimelineInteraction';
type Edge = 'start' | 'end';
type Trim = { frozen: StudioTrimGesture; edge: Edge; scale: number; range: StudioTimelineTrim; epoch: number };
// Only UI-thread values determine moving geometry. React supplies thumbnails,
// labels and durable edits; it never draws a second provisional clip.
type Motion = {
  scale: SharedValue<number>; offset: SharedValue<number>; viewport: SharedValue<number>;
  phase: SharedValue<number>; trimIndex: SharedValue<number>; start: SharedValue<number>; end: SharedValue<number>;
  originalStart: SharedValue<number>; originalEnd: SharedValue<number>; sourceDuration: SharedValue<number>;
  leading: SharedValue<number>; translation: SharedValue<number>; initialOffset: SharedValue<number>; finger: SharedValue<number>;
  edge: SharedValue<number>; virtual: SharedValue<number>; epoch: SharedValue<number>;
  laneStart: SharedValue<number>;
  snapPoints: SharedValue<readonly StudioTimelineSnapPoint[]>; snap: SharedValue<StudioTimelineSnapMatch | null>;
  mainSnapPoints: SharedValue<readonly StudioTimelineSnapPoint[]>;
  mainTimelineStart: SharedValue<number>; mainTimelineEnd: SharedValue<number>;
};
const rulerHeight = 26;
const tileWidth = 48;
const preparedWindowStep = tileWidth * 2;
const visibleLaneCount = 3;
const laneHeight = 44;
const handleInset = 28;
const snapColor = '#FFD54A';
const noLayers: readonly StudioRecipeClip[] = [];
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function StudioTimeline({ playbackChannel, layers: providedLayers = [], editing, selectedLayerId, onSelectLayer, onEditLayer, onMoveLayer, onLayerTrimPreview, onLayerTrimCommit, onLayerInteractionStart, onLayerInteractionEnd, takes, position, playing = false, loading = false, activeTakeId, audio = false, onSeek, onSelect, compact = false, previewOnly = false, locked = false, busy = false, cancelEpoch = 0, onAppend, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, pixelsPerSecond = defaultStudioTimelineScale }: {
  playbackChannel?: SharedValue<StudioTimelinePlaybackChannel>;
  layers?: readonly StudioRecipeClip[]; selectedLayerId?: string; onSelectLayer?: (id: string) => void; onMoveLayer?: (id: string, delta: number, targetZIndex?: number) => Promise<void>;
  onEditLayer?: (id: string) => void;
  editing?: StudioEditing; onLayerTrimPreview?: (id: string, range: StudioLayerTimelineRange | undefined) => void;
  onLayerTrimCommit?: (id: string, range: StudioLayerTimelineRange) => void | Promise<void>;
  onLayerInteractionStart?: () => void; onLayerInteractionEnd?: () => void;
  takes: readonly StudioTake[]; position: number; playing?: boolean; loading?: boolean; activeTakeId?: string; audio?: boolean; compact?: boolean; previewOnly?: boolean; showClips?: boolean;
  locked?: boolean; busy?: boolean; cancelEpoch?: number; pixelsPerSecond?: number; onAppend?: () => void; onScrubStart?: () => void;
  onSeek: (seconds: number) => void; onSelect: (take: StudioTake) => void;
  onTrimChange?: (range: StudioTimelineTrim) => void; onTrimCommit?: (range: StudioTimelineTrim) => void | Promise<void>; onTrimCancel?: () => void;
}) {
  const layers = previewOnly ? noLayers : providedLayers;
  const [scale, setScale] = useState(() => clampStudioTimelineScale(pixelsPerSecond));
  const [viewport, setViewport] = useState(1);
  const [offset, setOffset] = useState(0);
  const [draft, setDraft] = useState<StudioTimelineTrim | null>(null);
  const [dragging, setDragging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [pinching, setPinching] = useState(false);
  const [firstLane, setFirstLane] = useState(0);
  const [lifecycleEpoch, setLifecycleEpoch] = useState(0);
  const layout = useMemo(() => {
    try { const main = studioTimelineLayout(takes, scale); return { ...main, mainDuration: main.duration, duration: Math.max(main.duration, ...layers.map(item => (item.startTicks + item.durationTicks) / 120000)), error: false }; }
    catch { return { segments: [], mainDuration: 0, duration: 0, width: 0, error: true }; }
  }, [takes, scale, layers]);
  const selected = layout.segments.find(segment => segment.take.id === activeTakeId);
  const trackHeight = previewOnly || compact ? 60 : 72;
  const groupedSelection = !previewOnly && editing?.layers.find(layer => layer.items.length > 1 && layer.items.some(item => item.id === selectedLayerId));
  const newLane = groupedSelection && editing ? editing.layers.length + 1 : undefined;
  const laneIndices = useMemo(() => Array.from(new Set([...layers.map(item => item.zIndex), ...(newLane === undefined ? [] : [newLane])])).sort((a, b) => a - b), [layers, newLane]);
  const selectedLane = layers.find(item => item.id === selectedLayerId)?.zIndex;
  const selectedLaneIndex = selectedLane === undefined ? -1 : laneIndices.indexOf(selectedLane);
  const lastLaneStart = Math.max(0, laneIndices.length - visibleLaneCount);
  const laneStart = Math.max(0, Math.min(lastLaneStart, firstLane));
  const visibleLanes = laneIndices.slice(laneStart, laneStart + visibleLaneCount);
  useEffect(() => {
    setFirstLane(previous => {
      const start = Math.max(0, Math.min(lastLaneStart, previous));
      // Reveal an externally selected lane without shifting rows that are
      // already visible. Deselecting keeps the user's current window.
      if (selectedLaneIndex < 0) return start;
      if (selectedLaneIndex < start) return selectedLaneIndex;
      if (selectedLaneIndex >= start + visibleLaneCount) return selectedLaneIndex - visibleLaneCount + 1;
      return start;
    });
  }, [selectedLayerId, selectedLaneIndex, lastLaneStart]);
  const layerHeight = visibleLanes.length * laneHeight;
  const mainTop = previewOnly ? 0 : rulerHeight + layerHeight + (layerHeight ? 8 : 0);
  // A held layer must retain its native view/recognizer while vertical paging
  // reveals a destination outside its original window.
  const preparedMargin = Math.max(tileWidth * 4, viewport / 2);
  const visibleStart = offset - viewport / 2 - preparedMargin;
  const visibleEnd = offset + viewport / 2 + preparedMargin;
  const visibleLayers = layers.filter(item => item.id === selectedLayerId || visibleLanes.includes(item.zIndex) && item.startTicks / 120000 <= visibleEnd / scale && (item.startTicks + item.durationTicks) / 120000 >= visibleStart / scale);
  const strip = useAnimatedRef<Animated.ScrollView>();
  const host = useAnimatedRef<Animated.View>();
  const mounted = useRef(true);
  const gesture = useRef<Trim | null>(null);
  const commitPending = useRef(false);
  const live = useRef({ takes, activeTakeId, locked, busy, onSeek, onSelect, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, scale, duration: layout.duration });
  live.current = { takes, activeTakeId, locked, busy, onSeek, onSelect, onScrubStart, onTrimChange, onTrimCommit, onTrimCancel, scale, duration: layout.duration };
  // Shared-value handles and their container keep one identity for the entire
  // mounted timeline. React sample/thumbnail renders must not restart UI mappers.
  const m = useRef<Motion>({
    scale: useSharedValue(scale), offset: useSharedValue(0), viewport: useSharedValue(1), phase: useSharedValue(0),
    trimIndex: useSharedValue(-1), start: useSharedValue(0), end: useSharedValue(0), originalStart: useSharedValue(0), originalEnd: useSharedValue(0), sourceDuration: useSharedValue(0),
    leading: useSharedValue(0), translation: useSharedValue(0), initialOffset: useSharedValue(0), finger: useSharedValue(0),
    edge: useSharedValue(0), virtual: useSharedValue(0), epoch: useSharedValue(0),
    laneStart: useSharedValue(laneStart),
    snapPoints: useSharedValue<readonly StudioTimelineSnapPoint[]>([]), snap: useSharedValue<StudioTimelineSnapMatch | null>(null),
    mainSnapPoints: useSharedValue<readonly StudioTimelineSnapPoint[]>([]),
    mainTimelineStart: useSharedValue(0), mainTimelineEnd: useSharedValue(0),
  }).current;
  const snapPoints = useMemo(() => studioTimelineSnapPoints(layout.segments.map(segment => ({ id: segment.take.id, start: segment.start, end: segment.end })), layers, position), [layout.segments, layers, position]);
  useEffect(() => { m.snapPoints.value = snapPoints; }, [snapPoints]);
  useEffect(() => { if (![5, 7, 8].includes(m.phase.value)) m.laneStart.value = laneStart; }, [laneStart]);
  const receiveLaneWindow = useCallback((start: number, epoch: number) => {
    if (mounted.current && m.epoch.value === epoch && [0, 5, 7].includes(m.phase.value)) setFirstLane(start);
  }, []);
  const baseDuration = useSharedValue(layout.mainDuration);
  const layerDuration = useSharedValue(Math.max(0, ...layers.map(item => (item.startTicks + item.durationTicks) / 120000)));
  useEffect(() => { layerDuration.value = Math.max(0, ...layers.map(item => (item.startTicks + item.durationTicks) / 120000)); }, [layers]);
  const playerPosition = useSharedValue(position);
  const playbackClock = useSharedValue(resetStudioTimelinePlayback(position, layout.duration));
  const seekTarget = useSharedValue<number | null>(null);
  const foreground = useSharedValue(AppState.currentState === undefined || AppState.currentState === 'active');
  const blocked = useSharedValue(!!busy);
  const lastVisible = useSharedValue(0);
  const publishedOffset = useSharedValue(0);
  const lastSeek = useSharedValue(0);
  const lastPreview = useSharedValue(0);
  const pinchScale = useSharedValue(scale);
  const pinchAnchor = useSharedValue(0);
  const total = useDerivedValue(() => Math.max(layerDuration.value, baseDuration.value + (m.trimIndex.value < 0 ? 0 : m.end.value - m.start.value - (m.originalEnd.value - m.originalStart.value))));

  useEffect(() => { m.scale.value = clampStudioTimelineScale(pixelsPerSecond); setScale(clampStudioTimelineScale(pixelsPerSecond)); }, [pixelsPerSecond]);
  const applyPlaybackSample = useCallback((samplePosition: number, samplePlaying: boolean, sampleLoading: boolean, sampleDuration: number, sampleBusy: boolean) => {
    'worklet';
    if (sampleBusy || !foreground.value || m.phase.value !== 0 && m.phase.value !== 6) seekTarget.value = null;
    else if (seekTarget.value !== null) {
      // The scroll gesture finishes before AVPlayer acknowledges its seek.
      // A queued pre-seek sample must not pull the released cursor backward.
      if (Math.abs(samplePosition - seekTarget.value) > 0.05) return;
      seekTarget.value = null;
    }
    const next = sampleStudioTimelinePlayback(playbackClock.value, samplePosition, sampleDuration,
      samplePlaying && !sampleLoading && !sampleBusy && foreground.value && m.phase.value === 0);
    playbackClock.value = next; playerPosition.value = next.position;
  }, [m, foreground, seekTarget, playbackClock, playerPosition]);
  useAnimatedReaction(() => playbackChannel?.value ?? null, sample => {
    if (!sample) return;
    if (sample.active) applyPlaybackSample(sample.position, sample.playing, sample.loading, total.value, blocked.value);
    else playbackClock.value = { ...playbackClock.value, running: false, stalled: false, correction: 0 };
  });
  useEffect(() => {
    // The native event reaches UI before React. Its delayed JS copy may update
    // labels and selection, but must never overwrite the newer display sample.
    const sampleDuration = layout.duration;
    runOnUI(() => {
      'worklet';
      if (playbackChannel?.value.active) return;
      applyPlaybackSample(position, playing, loading, sampleDuration, busy);
    })();
  }, [position, playing, loading, busy, layout.duration, playbackChannel, applyPlaybackSample]);
  useEffect(() => { blocked.value = !!busy; }, [busy]);
  useEffect(() => {
    baseDuration.value = layout.mainDuration;
    // The saved geometry already contains this cut. Never apply its delta twice.
    if (!gesture.current) { m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; }
  }, [takes, layout.mainDuration]);
  const cancelTrim = useCallback((expected?: number) => {
    if (expected !== undefined && (m.epoch.value !== expected || gesture.current && gesture.current.epoch !== expected)) return;
    gesture.current = null;
    m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.snap.value = null; m.phase.value = 0;
    if (mounted.current) { setDraft(null); setDragging(false); }
    live.current.onTrimCancel?.();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (gesture.current) { gesture.current = null; live.current.onTrimCancel?.(); } };
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.value = state === 'active';
      if (state === 'active') return;
      runOnUI(() => { 'worklet'; seekTarget.value = null; playbackClock.value = { ...playbackClock.value, running: false, stalled: false, correction: 0 }; })();
      m.epoch.value += 1; m.snap.value = null; m.phase.value = 0;
      setPinching(false);
      if (gesture.current) cancelTrim();
      setLifecycleEpoch(value => value + 1);
    });
    return () => subscription.remove();
  }, [cancelTrim]);
  useEffect(() => {
    const current = gesture.current;
    if (current && (locked || busy || !canContinueStudioTrim(current.frozen, takes, activeTakeId))) cancelTrim();
  }, [takes, activeTakeId, locked, busy, cancelTrim]);
  useEffect(() => { if (gesture.current) cancelTrim(); }, [cancelEpoch, lifecycleEpoch, cancelTrim]);

  // Keep the prepared cells alive across several display frames. This is a
  // bounded tile window, not a request to decode an entire lesson. Updating
  // every fractional pixel would cancel/rebuild its thumbnail subscriptions.
  const receiveOffset = useCallback((value: number) => {
    if (mounted.current) setOffset(Math.floor(value / preparedWindowStep) * preparedWindowStep);
  }, []);
  const receiveScale = useCallback((value: number) => { if (mounted.current) setScale(value); }, []);
  const startScrub = useCallback((expected: number) => {
    if (mounted.current && m.epoch.value === expected && [1, 2, 4, 6].includes(m.phase.value) && !live.current.busy) live.current.onScrubStart?.();
  }, []);
  const receivePinching = useCallback((value: boolean, expected: number) => {
    if (mounted.current && m.epoch.value === expected && (!value || m.phase.value === 4)) setPinching(value);
  }, []);
  const seekOffset = useCallback((value: number, nextScale: number, epoch: number) => {
    // A queued scrub can arrive after a layer gesture starts or even ends.
    // Bind every seek to the originating operation, including pinch release.
    if (mounted.current && m.epoch.value === epoch && [0, 1, 2, 6].includes(m.phase.value)
      && !live.current.busy && !commitPending.current && !gesture.current) live.current.onSeek(studioTimelineSeconds(value, nextScale, live.current.duration));
  }, []);
  const finishScrub = useCallback((value: number, nextScale: number, epoch: number) => {
    if (live.current.busy || commitPending.current || gesture.current || m.phase.value !== 6 || m.epoch.value !== epoch) return;
    const seconds = studioTimelineSeconds(value, nextScale, live.current.duration);
    seekOffset(value, nextScale, epoch);
    // Release only after the final seek intent reached JS. The last native
    // scroll event must not snap back to an older player notification.
    runOnUI(() => {
      'worklet';
      if (m.phase.value !== 6 || m.epoch.value !== epoch) return;
      playbackClock.value = resetStudioTimelinePlayback(seconds, total.value);
      playerPosition.value = seconds; m.phase.value = 0;
    })();
  }, [seekOffset]);
  const beginTrim = useCallback((edge: Edge, accessible = false, expected?: number) => {
    const current = live.current;
    if (!mounted.current || expected !== undefined && (m.epoch.value !== expected || ![3, 5].includes(m.phase.value))) return;
    if (accessible && m.phase.value >= 3 && m.phase.value !== 6) return;
    if (current.locked || current.busy || commitPending.current || !current.activeTakeId || !current.onTrimCommit) { cancelTrim(); return; }
    try {
      const frozen = freezeStudioTrim(current.takes, current.activeTakeId);
      const range = studioTrimRange(frozen, edge, 0);
      if (accessible) {
        m.trimIndex.value = frozen.preceding.length; m.originalStart.value = frozen.start; m.originalEnd.value = frozen.end; m.sourceDuration.value = frozen.duration;
        m.start.value = frozen.start; m.end.value = frozen.end; m.leading.value = 0; m.virtual.value = 0; m.epoch.value += 1; m.phase.value = 3;
      }
      gesture.current = { frozen, edge, scale: current.scale, range, epoch: m.epoch.value };
      current.onScrubStart?.(); setDragging(true); setDraft(range); current.onTrimChange?.(range);
    } catch { cancelTrim(); }
  }, [cancelTrim]);
  const previewTrim = useCallback((start: number, end: number, expected: number) => {
    const drag = gesture.current;
    const current = live.current;
    if (!drag || drag.epoch !== expected || m.epoch.value !== expected) return;
    if (current.locked || current.busy || !canContinueStudioTrim(drag.frozen, current.takes, current.activeTakeId)) { cancelTrim(); return; }
    const range = studioTrimRange(drag.frozen, drag.edge, (drag.edge === 'start' ? start - drag.frozen.start : end - drag.frozen.end));
    drag.range = range;
    setDraft(range); current.onTrimChange?.(range);
  }, [cancelTrim]);
  const commitTrim = useCallback(async (start: number, end: number, expected: number) => {
    const current = live.current;
    const drag = gesture.current;
    if (!drag || drag.epoch !== expected || m.epoch.value !== expected) return;
    if (current.locked || current.busy || !canContinueStudioTrim(drag.frozen, current.takes, current.activeTakeId) || !current.onTrimCommit) { cancelTrim(expected); return; }
    const range = studioTrimRange(drag.frozen, drag.edge, drag.edge === 'start' ? start - drag.frozen.start : end - drag.frozen.end);
    if (Math.abs(range.start - drag.frozen.start) < 0.0005 && Math.abs(range.end - drag.frozen.end) < 0.0005) { cancelTrim(); return; }
    gesture.current = null; commitPending.current = true; m.phase.value = 5;
    setDragging(false); setCommitting(true); setDraft(range); current.onTrimChange?.(range);
    try { await current.onTrimCommit(range); }
    catch { current.onTrimCancel?.(); }
    finally {
      commitPending.current = false; m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.snap.value = null; m.phase.value = 0;
      if (mounted.current) { setDraft(null); setCommitting(false); }
    }
  }, [cancelTrim]);
  const accessibleTrim = (edge: Edge, delta: number) => {
    beginTrim(edge, true);
    const drag = gesture.current;
    if (!drag) return;
    const range = studioTrimRange(drag.frozen, edge, delta);
    m.start.value = range.start; m.end.value = range.end; m.leading.value = edge === 'start' ? range.start - drag.frozen.start : 0;
    previewTrim(range.start, range.end, drag.epoch); void commitTrim(range.start, range.end, drag.epoch);
  };

  useAnimatedReaction(() => ({ phase: m.phase.value, position: playerPosition.value, scale: m.scale.value, duration: total.value, viewport: m.viewport.value, blocked: blocked.value, foreground: foreground.value, playing: playbackClock.value.running }), state => {
    if (state.phase !== 0 || state.viewport <= 1 || state.blocked || !state.foreground) return;
    const target = Math.max(0, Math.min(state.duration, state.position)) * state.scale;
    // Fractional offsets matter at low zoom: a 0.75 px deadband would discard
    // several display frames and recreate the same visible stepping.
    if (Math.abs(target - m.offset.value) > 0.01) scrollTo(strip, target, 0, false);
    // Programmatic scroll feedback can be absent or delayed on iOS. The UI
    // clock owns both the displayed offset and the upcoming thumbnail window;
    // a late native scroll notification must not put either one behind it.
    m.offset.value = target;
    const now = Date.now();
    if (now - lastVisible.value >= 64 || Math.abs(target - publishedOffset.value) >= Math.max(preparedWindowStep, state.viewport / 2)) {
      lastVisible.value = now; publishedOffset.value = target;
      runOnJS(receiveOffset)(target);
    }
  });
  useAnimatedReaction(() => ({ phase: m.phase.value, start: m.start.value, end: m.end.value }), state => {
    if (state.phase !== 3) return;
    const now = Date.now();
    if (now - lastPreview.value >= 40) { lastPreview.value = now; runOnJS(previewTrim)(state.start, state.end, m.epoch.value); }
  });
  const scrollHandler = useAnimatedScrollHandler({
    onBeginDrag: () => { if ((m.phase.value >= 3 && m.phase.value !== 6) || blocked.value) return; seekTarget.value = null; m.epoch.value += 1; m.phase.value = 1; runOnJS(startScrub)(m.epoch.value); },
    onScroll: event => {
      if (m.phase.value === 0) return;
      m.offset.value = Math.max(0, event.contentOffset.x);
      const now = Date.now();
      if (now - lastVisible.value >= 64) { lastVisible.value = now; runOnJS(receiveOffset)(m.offset.value + m.virtual.value); }
      if ((m.phase.value === 1 || m.phase.value === 2) && now - lastSeek.value >= 40) { lastSeek.value = now; runOnJS(seekOffset)(m.offset.value, m.scale.value, m.epoch.value); }
    },
    onEndDrag: event => {
      if (m.phase.value !== 1) return;
      const target = event.targetContentOffset?.x;
      const stationary = Number.isFinite(target) && Math.abs(target! - event.contentOffset.x) <= 0.5;
      if (Math.abs(event.velocity?.x ?? 0) <= 0.05 || stationary) {
        // Arm before JS dispatch: the player can acknowledge the seek before
        // the release worklet runs, and that acknowledgement must count.
        seekTarget.value = Math.max(0, Math.min(total.value, event.contentOffset.x / m.scale.value));
        m.phase.value = 6; runOnJS(finishScrub)(event.contentOffset.x, m.scale.value, m.epoch.value);
      }
      else runOnJS(seekOffset)(event.contentOffset.x, m.scale.value, m.epoch.value);
    },
    onMomentumBegin: () => { if (m.phase.value === 1) m.phase.value = 2; },
    onMomentumEnd: event => {
      if (m.phase.value !== 1 && m.phase.value !== 2) return;
      seekTarget.value = Math.max(0, Math.min(total.value, event.contentOffset.x / m.scale.value));
      m.phase.value = 6; runOnJS(finishScrub)(event.contentOffset.x, m.scale.value, m.epoch.value);
    },
  });
  useFrameCallback(useCallback(frame => {
    'worklet';
    if (m.phase.value === 0 && !blocked.value && foreground.value) {
      const next = advanceStudioTimelinePlayback(playbackClock.value, frame.timeSincePreviousFrame, total.value, frame.timestamp);
      if (next !== playbackClock.value) { playbackClock.value = next; playerPosition.value = next.position; }
    } else if (playbackClock.value.running || playbackClock.value.stalled) {
      playbackClock.value = { ...playbackClock.value, running: false, stalled: false, correction: 0 };
    }
    if (m.phase.value !== 3) return;
    const speed = studioTimelineAutoScrollVelocity(m.finger.value, m.viewport.value);
    if (speed === 0) return;
    const range = studioTrimAutoscrollStep(m.edge.value === 0 ? 'start' : 'end', m.originalStart.value, m.originalEnd.value, m.sourceDuration.value, m.translation.value, m.initialOffset.value, m.offset.value, m.virtual.value, m.scale.value, speed * Math.min(32, frame.timeSincePreviousFrame ?? 16) / 1000, total.value * m.scale.value + Math.max(0, m.leading.value * m.scale.value));
    m.offset.value = range.offset; m.virtual.value = range.virtualOffset;
    applyMainSnap(m, range);
    scrollTo(strip, range.offset, 0, false);
    const now = Date.now();
    if (now - lastVisible.value >= 64) { lastVisible.value = now; runOnJS(receiveOffset)(range.offset + range.virtualOffset); }
  }, [m, blocked, foreground, playbackClock, playerPosition, total, strip, lastVisible, receiveOffset]));
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const pinch = useMemo(() => Gesture.Pinch().enabled(!busy && !committing && !dragging).simultaneousWithExternalGesture(nativeGesture)
    .onStart(() => {
      if (m.phase.value >= 3 && m.phase.value !== 6 || blocked.value) return;
      pinchScale.value = m.scale.value; pinchAnchor.value = Math.max(0, Math.min(total.value, m.offset.value / m.scale.value));
      m.epoch.value += 1; m.phase.value = 4; runOnJS(receivePinching)(true, m.epoch.value); runOnJS(startScrub)(m.epoch.value);
    }).onUpdate(event => {
      if (m.phase.value !== 4) return;
      m.scale.value = Math.max(minimumStudioTimelineScale, Math.min(maximumStudioTimelineScale, pinchScale.value * event.scale));
      const next = pinchAnchor.value * m.scale.value; m.offset.value = next; scrollTo(strip, next, 0, false);
      const now = Date.now(); if (now - lastVisible.value >= 64) { lastVisible.value = now; runOnJS(receiveScale)(m.scale.value); runOnJS(receiveOffset)(next); }
    }).onFinalize(() => {
      if (m.phase.value !== 4) return;
      seekTarget.value = pinchAnchor.value;
      playbackClock.value = resetStudioTimelinePlayback(pinchAnchor.value, total.value);
      playerPosition.value = pinchAnchor.value; m.phase.value = 0;
      runOnJS(receiveScale)(m.scale.value); runOnJS(receivePinching)(false, m.epoch.value); runOnJS(seekOffset)(pinchAnchor.value * m.scale.value, m.scale.value, m.epoch.value);
    }), [busy, committing, dragging, nativeGesture]);
  const changeZoom = (factor: number) => {
    if (busy || dragging || committing || pinching || m.phase.value >= 3 && m.phase.value !== 6) return;
    const next = clampStudioTimelineScale(scale * factor);
    m.scale.value = next; setScale(next);
  };
  const laneNavigationDisabled = locked || busy || dragging || committing || pinching;
  const changeLanes = (direction: number) => {
    // Paging has its own touch targets. It cannot replace a row under an
    // active hold, edge trim, save or horizontal scrub.
    if (laneNavigationDisabled || m.phase.value !== 0) return;
    setFirstLane(Math.max(0, Math.min(lastLaneStart, laneStart + direction * visibleLaneCount)));
  };
  // Child pans already block this Native gesture. Disabling UIScrollView at
  // their activation mutates the ancestor recognizer during the same touch.
  const scrollProps = useAnimatedProps(() => ({ scrollEnabled: !blocked.value && m.phase.value !== 4 && m.phase.value !== 5 }));
  const canvasStyle = useAnimatedStyle(() => ({ width: Math.max(m.viewport.value, m.viewport.value + total.value * m.scale.value + Math.max(0, m.leading.value * m.scale.value) + Math.max(0, -m.virtual.value) + (onAppend ? 68 : 0)), transform: [{ translateX: -m.virtual.value }] }));
  const previewDuration = layout.duration + (draft && selected ? draft.end - draft.start - (selected.take.end - selected.take.start) : 0);
  const ticks = previewOnly ? [] : studioTimelineTicks(scale, Math.max(0, visibleStart / scale), Math.max(0, visibleEnd / scale), previewDuration);
  const trimDisabled = !!(locked || busy || committing || pinching || !onTrimCommit || layout.error);

  if (!takes.length || layout.error) return <View style={[styles.empty, { height: rulerHeight + trackHeight + 26 }]}>
    {audio ? <Mic size={19} color={colors.mutedDim} strokeWidth={1.4} /> : <Film size={19} color={colors.mutedDim} strokeWidth={1.4} />}
    <Text style={styles.emptyText}>{layout.error ? 'Revise os limites dos takes' : 'Grave ou importe seu primeiro take'}</Text>
    {onAppend ? <AppendButton disabled={locked || busy} onPress={onAppend} /> : null}
  </View>;
  return <GestureDetector gesture={pinch}><Animated.View ref={host} onLayout={event => { const width = Math.max(1, event.nativeEvent.layout.width); m.viewport.value = width; setViewport(width); }} style={[styles.timeline, { height: mainTop + trackHeight + (previewOnly ? 0 : 48) }]}>
    {visibleLanes.map((lane, index) => <View key={lane} pointerEvents="none" style={[styles.laneBackground, { top: rulerHeight + index * laneHeight, height: laneHeight - 4 }]} />)}
    <View pointerEvents="none" style={[styles.laneBackground, { top: mainTop, height: trackHeight }]} />
    <GestureDetector gesture={nativeGesture}><Animated.ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} bounces={false} scrollEventThrottle={16} decelerationRate="normal" animatedProps={scrollProps} onScroll={scrollHandler} keyboardShouldPersistTaps="handled">
      <Animated.View style={[{ height: mainTop + trackHeight + (previewOnly ? 0 : 4) }, canvasStyle]}>
        {ticks.map(tick => <TimelineTick key={tick.seconds} tick={tick} motion={m} />)}
        {layout.segments.map(segment => <TimelineClip key={segment.take.id} segment={segment} motion={m} selected={segment.take.id === activeTakeId} audio={audio} top={mainTop} height={trackHeight} draft={draft} draftIndex={draft ? selected?.index ?? -1 : -1} draftOriginal={selected?.take} visibleStart={visibleStart} visibleEnd={visibleEnd} scale={scale}
          disabled={!!(busy || dragging || committing || pinching)} onSelect={() => { live.current.onSelect(segment.take); }} />)}
        {newLane !== undefined && visibleLanes.includes(newLane) ? <TimelineLaneTarget motion={m} top={rulerHeight + (laneIndices.indexOf(newLane) - laneStart) * laneHeight} /> : null}
        {visibleLayers.map(item => <TimelineLayer key={item.id} item={item} editing={editing} motion={m} host={host} strip={strip} viewport={viewport} duration={layout.mainDuration} cancelEpoch={`${cancelEpoch}:${lifecycleEpoch}`} selected={item.id === selectedLayerId} lanes={laneIndices} rowTop={rulerHeight} rowCount={visibleLanes.length} top={rulerHeight + (laneIndices.indexOf(item.zIndex) - laneStart) * laneHeight} disabled={!!(locked || busy || dragging || committing || pinching)} onSelect={() => onSelectLayer?.(item.id)} onEdit={() => (onEditLayer ?? onSelectLayer)?.(item.id)} onMove={onMoveLayer ? (delta, destination) => onMoveLayer(item.id, delta, destination) : undefined} onLaneWindowChange={receiveLaneWindow} onInteractionStart={onLayerInteractionStart} onInteractionEnd={onLayerInteractionEnd} onTrimPreview={onLayerTrimPreview} onTrimCommit={onLayerTrimCommit} nativeGesture={nativeGesture} />)}
        {selected && !previewOnly && !locked && onTrimCommit ? (['start', 'end'] as const).map(edge => <TrimHandle key={edge} edge={edge} take={selected.take} index={selected.index} startSeconds={selected.start} endSeconds={selected.end} motion={m} host={host} nativeGesture={nativeGesture} disabled={trimDisabled} top={mainTop} height={trackHeight} onBegin={beginTrim} onCommit={commitTrim} onCancel={cancelTrim} onAccessibleChange={accessibleTrim} />) : null}
        <TimelineSnapGuide motion={m} height={mainTop + trackHeight} />
      </Animated.View>
    </Animated.ScrollView></GestureDetector>
    {onAppend && !previewOnly ? <View style={{ position: 'absolute', top: mainTop + (trackHeight - 44) / 2, right: 8, zIndex: 6 }}><AppendButton disabled={locked || busy || committing || dragging || pinching} onPress={onAppend} /></View> : null}
    <View pointerEvents="none" accessible accessibilityRole="adjustable" accessibilityLabel="Posição da montagem" accessibilityState={{ disabled: busy || dragging || committing || pinching }}
      accessibilityValue={{ min: 0, max: layout.duration, now: Math.max(0, Math.min(layout.duration, position)), text: formatStudioEditorTime(position) }}
      accessibilityActions={[{ name: 'increment', label: 'Avançar um segundo' }, { name: 'decrement', label: 'Voltar um segundo' }]}
      onAccessibilityAction={event => { if (!busy && !dragging && !committing && !pinching) { onScrubStart?.(); onSeek(Math.max(0, Math.min(layout.duration, position + (event.nativeEvent.actionName === 'increment' ? 1 : -1)))); } }}
      style={{ position: 'absolute', width: 44, left: viewport / 2 - 22, top: previewOnly ? 0 : 18, height: mainTop + trackHeight - (previewOnly ? 0 : 18), zIndex: 4 }}>
      <View style={[styles.playhead, { left: 21, height: mainTop + trackHeight - (previewOnly ? 0 : 18) }]}><View style={styles.playheadCap} /></View>
    </View>
    {!previewOnly ? <View style={styles.caption}>
      {laneIndices.length > visibleLaneCount ? <View accessibilityLiveRegion="polite" accessibilityValue={{ text: `Faixas ${laneStart + 1}–${laneStart + visibleLanes.length} de ${laneIndices.length}` }} style={styles.laneControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Faixas anteriores" disabled={laneNavigationDisabled || laneStart === 0} onPress={() => changeLanes(-1)} style={styles.laneButton}><ChevronUp size={16} color={laneNavigationDisabled || laneStart === 0 ? colors.mutedDim : colors.textSecondary} strokeWidth={1.6} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Próximas faixas" disabled={laneNavigationDisabled || laneStart === lastLaneStart} onPress={() => changeLanes(1)} style={styles.laneButton}><ChevronDown size={16} color={laneNavigationDisabled || laneStart === lastLaneStart ? colors.mutedDim : colors.textSecondary} strokeWidth={1.6} /></Pressable>
      </View> : <View style={{ flex: 1 }} />}
      <View style={styles.scaleControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Diminuir zoom da timeline" disabled={busy || dragging || committing || pinching || scale <= minimumStudioTimelineScale} onPress={() => changeZoom(1 / 1.5)} style={styles.scaleButton}><Minus size={15} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Aumentar zoom da timeline" disabled={busy || dragging || committing || pinching || scale >= maximumStudioTimelineScale} onPress={() => changeZoom(1.5)} style={styles.scaleButton}><Plus size={15} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
      </View>
    </View> : null}
  </Animated.View></GestureDetector>;
}

function TimelineLayer({ item, editing, motion: m, host, strip, viewport, duration, cancelEpoch, selected, top, lanes, rowTop, rowCount, disabled, onSelect, onEdit, onMove, onLaneWindowChange, onInteractionStart, onInteractionEnd, onTrimPreview, onTrimCommit, nativeGesture }: {
  item: StudioRecipeClip; editing?: StudioEditing; motion: Motion; selected: boolean; top: number; disabled: boolean; duration: number; cancelEpoch: number | string;
  lanes: readonly number[]; rowTop: number; rowCount: number; viewport: number; onLaneWindowChange: (start: number, epoch: number) => void;
  host: ReturnType<typeof useAnimatedRef<Animated.View>>; strip: ReturnType<typeof useAnimatedRef<Animated.ScrollView>>;
  onSelect: () => void; onEdit: () => void; onMove?: (delta: number, targetZIndex?: number) => Promise<void>; onInteractionStart?: () => void; onInteractionEnd?: () => void;
  onTrimPreview?: (id: string, range: StudioLayerTimelineRange | undefined) => void;
  onTrimCommit?: (id: string, range: StudioLayerTimelineRange) => void | Promise<void>; nativeGesture: ReturnType<typeof Gesture.Native>;
}) {
  const live = useRef({ item, editing, selected, disabled, lanes, onMove, onLaneWindowChange, onTrimPreview, onTrimCommit, onInteractionStart, onInteractionEnd, onEdit });
  live.current = { item, editing, selected, disabled, lanes, onMove, onLaneWindowChange, onTrimPreview, onTrimCommit, onInteractionStart, onInteractionEnd, onEdit };
  const mounted = useRef(true);
  const operation = useRef<{ epoch: number; mode: StudioLayerTimelineMode; frozen: StudioLayerTimelineSnapshot; committing?: boolean } | null>(null);
  const frozen = useMemo(() => {
    try { if (editing) return freezeStudioLayerTimeline(editing, item.id); }
    catch { return null; }
    // Existing callers can still move a layer while adopting the new editing
    // contract. Trimming requires the actual immutable source metadata.
    const startSeconds = item.startTicks / 120000, endSeconds = startSeconds + item.durationTicks / 120000;
    return { id: item.id, signature: `${item.id}:${item.startTicks}:${item.durationTicks}`, startSeconds, endSeconds,
      minimumDuration: Math.min(0.1, endSeconds - startSeconds), minimumStart: 0, maximumEnd: Math.max(duration, endSeconds),
      moveMinimum: 0, moveMaximum: Math.max(duration, endSeconds), sourceStartSeconds: item.sourceStartTicks / 120000,
      sourceEndSeconds: item.sourceEndTicks / 120000, temporal: item.kind === 'video' || item.kind === 'audio' } satisfies StudioLayerTimelineSnapshot;
  }, [editing, item.id, item.startTicks, item.durationTicks, item.sourceStartTicks, item.sourceEndTicks, item.kind, duration]);
  const bounds = useSharedValue<StudioLayerTimelineSnapshot | null>(frozen);
  const original = useSharedValue<StudioLayerTimelineSnapshot | null>(null);
  const start = useSharedValue(item.startTicks / 120000), end = useSharedValue((item.startTicks + item.durationTicks) / 120000);
  const epoch = useSharedValue(0), mode = useSharedValue<StudioLayerTimelineMode>('move');
  const finger = useSharedValue(0), translation = useSharedValue(0), initialOffset = useSharedValue(0), frozenScale = useSharedValue(1);
  const laneBounds = useSharedValue({ source: item.zIndex, lanes, top });
  const originalLanes = useSharedValue<readonly number[]>([]), sourceLane = useSharedValue(item.zIndex), targetLane = useSharedValue(item.zIndex);
  const dragY = useSharedValue(0), fingerY = useSharedValue(0), initialTop = useSharedValue(top - 2), initialWindow = useSharedValue(0);
  const verticalSteps = useSharedValue(0), lastVerticalScroll = useSharedValue(0);
  const lastPublish = useSharedValue(0);
  const activeSnapPoints = useSharedValue<readonly StudioTimelineSnapPoint[]>([]);
  const trimEnabled = selected && !disabled && !!editing && !!onTrimCommit && !!frozen;
  const moveEnabled = selected && !disabled && !!onMove && !!frozen;

  const release = useCallback((expected: number) => {
    if (epoch.value !== expected) return;
    const ended = operation.current?.epoch === expected;
    operation.current = null;
    start.value = live.current.item.startTicks / 120000; end.value = (live.current.item.startTicks + live.current.item.durationTicks) / 120000;
    original.value = null;
    dragY.value = 0; verticalSteps.value = 0;
    if (m.epoch.value === expected && (m.phase.value === 7 || m.phase.value === 8 || m.phase.value === 5)) {
      m.snap.value = null;
      m.phase.value = 0;
      const index = live.current.lanes.indexOf(live.current.item.zIndex);
      const lastStart = Math.max(0, live.current.lanes.length - visibleLaneCount);
      const window = Math.max(0, Math.min(lastStart, m.laneStart.value));
      const nextWindow = index < window ? Math.max(0, index) : index >= window + visibleLaneCount ? index - visibleLaneCount + 1 : window;
      m.laneStart.value = nextWindow;
      live.current.onLaneWindowChange(nextWindow, expected);
    }
    live.current.onTrimPreview?.(live.current.item.id, undefined);
    if (ended) live.current.onInteractionEnd?.();
  }, []);
  const cancel = useCallback((expected: number) => { if (!operation.current?.committing) release(expected); }, [release]);
  const begin = useCallback((expected: number, nextMode: StudioLayerTimelineMode, snapshot: StudioLayerTimelineSnapshot) => {
    const current = live.current;
    if (!mounted.current || !original.value || epoch.value !== expected || m.epoch.value !== expected || current.disabled || !current.selected
      || (nextMode === 'move' ? !current.onMove : !current.editing || !current.onTrimCommit)
      || current.editing && !canContinueStudioLayerTimeline(snapshot, current.editing, current.item.id)) { release(expected); return; }
    operation.current = { epoch: expected, mode: nextMode, frozen: snapshot };
    current.onInteractionStart?.();
    if (nextMode !== 'move') current.onTrimPreview?.(snapshot.id, { startSeconds: snapshot.startSeconds, endSeconds: snapshot.endSeconds });
  }, [release]);
  const preview = useCallback((expected: number, range: StudioLayerTimelineRange) => {
    const drag = operation.current, current = live.current;
    if (!drag || drag.committing || drag.epoch !== expected || epoch.value !== expected || m.epoch.value !== expected) return;
    if (current.disabled || !current.selected || current.editing && !canContinueStudioLayerTimeline(drag.frozen, current.editing, current.item.id)) { cancel(expected); return; }
    if (drag.mode !== 'move') current.onTrimPreview?.(drag.frozen.id, range);
  }, [cancel]);
  const commit = useCallback(async (expected: number, range: StudioLayerTimelineRange, destination?: number) => {
    const drag = operation.current, current = live.current;
    if (!drag || drag.committing || drag.epoch !== expected || epoch.value !== expected || m.epoch.value !== expected) return;
    if (current.disabled || !current.selected || current.editing && !canContinueStudioLayerTimeline(drag.frozen, current.editing, current.item.id)) { cancel(expected); return; }
    const changed = Math.abs(range.startSeconds - drag.frozen.startSeconds) > 1 / 120000 || Math.abs(range.endSeconds - drag.frozen.endSeconds) > 1 / 120000
      || drag.mode === 'move' && destination !== undefined && destination !== current.item.zIndex;
    if (!changed) { release(expected); return; }
    drag.committing = true;
    try {
      if (drag.mode === 'move') await current.onMove?.(range.startSeconds - drag.frozen.startSeconds, destination === current.item.zIndex ? undefined : destination);
      else { current.onTrimPreview?.(drag.frozen.id, range); await current.onTrimCommit?.(drag.frozen.id, range); }
    } catch { /* The parent owns the visible save/recovery error. */ }
    finally { if (mounted.current && operation.current === drag) release(expected); }
  }, [cancel, release]);
  useEffect(() => {
    bounds.value = frozen;
    laneBounds.value = { source: item.zIndex, lanes, top };
    // Keep the active geometry frozen while parent preview callbacks rerender.
    if (original.value && m.epoch.value === epoch.value && [5, 7, 8].includes(m.phase.value)) return;
    start.value = item.startTicks / 120000; end.value = (item.startTicks + item.durationTicks) / 120000;
  }, [frozen, item.startTicks, item.durationTicks, item.zIndex, lanes, top]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (original.value) release(epoch.value); };
  }, [release]);
  useEffect(() => {
    const drag = operation.current;
    if (drag && !drag.committing && (disabled || !selected || editing && !canContinueStudioLayerTimeline(drag.frozen, editing, item.id))) cancel(drag.epoch);
  }, [disabled, selected, editing, item.id, cancel]);
  useEffect(() => { if (original.value) cancel(epoch.value); }, [cancelEpoch, cancel]);
  // Handles live inside their parent's hit bounds, including their outward
  // 32pt touch targets; RN cannot hit-test children outside parent bounds.
  const geometry = useAnimatedStyle(() => ({
    left: m.viewport.value / 2 + start.value * m.scale.value - handleInset,
    width: Math.max(8, (end.value - start.value) * m.scale.value) + handleInset * 2,
    top: original.value && mode.value === 'move' && epoch.value === m.epoch.value
      ? Math.max(rowTop - 2, Math.min(rowTop + (rowCount - 1) * laneHeight - 2, initialTop.value + dragY.value + verticalSteps.value * laneHeight + (initialWindow.value - m.laneStart.value) * laneHeight))
      : top - 2,
  }));
  useAnimatedReaction(() => ({ phase: m.phase.value, epoch: epoch.value, start: start.value, end: end.value }), value => {
    if (value.phase !== 8 || value.epoch !== m.epoch.value || !original.value) return;
    const now = Date.now();
    if (now - lastPublish.value >= 1000 / 12) { lastPublish.value = now; runOnJS(preview)(value.epoch, { startSeconds: value.start, endSeconds: value.end }); }
  });
  const applyLayerRange = useCallback((snapshot: StudioLayerTimelineSnapshot, nextMode: StudioLayerTimelineMode, delta: number, independentLane: boolean) => {
    'worklet';
    const raw = studioLayerDragRange(snapshot, nextMode, delta, independentLane);
    const bounds = independentLane ? { ...snapshot, moveMinimum: snapshot.independentMoveMinimum ?? snapshot.moveMinimum, moveMaximum: snapshot.independentMoveMaximum ?? snapshot.moveMaximum } : snapshot;
    const snapped = snapStudioTimelineRange(raw, nextMode, bounds, activeSnapPoints.value, frozenScale.value, m.snap.value);
    start.value = snapped.range.startSeconds; end.value = snapped.range.endSeconds; m.snap.value = snapped.match;
  }, [start, end, m, activeSnapPoints, frozenScale]);
  useFrameCallback(useCallback(frame => {
    'worklet';
    if (![7, 8].includes(m.phase.value) || epoch.value !== m.epoch.value || !original.value) return;
    if (mode.value === 'move' && originalLanes.value.length > rowCount) {
      const direction = fingerY.value < rowTop + laneHeight * 0.4 ? -1 : fingerY.value > rowTop + rowCount * laneHeight - laneHeight * 0.4 ? 1 : 0;
      const currentIndex = originalLanes.value.indexOf(targetLane.value);
      const now = Date.now();
      if (direction && now - lastVerticalScroll.value >= 280 && currentIndex + direction >= 0 && currentIndex + direction < originalLanes.value.length) {
        lastVerticalScroll.value = now; verticalSteps.value += direction;
        targetLane.value = studioLayerDragDestination(sourceLane.value, originalLanes.value, dragY.value + verticalSteps.value * laneHeight, laneHeight);
        applyLayerRange(original.value, 'move', (translation.value + m.offset.value - initialOffset.value) / frozenScale.value, targetLane.value !== sourceLane.value);
        const nextIndex = originalLanes.value.indexOf(targetLane.value), window = m.laneStart.value;
        const nextWindow = Math.max(0, Math.min(originalLanes.value.length - rowCount, nextIndex < window ? nextIndex : nextIndex >= window + rowCount ? nextIndex - rowCount + 1 : window));
        if (nextWindow !== window) { m.laneStart.value = nextWindow; runOnJS(onLaneWindowChange)(nextWindow, epoch.value); }
      }
    }
    const speed = studioTimelineAutoScrollVelocity(finger.value, m.viewport.value);
    if (!speed) return;
    const nextOffset = Math.max(0, Math.min(duration * frozenScale.value, m.offset.value + speed * Math.min(32, frame.timeSincePreviousFrame ?? 16) / 1000));
    applyLayerRange(original.value, mode.value, (translation.value + nextOffset - initialOffset.value) / frozenScale.value, mode.value === 'move' && targetLane.value !== sourceLane.value);
    m.offset.value = nextOffset;
    scrollTo(strip, nextOffset, 0, false);
  }, [m, epoch, original, mode, originalLanes, rowCount, rowTop, fingerY, targetLane, lastVerticalScroll, verticalSteps, sourceLane, dragY, applyLayerRange, translation, initialOffset, frozenScale, onLaneWindowChange, finger, duration, strip]));
  const updateLayerDrag = (event: { translationX: number; absoluteX: number; translationY?: number; absoluteY?: number }) => {
    'worklet';
    if (![7, 8].includes(m.phase.value) || epoch.value !== m.epoch.value || !original.value) return;
    translation.value = event.translationX; finger.value = event.absoluteX - (measure(host)?.pageX ?? 0);
    if (mode.value === 'move') {
      dragY.value = Number.isFinite(event.translationY) ? event.translationY! : 0;
      fingerY.value = (event.absoluteY ?? 0) - (measure(host)?.pageY ?? 0);
      targetLane.value = studioLayerDragDestination(sourceLane.value, originalLanes.value, dragY.value + verticalSteps.value * laneHeight, laneHeight);
      const index = originalLanes.value.indexOf(targetLane.value), window = m.laneStart.value;
      const nextWindow = Math.max(0, Math.min(Math.max(0, originalLanes.value.length - rowCount), index < window ? index : index >= window + rowCount ? index - rowCount + 1 : window));
      if (nextWindow !== window) { m.laneStart.value = nextWindow; runOnJS(onLaneWindowChange)(nextWindow, epoch.value); }
    }
    applyLayerRange(original.value, mode.value, (event.translationX + m.offset.value - initialOffset.value) / frozenScale.value, mode.value === 'move' && targetLane.value !== sourceLane.value);
  };
  const makePan = (nextMode: StudioLayerTimelineMode, enabled: boolean) => (nextMode === 'move' ? Gesture.Pan().activateAfterLongPress(220) : Gesture.Pan()).enabled(enabled).maxPointers(1).minDistance(1).shouldCancelWhenOutside(false).blocksExternalGesture(nativeGesture)
    .onStart(event => {
      // Conditional factories are outside Babel's automatic Gesture.Pan
      // detection. Keep every callback explicitly on the UI thread.
      'worklet';
      const snapshot = bounds.value;
      if (!snapshot || original.value || m.phase.value >= 3 && m.phase.value !== 6) return;
      m.epoch.value += 1; epoch.value = m.epoch.value; m.phase.value = nextMode === 'move' ? 7 : 8;
      original.value = snapshot; mode.value = nextMode; frozenScale.value = m.scale.value; initialOffset.value = m.offset.value; translation.value = 0;
      activeSnapPoints.value = studioTimelineSnapTargets(m.snapPoints.value, `layer:${snapshot.id}:`); m.snap.value = null;
      start.value = snapshot.startSeconds; end.value = snapshot.endSeconds;
      finger.value = event.absoluteX - (measure(host)?.pageX ?? 0);
      const lane = laneBounds.value;
      originalLanes.value = lane.lanes; sourceLane.value = lane.source; targetLane.value = lane.source;
      dragY.value = 0; verticalSteps.value = 0; lastVerticalScroll.value = Date.now();
      initialTop.value = lane.top - 2; initialWindow.value = m.laneStart.value;
      fingerY.value = event.absoluteY - (measure(host)?.pageY ?? 0);
      runOnJS(begin)(epoch.value, nextMode, snapshot);
    }).onUpdate(event => {
      'worklet';
      updateLayerDrag(event);
    }).onEnd((event, success) => {
      'worklet';
      if (![7, 8].includes(m.phase.value) || epoch.value !== m.epoch.value || !original.value) return;
      if (success === false) {
        start.value = original.value.startSeconds; end.value = original.value.endSeconds;
        original.value = null; dragY.value = 0; verticalSteps.value = 0; m.snap.value = null;
        runOnJS(cancel)(epoch.value); return;
      }
      if (Number.isFinite(event?.translationX)) updateLayerDrag(event);
      m.snap.value = null; m.phase.value = 5; runOnJS(commit)(epoch.value, { startSeconds: start.value, endSeconds: end.value }, nextMode === 'move' ? targetLane.value : undefined);
    }).onFinalize((_, success) => {
      'worklet';
      if (!success && original.value && [7, 8].includes(m.phase.value) && epoch.value === m.epoch.value) { m.snap.value = null; runOnJS(cancel)(epoch.value); }
    });
  // Callbacks read their latest props through refs. Preview rerenders must not
  // replace the recognizer or the source snapshot under the user's finger.
  const bodyPan = useMemo(() => makePan('move', moveEnabled), [moveEnabled, nativeGesture, rowCount, rowTop]);
  const edit = useCallback(() => { if (!live.current.disabled) live.current.onEdit(); }, []);
  const doubleTap = useMemo(() => Gesture.Tap().enabled(!disabled).numberOfTaps(2).maxDuration(220).maxDelay(280)
    .onEnd((_, success) => { if (success) runOnJS(edit)(); }), [disabled, edit]);
  const bodyGesture = useMemo(() => Gesture.Race(bodyPan, doubleTap), [bodyPan, doubleTap]);
  const startPan = useMemo(() => makePan('start', trimEnabled), [trimEnabled, nativeGesture, rowCount, rowTop]);
  const endPan = useMemo(() => makePan('end', trimEnabled), [trimEnabled, nativeGesture, rowCount, rowTop]);
  const commitAccessible = useCallback((expected: number, nextMode: StudioLayerTimelineMode, snapshot: StudioLayerTimelineSnapshot, range: StudioLayerTimelineRange, destination?: number) => {
    begin(expected, nextMode, snapshot);
    if (operation.current?.epoch === expected) void commit(expected, range, destination);
  }, [begin, commit]);
  const accessibleTrim = (edge: Edge, delta: number) => {
    if (!trimEnabled || !frozen || m.phase.value >= 3 && m.phase.value !== 6) return;
    // JS SharedValue writes are asynchronous. Establish the operation and its
    // geometry atomically on UI, then pass its confirmed epoch back to JS.
    runOnUI((snapshot: StudioLayerTimelineSnapshot, nextEdge: Edge, change: number, previous: number) => {
      'worklet';
      if (original.value || m.epoch.value !== previous || m.phase.value >= 3 && m.phase.value !== 6) return;
      m.epoch.value += 1; epoch.value = m.epoch.value; original.value = snapshot; mode.value = nextEdge;
      const range = studioLayerDragRange(snapshot, nextEdge, change);
      start.value = range.startSeconds; end.value = range.endSeconds; m.phase.value = 5;
      runOnJS(commitAccessible)(epoch.value, nextEdge, snapshot, range);
    })(frozen, edge, delta, m.epoch.value);
  };
  const accessibleMoveLane = (direction: number) => {
    if (!moveEnabled || !frozen || m.phase.value >= 3 && m.phase.value !== 6) return;
    const destination = studioLayerDragDestination(item.zIndex, lanes, direction * laneHeight, laneHeight);
    if (destination === item.zIndex) return;
    runOnUI((snapshot: StudioLayerTimelineSnapshot, nextLane: number, previous: number) => {
      'worklet';
      if (original.value || m.epoch.value !== previous || m.phase.value >= 3 && m.phase.value !== 6) return;
      m.epoch.value += 1; epoch.value = m.epoch.value; original.value = snapshot; mode.value = 'move';
      targetLane.value = nextLane; dragY.value = 0; verticalSteps.value = 0;
      initialTop.value = laneBounds.value.top - 2; initialWindow.value = m.laneStart.value;
      start.value = snapshot.startSeconds; end.value = snapshot.endSeconds; m.phase.value = 5;
      runOnJS(commitAccessible)(epoch.value, 'move', snapshot, { startSeconds: snapshot.startSeconds, endSeconds: snapshot.endSeconds }, nextLane);
    })(frozen, destination, m.epoch.value);
  };
  const title = item.kind === 'text' || item.kind === 'caption' ? item.text?.content : item.kind === 'video' ? 'Vídeo' : item.kind === 'image' ? 'Imagem' : 'Áudio';
  const tint = item.kind === 'text' || item.kind === 'caption' ? '#803DFF' : item.kind === 'audio' ? '#173C36' : '#283548';
  const asset = editing?.assets.find(value => value.id === item.assetId);
  const thumbnail = asset?.kind === 'image' ? asset.uri : asset?.kind === 'video' ? asset.thumbnailUri : undefined;
  // A bounded strip repeats existing raster assets; it never opens a video
  // decoder or generates frames for invisible overlay media.
  const thumbnailTiles = thumbnail ? Array.from({ length: Math.max(1, Math.ceil(Math.max(1, viewport) / tileWidth) + 2) }, (_, index) => index) : [];
  const thumbnailStyle = useAnimatedStyle(() => ({ transform: [{ translateX: Math.max(0, Math.floor((m.offset.value - start.value * m.scale.value - m.viewport.value / 2) / tileWidth)) * tileWidth }] }));
  return <Animated.View pointerEvents="box-none" style={[{ position: 'absolute', top: top - 2, height: laneHeight, zIndex: selected ? 8 : 1 }, geometry]}>
    <GestureDetector gesture={bodyGesture}><AnimatedPressable disabled={disabled} onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Selecionar camada ${title}`} accessibilityHint="Toque duas vezes para editar. Segure para mover no tempo ou entre faixas." accessibilityState={{ selected, disabled }}
      accessibilityActions={moveEnabled && lanes.length > 1 ? [{ name: 'moveUp', label: 'Mover para a faixa anterior' }, { name: 'moveDown', label: 'Mover para a próxima faixa' }] : undefined}
      onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'moveUp') accessibleMoveLane(-1); else if (event.nativeEvent.actionName === 'moveDown') accessibleMoveLane(1); }}
      style={[StyleSheet.absoluteFillObject, { left: handleInset, right: handleInset, top: 2, bottom: 2, borderRadius: 7, backgroundColor: tint, borderWidth: selected ? 2 : 1, borderColor: selected ? snapColor : 'rgba(255,255,255,0.1)', paddingHorizontal: selected ? 10 : 9, justifyContent: 'center', overflow: 'hidden' }]}>
      {thumbnail ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, thumbnailStyle]}>{thumbnailTiles.map(index => <Image key={index} source={{ uri: thumbnail }} pointerEvents="none" contentFit="cover" transition={0} cachePolicy="memory-disk" style={{ position: 'absolute', left: index * tileWidth, width: tileWidth, top: 0, bottom: 0 }} />)}</Animated.View> : <Text numberOfLines={1} style={{ color: colors.text, fontSize: 12, fontWeight: '500' }}>{title}</Text>}
    </AnimatedPressable></GestureDetector>
    {selected && editing && onTrimCommit ? (['start', 'end'] as const).map(edge => <GestureDetector key={edge} gesture={edge === 'start' ? startPan : endPan}><Animated.View
      accessible accessibilityRole="adjustable" accessibilityLabel={edge === 'start' ? 'Início da camada' : 'Fim da camada'} accessibilityState={{ disabled: !trimEnabled }}
      accessibilityValue={{ min: frozen?.minimumStart ?? 0, max: frozen?.maximumEnd ?? duration, now: edge === 'start' ? item.startTicks / 120000 : (item.startTicks + item.durationTicks) / 120000, text: formatStudioEditorTime(edge === 'start' ? item.startTicks / 120000 : (item.startTicks + item.durationTicks) / 120000) }}
      accessibilityActions={[{ name: 'increment', label: 'Avançar um décimo de segundo' }, { name: 'decrement', label: 'Voltar um décimo de segundo' }]}
      onAccessibilityAction={event => accessibleTrim(edge, event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1)}
      style={{ position: 'absolute', top: 0, height: laneHeight, width: 32, ...(edge === 'start' ? { left: 0, alignItems: 'flex-end' as const } : { right: 0, alignItems: 'flex-start' as const }), justifyContent: 'center', zIndex: 2 }}>
      <View style={{ height: laneHeight - 4, width: 8, borderRadius: 4, backgroundColor: snapColor, alignItems: 'center', justifyContent: 'center', opacity: trimEnabled ? 1 : 0.45 }}><View style={{ width: 2, height: 20, borderRadius: 1, backgroundColor: '#0B0E11' }} /></View>
    </Animated.View></GestureDetector>) : null}
  </Animated.View>;
}

function TimelineLaneTarget({ motion: m, top }: { motion: Motion; top: number }) {
  const style = useAnimatedStyle(() => ({ left: m.offset.value + 16, width: Math.max(0, m.viewport.value - 32) }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', top, height: laneHeight - 4, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, borderRadius: 7 }, style]} />;
}

function TimelineSnapGuide({ motion: m, height }: { motion: Motion; height: number }) {
  const style = useAnimatedStyle(() => ({ left: m.viewport.value / 2 + (m.snap.value?.seconds ?? 0) * m.scale.value,
    opacity: m.snap.value && [3, 7, 8].includes(m.phase.value) ? 1 : 0 }));
  return <Animated.View pointerEvents="none" accessible={false} style={[styles.snapGuide, { top: 12, height: Math.max(0, height - 12) }, style]} />;
}

function applyMainSnap(m: Motion, raw: { start: number; end: number }) {
  'worklet';
  const mode = m.edge.value === 0 ? 'start' : 'end';
  const absolute = { startSeconds: m.mainTimelineStart.value + raw.start - m.originalStart.value,
    endSeconds: m.mainTimelineEnd.value + raw.end - m.originalEnd.value };
  const bounds = { minimumStart: m.mainTimelineStart.value - m.originalStart.value,
    maximumEnd: m.mainTimelineEnd.value + m.sourceDuration.value - m.originalEnd.value,
    minimumDuration: Math.min(0.1, m.sourceDuration.value), moveMinimum: 0, moveMaximum: 0 };
  const snapped = snapStudioTimelineRange(absolute, mode, bounds, m.mainSnapPoints.value, m.scale.value, m.snap.value);
  m.start.value = m.originalStart.value + snapped.range.startSeconds - m.mainTimelineStart.value;
  m.end.value = m.originalEnd.value + snapped.range.endSeconds - m.mainTimelineEnd.value;
  m.leading.value = mode === 'start' ? m.start.value - m.originalStart.value : 0; m.snap.value = snapped.match;
}

function TimelineTick({ tick, motion: m }: { tick: { seconds: number; major: boolean }; motion: Motion }) {
  const style = useAnimatedStyle(() => ({ left: m.viewport.value / 2 + (tick.seconds + m.leading.value) * m.scale.value }));
  return <Animated.View pointerEvents="none" style={[styles.tick, { height: tick.major ? 8 : 4, top: tick.major ? 18 : 22 }, style]}>{tick.major ? <Text style={styles.tickLabel}>{formatStudioDuration(tick.seconds)}</Text> : null}</Animated.View>;
}
function TimelineClip({ segment, motion: m, selected, audio, top, height, draft, draftIndex, draftOriginal, visibleStart, visibleEnd, scale, disabled, onSelect }: {
  segment: ReturnType<typeof studioTimelineLayout>['segments'][number]; motion: Motion; selected: boolean; audio: boolean; top: number; height: number; draft: StudioTimelineTrim | null; draftIndex: number; draftOriginal?: StudioTake; visibleStart: number; visibleEnd: number; scale: number; disabled: boolean; onSelect: () => void;
}) {
  const style = useAnimatedStyle(() => {
    const current = studioLiveSegment(segment.start, segment.end, segment.index, m.trimIndex.value, m.originalStart.value, m.originalEnd.value, m.start.value, m.end.value, m.scale.value, m.leading.value);
    return { left: m.viewport.value / 2 + current.x, width: current.width };
  });
  const displayTake = draft?.takeId === segment.take.id ? { ...segment.take, start: draft.start, end: draft.end } : segment.take;
  const displayGeometry = studioLiveSegment(segment.start, segment.end, segment.index, draftIndex, draftOriginal?.start ?? 0, draftOriginal?.end ?? 0, draft?.start ?? 0, draft?.end ?? 0, scale, draft && draftOriginal ? draft.start - draftOriginal.start : 0);
  return <AnimatedPressable disabled={disabled} onPress={onSelect} accessibilityRole="button" accessibilityLabel={`Selecionar take ${segment.index + 1}, ${formatStudioEditorTime(displayTake.end - displayTake.start)}`} accessibilityState={{ selected, disabled }}
    style={[styles.clip, { top, height }, selected && styles.selected, style]}>
    <ClipFrames take={displayTake} audio={audio} canvasX={displayGeometry.x} visibleStart={visibleStart} visibleEnd={visibleEnd} scale={scale} />
    <View pointerEvents="none" style={styles.shade} />
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
function TrimHandle({ edge, take, index, startSeconds, endSeconds, motion: m, host, nativeGesture, disabled, top, height, onBegin, onCommit, onCancel, onAccessibleChange }: {
  edge: Edge; take: StudioTake; index: number; startSeconds: number; endSeconds: number; motion: Motion; host: ReturnType<typeof useAnimatedRef<Animated.View>>; nativeGesture: ReturnType<typeof Gesture.Native>; disabled: boolean; top: number; height: number;
  onBegin: (edge: Edge, accessible?: boolean, expected?: number) => void; onCommit: (start: number, end: number, expected: number) => void; onCancel: (expected?: number) => void; onAccessibleChange: (edge: Edge, delta: number) => void;
}) {
  const style = useAnimatedStyle(() => {
    const geometry = studioLiveSegment(startSeconds, endSeconds, index, m.trimIndex.value, m.originalStart.value, m.originalEnd.value, m.start.value, m.end.value, m.scale.value, m.leading.value);
    return { left: m.viewport.value / 2 + geometry.x + (edge === 'end' ? geometry.width - 4 : -40) };
  });
  const pan = useMemo(() => Gesture.Pan().enabled(!disabled).maxPointers(1).minDistance(1).shouldCancelWhenOutside(false).blocksExternalGesture(nativeGesture)
    .onStart(event => {
      if (m.phase.value >= 3 && m.phase.value !== 6) return;
      m.trimIndex.value = index; m.edge.value = edge === 'start' ? 0 : 1; m.originalStart.value = take.start; m.originalEnd.value = take.end; m.sourceDuration.value = take.duration;
      m.start.value = take.start; m.end.value = take.end; m.leading.value = 0; m.virtual.value = 0; m.translation.value = 0; m.initialOffset.value = m.offset.value; m.epoch.value += 1;
      m.mainTimelineStart.value = startSeconds; m.mainTimelineEnd.value = endSeconds;
      m.mainSnapPoints.value = studioTimelineSnapTargets(m.snapPoints.value, `main:${take.id}:`); m.snap.value = null;
      m.finger.value = event.absoluteX - (measure(host)?.pageX ?? 0); m.phase.value = 3;
      runOnJS(onBegin)(edge, false, m.epoch.value);
    }).onUpdate(event => {
      if (m.phase.value !== 3) return;
      m.translation.value = event.translationX;
      m.finger.value = event.absoluteX - (measure(host)?.pageX ?? 0);
      const range = studioTrimDragValues(edge, take.start, take.end, take.duration, event.translationX, m.offset.value - m.initialOffset.value + m.virtual.value, m.scale.value);
      applyMainSnap(m, range);
    }).onEnd((event, success) => {
      if (m.phase.value !== 3) return;
      if (success === false) { m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.snap.value = null; m.phase.value = 0; runOnJS(onCancel)(m.epoch.value); return; }
      if (Number.isFinite(event?.translationX)) applyMainSnap(m, studioTrimDragValues(edge, take.start, take.end, take.duration, event.translationX, m.offset.value - m.initialOffset.value + m.virtual.value, m.scale.value));
      m.snap.value = null;
      m.phase.value = 5; runOnJS(onCommit)(m.start.value, m.end.value, m.epoch.value);
    }).onFinalize((_, success) => {
      if (!success && m.phase.value === 3) { m.trimIndex.value = -1; m.leading.value = 0; m.virtual.value = 0; m.snap.value = null; m.phase.value = 0; runOnJS(onCancel)(m.epoch.value); }
    }), [disabled, take.id, take.uri, take.start, take.end, take.duration, index, startSeconds, endSeconds, edge, nativeGesture, onBegin, onCommit, onCancel]);
  return <GestureDetector gesture={pan}><Animated.View accessible accessibilityRole="adjustable" accessibilityLabel={edge === 'start' ? 'Início do take' : 'Fim do take'} accessibilityState={{ disabled }} accessibilityValue={{ min: 0, max: take.duration, now: take[edge], text: formatStudioEditorTime(take[edge]) }} accessibilityActions={[{ name: 'increment', label: 'Avançar um décimo de segundo' }, { name: 'decrement', label: 'Voltar um décimo de segundo' }]} onAccessibilityAction={event => { if (!disabled) onAccessibleChange(edge, event.nativeEvent.actionName === 'increment' ? 0.1 : -0.1); }}
    style={[styles.handleTouch, { top: top - 4, height: height + 8, alignItems: edge === 'start' ? 'flex-end' : 'flex-start' }, style]}><View style={[styles.handle, disabled && { opacity: 0.45 }]}><View style={styles.grip} /></View></Animated.View></GestureDetector>;
}
function AppendButton({ disabled, onPress }: { disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Adicionar take à montagem" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.append, disabled && { opacity: 0.4 }, pressed && { backgroundColor: colors.surfaceAlt }]}><Plus size={22} color={colors.text} strokeWidth={1.5} /></Pressable>;
}
const styles = StyleSheet.create({
  timeline: { width: '100%', overflow: 'hidden' },
  laneBackground: { position: 'absolute', left: 0, right: 0, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.035)' },
  snapGuide: { position: 'absolute', width: 0, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: snapColor, zIndex: 20 },
  clip: { position: 'absolute', overflow: 'hidden', borderRadius: 7, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.background },
  selected: { borderWidth: 2, borderColor: snapColor },
  audio: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceAlt },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  tick: { position: 'absolute', width: 1, backgroundColor: colors.mutedDim },
  tickLabel: { position: 'absolute', width: 64, left: -32, top: -17, textAlign: 'center', color: colors.mutedDim, fontSize: 9, fontVariant: ['tabular-nums'] },
  playhead: { position: 'absolute', width: 2, backgroundColor: colors.text, zIndex: 4 },
  playheadCap: { position: 'absolute', width: 6, height: 6, borderRadius: 2, left: -2, top: -2, backgroundColor: colors.text },
  handleTouch: { position: 'absolute', width: 44, justifyContent: 'center', zIndex: 5 },
  handle: { width: 8, height: '100%', maxHeight: 72, borderRadius: 3, backgroundColor: snapColor, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 2, height: 18, borderRadius: 1, backgroundColor: '#0B0E11' },
  append: { width: 44, height: 44, borderRadius: 11, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 8 },
  laneControls: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  laneButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scaleControls: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  scaleButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyText: { color: colors.mutedDim, fontSize: 12, flexShrink: 1 },
});
