import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { StudioEditing, StudioRecipeClip, StudioRenderRecipe } from './model';
import { studioCanvasFocalPoint, studioCanvasFrame, studioCanvasHandleCanvasPosition, studioCanvasMove, studioCanvasPinch, studioCanvasResize, studioCanvasScale, studioCanvasSnapCenter, studioCanvasTransformChanged,
  studioVisibleCanvasLayers, type StudioCanvasCorner, type StudioCanvasFrame, type StudioCanvasSnapState, type StudioCanvasTransform } from './canvasGeometry';
import { performStudioSnapFeedback } from './snapFeedback';
import { isStudioInteractiveCompositionAvailable } from '../../../modules/classfy-studio-media';
import type { StudioCanvasTransformChannelRef } from './canvasTransformChannel';

export type { StudioCanvasTransform } from './canvasGeometry';
export type StudioCanvasEditorProps = {
  editing: StudioEditing; recipe: StudioRenderRecipe; positionSeconds: number; selectedLayerId?: string; selectedMainClipId?: string; disabled?: boolean;
  onSelectLayer: (id: string) => void;
  onSelectMainClip?: (id: string) => void; onCanvasPress?: () => void;
  onPreviewRect: (id: string, transform: StudioCanvasTransform | undefined) => void;
  onCommitRect: (id: string, transform: StudioCanvasTransform) => void | Promise<void>;
  onEditText?: (id: string) => void;
  onInteractionStart?: () => void; onInteractionEnd?: () => void;
  canvasTransformChannel?: StudioCanvasTransformChannelRef;
};
const corners: StudioCanvasCorner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];
type CanvasGuides = StudioCanvasSnapState & { owner: string };

/** Only actual visual layers receive touches; the canvas background remains the player's. */
export function StudioCanvasEditor(props: StudioCanvasEditorProps) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const owner = useSharedValue('');
  const guides = useSharedValue<CanvasGuides>({ owner: '', x: false, y: false });
  const frame = studioCanvasFrame(viewport.width, viewport.height, props.recipe.canvas.aspectRatio);
  const layers = useMemo(() => studioVisibleCanvasLayers(props.editing, props.recipe, props.positionSeconds, !!props.onSelectMainClip), [props.editing, props.recipe, props.positionSeconds, !!props.onSelectMainClip]);
  const selected = props.selectedLayerId && props.editing.layers.flatMap(layer => layer.items).find(item => item.id === props.selectedLayerId);
  const selectedMain = props.selectedMainClipId && props.editing.main.find(item => item.id === props.selectedMainClipId);
  const atTime = (id: string) => props.recipe.clips.some(clip => clip.id === id && Math.min(Math.round(props.positionSeconds * props.recipe.timebase), props.recipe.durationTicks - 1) >= clip.startTicks
    && Math.min(Math.round(props.positionSeconds * props.recipe.timebase), props.recipe.durationTicks - 1) < clip.startTicks + clip.durationTicks);
  const outsideTime = selected ? selected.kind !== 'audio' && !atTime(selected.id)
    : !!selectedMain && !!props.onSelectMainClip && !atTime(selectedMain.id);
  const layout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
  };
  return <View pointerEvents="box-none" onLayout={layout} style={StyleSheet.absoluteFill}>
    {frame.width > 0 && frame.height > 0 && <View pointerEvents="box-none" style={[styles.canvas, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]}>
      {[...layers].reverse().map((clip, paintIndex) => <CanvasLayer key={clip.id} {...props} clip={clip} frame={frame} paintIndex={paintIndex}
        selected={(clip.zIndex > 0 ? props.selectedLayerId : props.selectedMainClipId) === clip.id} owner={owner} guides={guides} />)}
      <CanvasCenterGuides guides={guides} />
    </View>}
    {outsideTime && <View pointerEvents="none" style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.noticeText}>{selected ? 'Esta camada' : 'Este vídeo principal'} está fora deste momento do vídeo.</Text></View>}
  </View>;
}

type LayerProps = StudioCanvasEditorProps & { clip: StudioRecipeClip; frame: StudioCanvasFrame; paintIndex: number; selected: boolean; owner: SharedValue<string>; guides: SharedValue<CanvasGuides> };
function CanvasLayer(props: LayerProps) {
  const { clip, frame, selected, disabled, owner, guides } = props;
  const main = clip.zIndex === 0;
  const interactiveChannel = props.canvasTransformChannel && props.editing.output.profile === 'standard' && props.recipe.mediaType === 'video' && isStudioInteractiveCompositionAvailable() ? props.canvasTransformChannel : undefined;
  const live = useRef(props); live.current = props;
  const mounted = useRef(true);
  const transaction = useRef<{ epoch: number; finishing: boolean } | undefined>(undefined);
  const cancelledThrough = useRef(-1);
  const accessibilitySequence = useRef(0), accessibilityRequest = useRef<number | undefined>(undefined);
  const lastSnapFeedback = useRef<{ epoch: number; at: number } | undefined>(undefined);
  const [error, setError] = useState<string>();
  const rect = useSharedValue({ ...clip.rect });
  const font = useSharedValue(clip.text?.fontSize ?? 0);
  const baseline = useSharedValue<StudioCanvasTransform>({ rect: { ...clip.rect }, ...(clip.text ? { textFontSize: clip.text.fontSize } : {}) });
  const panBase = useSharedValue({ ...clip.rect });
  const pinchBase = useSharedValue<StudioCanvasTransform>({ rect: { ...clip.rect }, ...(clip.text ? { textFontSize: clip.text.fontSize } : {}) });
  const pinchFocal = useSharedValue({ x: 0, y: 0 });
  const mask = useSharedValue(0), epoch = useSharedValue(0), pending = useSharedValue(false), cancelled = useSharedValue(false);
  const panOriginX = useSharedValue(0), panOriginY = useSharedValue(0), panLastX = useSharedValue(0), panLastY = useSharedValue(0);
  const cornerOwner = useSharedValue(''), lastPreview = useSharedValue(0), snapRevision = useSharedValue(0);
  const snap = useSharedValue<StudioCanvasSnapState>({ x: false, y: false });
  const configuration = useSharedValue({ selected, disabled: !!disabled, width: frame.width, height: frame.height, rotation: clip.rotationDegrees, suspended: false });
  const panEpoch = useSharedValue(-1), pinchEpoch = useSharedValue(-1), handleEpoch = useSharedValue(-1);
  const alive = useSharedValue(true);
  const interactiveSession = useSharedValue(false);
  const currentTransform = () => {
    'worklet';
    return { rect: { ...rect.value }, ...(font.value > 0 ? { textFontSize: font.value } : {}) };
  };
  const publishInteractive = (phase: 'gesture' | 'committing' | 'idle', completion: 'commit' | 'cancel' | null = null) => {
    'worklet';
    if (!interactiveChannel || !interactiveSession.value) return;
    const previous = interactiveChannel.value;
    const operationId = previous.clipId === clip.id && previous.epoch === epoch.value && previous.operationId
      ? previous.operationId : `${clip.id}:${epoch.value}:${previous.sequence + 1}`;
    interactiveChannel.value = { available: previous.available, active: phase !== 'idle', sequence: previous.sequence + 1,
      operationId, epoch: epoch.value, clipId: clip.id, phase, transform: currentTransform(), finish: completion };
  };
  const clearGuides = () => {
    'worklet';
    snapRevision.value++;
    snap.value = { x: false, y: false };
    if (guides.value.owner === clip.id) guides.value = { owner: '', x: false, y: false };
  };
  const feedbackJS = (value: number, revision: number) => {
    const active = transaction.current;
    if (!mounted.current || !live.current.selected || live.current.disabled || active?.epoch !== value || active.finishing
      || value !== epoch.value || owner.value !== clip.id || pending.value || cancelled.value || !(mask.value & 1)
      || revision !== snapRevision.value || guides.value.owner !== clip.id || !(snap.value.x || snap.value.y)) return;
    // Budget only feedback which is still valid when delivered. A queued
    // acquisition that left/reentered must not suppress the newer request.
    const now = Date.now(), previous = lastSnapFeedback.current;
    if (previous?.epoch === value && now - previous.at < 16) return;
    lastSnapFeedback.current = { epoch: value, at: now };
    performStudioSnapFeedback();
  };
  const movePan = (translationX: number, translationY: number) => {
    'worklet';
    const settings = configuration.value;
    const candidate = studioCanvasMove(panBase.value, translationX - panOriginX.value, translationY - panOriginY.value, settings.width, settings.height);
    const previous = snap.value;
    const next = studioCanvasSnapCenter(candidate, settings.width, settings.height, previous);
    if (next.snap.x !== previous.x || next.snap.y !== previous.y) snapRevision.value++;
    rect.value = next.rect; snap.value = next.snap;
    guides.value = { owner: clip.id, ...next.snap };
    // One acquisition request covers both axes. Coalesce closely spaced UI
    // updates, while steady alignment and leaving a guide remain silent.
    if (next.snap.x && !previous.x || next.snap.y && !previous.y) runOnJS(feedbackJS)(epoch.value, snapRevision.value);
  };
  const synchronize = () => {
    rect.value = { ...live.current.clip.rect }; font.value = live.current.clip.text?.fontSize ?? 0;
  };
  const beginJS = (value: number) => {
    if (!mounted.current || live.current.disabled || !live.current.selected || value <= cancelledThrough.current || value !== epoch.value || transaction.current) return;
    transaction.current = { epoch: value, finishing: false }; setError(undefined);
    live.current.onInteractionStart?.();
  };
  const previewJS = (value: number, transform: StudioCanvasTransform) => {
    if (!mounted.current || transaction.current?.epoch !== value || transaction.current.finishing || value !== epoch.value) return;
    live.current.onPreviewRect(clip.id, transform);
  };
  const endJS = async (value: number, transform: StudioCanvasTransform, save: boolean) => {
    const active = transaction.current;
    if (!mounted.current || active?.epoch !== value || active.finishing || value !== epoch.value) return;
    active.finishing = true;
    let committed = false;
    try { if (save) { await live.current.onCommitRect(clip.id, transform); committed = true; } }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a posição.'); }
    finally {
      if (transaction.current !== active) return;
      transaction.current = undefined;
      live.current.onPreviewRect(clip.id, undefined); live.current.onInteractionEnd?.();
      const nextRect = { ...live.current.clip.rect }, nextFont = live.current.clip.text?.fontSize ?? 0;
      runOnUI(() => {
        'worklet';
        if (owner.value !== clip.id || !pending.value) return;
        publishInteractive('idle', committed ? 'commit' : 'cancel');
        interactiveSession.value = false;
        pending.value = false; owner.value = '';
        if (alive.value && !mask.value) { rect.value = nextRect; font.value = nextFont; }
      })();
    }
  };
  const acknowledgeCancellation = (through: number) => {
    cancelledThrough.current = Math.max(cancelledThrough.current, through);
    const active = transaction.current;
    if (active && active.epoch <= through && !active.finishing) {
      transaction.current = undefined; live.current.onPreviewRect(clip.id, undefined); live.current.onInteractionEnd?.();
    }
  };
  const cancelJS = () => {
    accessibilityRequest.current = undefined;
    acknowledgeCancellation(epoch.value);
    // Reads following a SharedValue write on JS see the previous UI value.
    // Invalidate atomically on UI and acknowledge the actual epoch back on JS.
    const writing = !!transaction.current?.finishing;
    const nextRect = { ...live.current.clip.rect }, nextFont = live.current.clip.text?.fontSize ?? 0;
    runOnUI(() => {
      'worklet';
      const through = epoch.value;
      if (!writing && interactiveChannel?.value.clipId === clip.id) publishInteractive('idle', 'cancel');
      if (!writing) interactiveSession.value = false;
      epoch.value++; mask.value = 0; cancelled.value = true; cornerOwner.value = '';
      clearGuides();
      // A durable write retains its reservation until its promise settles.
      if (!writing) {
        // A cancellation owns only this layer's channel; an unmounted sibling
        // cannot erase the next selected element's live preview.
        pending.value = false; if (owner.value === clip.id) owner.value = '';
        rect.value = nextRect; font.value = nextFont;
      }
      runOnJS(acknowledgeCancellation)(through);
    })();
  };
  useEffect(() => {
    mounted.current = true; alive.value = true;
    const listener = AppState.addEventListener('change', state => {
      runOnUI(() => { 'worklet'; configuration.value = { ...configuration.value, suspended: state !== 'active' }; })();
      if (state !== 'active') cancelJS();
    });
    return () => { mounted.current = false; alive.value = false; listener.remove(); cancelJS(); };
  }, []);
  useEffect(() => {
    runOnUI(() => { 'worklet'; configuration.value = { ...configuration.value, selected, disabled: !!disabled, width: frame.width, height: frame.height, rotation: clip.rotationDegrees }; })();
    if (!selected || disabled) cancelJS();
    else if (!mask.value && !pending.value) synchronize();
  }, [selected, disabled, frame.width, frame.height, clip.rotationDegrees, clip.rect.x, clip.rect.y, clip.rect.width, clip.rect.height, clip.text?.fontSize]);
  const previousFrame = useRef({ width: frame.width, height: frame.height, rotation: clip.rotationDegrees });
  useEffect(() => {
    const previous = previousFrame.current;
    if (previous.width !== frame.width || previous.height !== frame.height || previous.rotation !== clip.rotationDegrees) cancelJS();
    previousFrame.current = { width: frame.width, height: frame.height, rotation: clip.rotationDegrees };
  }, [frame.width, frame.height, clip.rotationDegrees]);

  const begin = (bit: number) => {
    'worklet';
    const settings = configuration.value;
    if (!alive.value || !settings.selected || settings.disabled || settings.suspended || pending.value || owner.value && owner.value !== clip.id) return false;
    // The body cannot join a corner transaction, and no corner can join pan/pinch.
    if (bit === 4 ? mask.value !== 0 : !!(mask.value & 4)) return false;
    if (!mask.value) {
      owner.value = clip.id; epoch.value++; cancelled.value = false; lastPreview.value = 0;
      clearGuides();
      baseline.value = currentTransform(); runOnJS(beginJS)(epoch.value);
      interactiveSession.value = interactiveChannel?.value.available === true;
      publishInteractive('gesture');
    }
    if (bit === 2) clearGuides();
    mask.value |= bit;
    return true;
  };
  const publish = () => {
    'worklet';
    if (cancelled.value) return;
    if (interactiveSession.value && interactiveChannel?.value.available !== true) interactiveSession.value = false;
    if (interactiveSession.value) { publishInteractive('gesture'); return; }
    const now = Date.now();
    if (now - lastPreview.value >= 33) { lastPreview.value = now; runOnJS(previewJS)(epoch.value, currentTransform()); }
  };
  const finish = (bit: number, success: boolean, operation: number) => {
    'worklet';
    if (operation !== epoch.value || !(mask.value & bit)) return;
    mask.value &= ~bit;
    if (bit === 1 || !success) clearGuides();
    if (!success) cancelled.value = true;
    if (bit === 2 && mask.value & 1) {
      panBase.value = { ...rect.value }; panOriginX.value = panLastX.value; panOriginY.value = panLastY.value;
    }
    if (mask.value) return;
    const transform = currentTransform();
    const save = !cancelled.value && studioCanvasTransformChanged(baseline.value, transform);
    if (!save) { rect.value = { ...baseline.value.rect }; font.value = baseline.value.textFontSize ?? 0; }
    pending.value = true;
    publishInteractive(save ? 'committing' : 'idle', save ? null : 'cancel');
    runOnJS(endJS)(epoch.value, transform, save);
  };
  const selectJS = () => {
    if (!mounted.current || live.current.disabled || owner.value) return;
    if (main) live.current.onSelectMainClip?.(clip.id); else live.current.onSelectLayer(clip.id);
  };
  const tapJS = () => {
    selectJS();
  };
  const editTextJS = () => {
    if (!mounted.current || live.current.disabled || owner.value) return;
    if (live.current.onEditText) live.current.onEditText(clip.id); else selectJS();
  };
  const gestures = useMemo(() => {
    // Keep native recognizers and their relationships stable throughout a touch.
    // Gating on touch-down prevents a tap which selects a layer from activating
    // a newly enabled pan while that same touch is ending.
    // Selection already reserves the body for editing. A long-press qualifier
    // would fail an ordinary drag before its delay on iOS, unlike the layers.
    const pan = Gesture.Pan().minDistance(4).averageTouches(true).shouldCancelWhenOutside(false);
    pan.onTouchesDown((_, manager) => {
      'worklet';
      const settings = configuration.value;
      if (!alive.value || !settings.selected || settings.disabled || settings.suspended || pending.value || mask.value & 4 || owner.value && owner.value !== clip.id) manager.fail();
    })
      .onStart(() => {
        'worklet';
        if (!begin(1)) return;
        panEpoch.value = epoch.value;
        panBase.value = { ...rect.value }; panOriginX.value = 0; panOriginY.value = 0; panLastX.value = 0; panLastY.value = 0;
      }).onUpdate(event => {
        'worklet';
        if (panEpoch.value !== epoch.value || !(mask.value & 1) || cancelled.value) return;
        panLastX.value = event.translationX; panLastY.value = event.translationY;
        if (mask.value & 2) return;
        movePan(event.translationX, event.translationY); publish();
      }).onEnd((event, success) => {
        'worklet';
        if (panEpoch.value !== epoch.value || !(mask.value & 1)) return;
        if (success !== false && !cancelled.value) {
          panLastX.value = event.translationX; panLastY.value = event.translationY;
          if (!(mask.value & 2)) movePan(event.translationX, event.translationY);
        }
        finish(1, success !== false, panEpoch.value);
      }).onFinalize((_, success) => {
        'worklet';
        finish(1, success, panEpoch.value);
      }).onTouchesCancelled(() => {
        'worklet';
        finish(1, false, panEpoch.value);
      });
    const pinch = Gesture.Pinch().onTouchesDown((_, manager) => {
      'worklet';
      const settings = configuration.value;
      if (!alive.value || !settings.selected || settings.disabled || settings.suspended || pending.value || mask.value & 4 || owner.value && owner.value !== clip.id) manager.fail();
    }).onStart(event => {
      'worklet';
      if (begin(2)) {
        pinchEpoch.value = epoch.value;
        pinchBase.value = currentTransform();
        const settings = configuration.value;
        pinchFocal.value = studioCanvasFocalPoint(pinchBase.value.rect, event?.focalX, event?.focalY, settings.width, settings.height, settings.rotation);
      }
    }).onUpdate(event => {
      'worklet';
      if (pinchEpoch.value !== epoch.value || !(mask.value & 2) || cancelled.value) return;
      const settings = configuration.value;
      const next = studioCanvasPinch(pinchBase.value, event.scale, settings.width, settings.height, pinchFocal.value, main ? 0.1 : 0.025);
      rect.value = next.rect; font.value = next.textFontSize ?? 0; publish();
    }).onEnd((event, success) => {
      'worklet';
      if (pinchEpoch.value !== epoch.value || !(mask.value & 2)) return;
      if (success !== false && !cancelled.value) {
        const settings = configuration.value;
        const next = studioCanvasPinch(pinchBase.value, event.scale, settings.width, settings.height, pinchFocal.value, main ? 0.1 : 0.025);
        rect.value = next.rect; font.value = next.textFontSize ?? 0;
      }
      finish(2, success !== false, pinchEpoch.value);
    }).onFinalize((_, success) => {
      'worklet';
      finish(2, success, pinchEpoch.value);
    }).onTouchesCancelled(() => {
      'worklet';
      finish(2, false, pinchEpoch.value);
    });
    const tap = Gesture.Tap().maxDuration(250).onEnd((_, success) => {
      'worklet';
      if (success && alive.value && !configuration.value.suspended) runOnJS(tapJS)();
    });
    const doubleTap = Gesture.Tap().numberOfTaps(2).maxDelay(240).onEnd((_, success) => {
      'worklet';
      if (success && alive.value && !configuration.value.suspended) runOnJS(editTextJS)();
    });
    const handles = corners.map(corner => Gesture.Pan().minDistance(1).maxPointers(1).shouldCancelWhenOutside(false)
      .onTouchesDown((_, manager) => {
        'worklet';
        const settings = configuration.value;
        if (!alive.value || !settings.selected || settings.disabled || settings.suspended || pending.value || mask.value || owner.value && owner.value !== clip.id) manager.fail();
      }).onStart(() => {
        'worklet';
        if (mask.value || !begin(4)) return;
        cornerOwner.value = corner; handleEpoch.value = epoch.value;
      }).onUpdate(event => {
        'worklet';
        if (handleEpoch.value !== epoch.value || !(mask.value & 4) || cornerOwner.value !== corner || cancelled.value) return;
        const settings = configuration.value;
        const next = studioCanvasResize(baseline.value, corner, event.translationX, event.translationY, settings.width, settings.height, settings.rotation, main ? 0.1 : 0.025);
        rect.value = next.rect; font.value = next.textFontSize ?? 0; publish();
      }).onEnd((event, success) => {
        'worklet';
        if (handleEpoch.value !== epoch.value || !(mask.value & 4) || cornerOwner.value !== corner) return;
        if (success !== false && !cancelled.value) {
          const settings = configuration.value;
          const next = studioCanvasResize(baseline.value, corner, event.translationX, event.translationY, settings.width, settings.height, settings.rotation, main ? 0.1 : 0.025);
          rect.value = next.rect; font.value = next.textFontSize ?? 0;
        }
        cornerOwner.value = ''; finish(4, success !== false, handleEpoch.value);
      }).onFinalize((_, success) => {
        'worklet';
        if (cornerOwner.value === corner) { cornerOwner.value = ''; finish(4, success, handleEpoch.value); }
      }).onTouchesCancelled(() => {
        'worklet';
        if (cornerOwner.value === corner) { cornerOwner.value = ''; finish(4, false, handleEpoch.value); }
      }));
    return { body: Gesture.Race(Gesture.Simultaneous(pan, pinch), Gesture.Exclusive(doubleTap, tap)), handles };
  }, [clip.id, main, interactiveChannel]);
  const geometry = useAnimatedStyle(() => ({ left: rect.value.x * frame.width, top: rect.value.y * frame.height,
    width: rect.value.width * frame.width, height: rect.value.height * frame.height, transform: [{ rotate: `${clip.rotationDegrees}deg` }] }));
  const title = clip.kind === 'text' || clip.kind === 'caption' ? clip.text?.content || 'Texto' : clip.kind === 'image' ? 'Imagem' : 'Vídeo';
  const releaseAccessibility = (request: number, value?: number) => {
    if (accessibilityRequest.current === request) accessibilityRequest.current = undefined;
    if (value === undefined) return;
    runOnUI(() => {
      'worklet';
      if (epoch.value === value && pending.value && !mask.value && owner.value === clip.id) { pending.value = false; owner.value = ''; }
    })();
  };
  const applyAccessibility = async (request: number, value: number, original: StudioCanvasTransform, next: StudioCanvasTransform) => {
    try {
      if (accessibilityRequest.current !== request || !mounted.current || live.current.disabled || !live.current.selected) return;
      beginJS(value);
      if (transaction.current?.epoch !== value) return;
      previewJS(value, next);
      await endJS(value, next, studioCanvasTransformChanged(original, next));
    } finally { releaseAccessibility(request, value); }
  };
  const accessibility = (event: AccessibilityActionEvent) => {
    if (disabled || accessibilityRequest.current !== undefined || transaction.current || owner.value) return;
    if (event.nativeEvent.actionName === 'activate') { selectJS(); return; }
    if (!selected) return;
    const action = event.nativeEvent.actionName;
    const request = ++accessibilitySequence.current; accessibilityRequest.current = request;
    runOnUI(() => {
      'worklet';
      const settings = configuration.value;
      if (!alive.value || settings.disabled || !settings.selected || settings.suspended || pending.value || mask.value || owner.value) {
        runOnJS(releaseAccessibility)(request); return;
      }
      const original = currentTransform();
      const next = action === 'increment' || action === 'decrement'
        ? studioCanvasScale(original, action === 'increment' ? 1.1 : 1 / 1.1, settings.width, settings.height, undefined, 0, main ? 0.1 : 0.025)
        : { ...original, rect: studioCanvasMove(original.rect, action === 'moveLeft' ? -settings.width * 0.025 : action === 'moveRight' ? settings.width * 0.025 : 0,
          action === 'moveUp' ? -settings.height * 0.025 : action === 'moveDown' ? settings.height * 0.025 : 0, settings.width, settings.height) };
      owner.value = clip.id; pending.value = true; epoch.value++; cancelled.value = false;
      rect.value = next.rect; font.value = next.textFontSize ?? 0;
      runOnJS(applyAccessibility)(request, epoch.value, original, next);
    })();
  };
  return <><GestureDetector gesture={gestures.body}><Animated.View pointerEvents={disabled ? 'none' : 'auto'} accessible={!disabled} accessibilityRole="button"
    accessibilityLabel={`${selected ? 'Mover ou redimensionar' : 'Selecionar'} ${title}`} accessibilityState={{ selected, disabled: !!disabled }}
    accessibilityHint={selected ? 'Arraste para mover, use dois dedos ou um canto para aumentar e diminuir.' : 'Toque para editar esta camada.'}
    accessibilityActions={[{ name: 'activate', label: 'Selecionar camada' }, ...(selected ? [
      { name: 'increment', label: 'Aumentar' }, { name: 'decrement', label: 'Diminuir' },
      { name: 'moveLeft', label: 'Mover para esquerda' }, { name: 'moveRight', label: 'Mover para direita' },
      { name: 'moveUp', label: 'Mover para cima' }, { name: 'moveDown', label: 'Mover para baixo' }] : [])]}
    onAccessibilityAction={event => { void accessibility(event); }}
    style={[styles.layer, { zIndex: props.paintIndex + 1 }, geometry]}>
    {selected && <View pointerEvents="none" style={styles.outline} />}
    {selected && error && <View pointerEvents="none" style={styles.error}><Text style={styles.errorText}>{error}</Text></View>}
  </Animated.View></GestureDetector>
    {corners.map((corner, index) => <CanvasCornerHandle key={corner} gesture={gestures.handles[index]} corner={corner}
      selected={selected} disabled={!!disabled} rect={rect} frame={frame} rotationDegrees={clip.rotationDegrees} />)}
  </>;
}
function CanvasCenterGuides({ guides }: { guides: SharedValue<CanvasGuides> }) {
  const vertical = useAnimatedStyle(() => ({ opacity: guides.value.x ? 0.9 : 0 }));
  const horizontal = useAnimatedStyle(() => ({ opacity: guides.value.y ? 0.9 : 0 }));
  return <View pointerEvents="none" accessible={false} style={[StyleSheet.absoluteFill, styles.guides]}>
    <Animated.View style={[styles.guideVertical, vertical]} />
    <Animated.View style={[styles.guideHorizontal, horizontal]} />
  </View>;
}
function CanvasCornerHandle({ gesture, corner, rect, frame, rotationDegrees, selected, disabled }: {
  gesture: ReturnType<typeof Gesture.Pan>; corner: StudioCanvasCorner; rect: SharedValue<StudioCanvasTransform['rect']>;
  frame: StudioCanvasFrame; rotationDegrees: number; selected: boolean; disabled: boolean;
}) {
  const position = useAnimatedStyle(() => {
    const point = studioCanvasHandleCanvasPosition(rect.value, corner, frame.width, frame.height, rotationDegrees);
    return { left: point.x - 16, top: point.y - 16 };
  });
  return <GestureDetector gesture={gesture}><Animated.View accessible={false} pointerEvents={selected && !disabled ? 'auto' : 'none'} style={[styles.handleTarget, { opacity: selected ? 1 : 0 }, position]}>
    <View pointerEvents="none" style={styles.handle} />
  </Animated.View></GestureDetector>;
}
const styles = StyleSheet.create({
  canvas: { position: 'absolute', overflow: 'hidden' },
  layer: { position: 'absolute', backgroundColor: 'transparent' },
  outline: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: '#FFDB00', borderRadius: 1 },
  handleTarget: { position: 'absolute', zIndex: 1000, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF9E8', borderWidth: 1, borderColor: '#FFDB00' },
  guides: { zIndex: 1001 },
  guideVertical: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, transform: [{ translateX: -0.5 }], backgroundColor: '#4AA3FF' },
  guideHorizontal: { position: 'absolute', top: '50%', left: 0, right: 0, height: 1, transform: [{ translateY: -0.5 }], backgroundColor: '#4AA3FF' },
  notice: { position: 'absolute', left: 16, right: 16, bottom: 10, alignItems: 'center' },
  noticeText: { color: '#E0E3E8', fontSize: 11, backgroundColor: '#111820DB', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  error: { position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 8, backgroundColor: '#111820E8', padding: 5, borderRadius: 4 },
  errorText: { color: '#FF899E', fontSize: 10, textAlign: 'center' },
});
