import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import type { StudioEditing, StudioRecipeClip, StudioRenderRecipe } from './model';
import { studioCanvasFrame, studioCanvasMove, studioCanvasResize, studioCanvasScale, studioCanvasTransformChanged,
  studioVisibleCanvasLayers, type StudioCanvasCorner, type StudioCanvasFrame, type StudioCanvasTransform } from './canvasGeometry';

export type { StudioCanvasTransform } from './canvasGeometry';
export type StudioCanvasEditorProps = {
  editing: StudioEditing; recipe: StudioRenderRecipe; positionSeconds: number; selectedLayerId?: string; selectedMainClipId?: string; disabled?: boolean;
  onSelectLayer: (id: string) => void;
  onSelectMainClip?: (id: string) => void; onCanvasPress?: () => void;
  onPreviewRect: (id: string, transform: StudioCanvasTransform | undefined) => void;
  onCommitRect: (id: string, transform: StudioCanvasTransform) => void | Promise<void>;
  onEditText?: (id: string) => void;
  onInteractionStart?: () => void; onInteractionEnd?: () => void;
};
const corners: StudioCanvasCorner[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

/** Only actual visual layers receive touches; the canvas background remains the player's. */
export function StudioCanvasEditor(props: StudioCanvasEditorProps) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const owner = useSharedValue('');
  const frame = studioCanvasFrame(viewport.width, viewport.height, props.recipe.canvas.aspectRatio);
  const layers = useMemo(() => studioVisibleCanvasLayers(props.editing, props.recipe, props.positionSeconds, !!props.onSelectMainClip), [props.editing, props.recipe, props.positionSeconds, !!props.onSelectMainClip]);
  const selected = props.selectedLayerId && props.editing.layers.flatMap(layer => layer.items).find(item => item.id === props.selectedLayerId);
  const selectedMain = props.selectedMainClipId && props.editing.main.find(item => item.id === props.selectedMainClipId);
  const outsideTime = selected ? selected.kind !== 'audio' && !layers.some(clip => clip.id === selected.id)
    : !!selectedMain && !!props.onSelectMainClip && !layers.some(clip => clip.id === selectedMain.id);
  const layout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
  };
  return <View pointerEvents="box-none" onLayout={layout} style={StyleSheet.absoluteFill}>
    {frame.width > 0 && frame.height > 0 && <View pointerEvents="box-none" style={[styles.canvas, { left: frame.x, top: frame.y, width: frame.width, height: frame.height }]}>
      {[...layers].reverse().map((clip, paintIndex) => <CanvasLayer key={clip.id} {...props} clip={clip} frame={frame} paintIndex={paintIndex}
        selected={(clip.zIndex > 0 ? props.selectedLayerId : props.selectedMainClipId) === clip.id} owner={owner} />)}
    </View>}
    {outsideTime && <View pointerEvents="none" style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.noticeText}>{selected ? 'Esta camada' : 'Este vídeo principal'} está fora deste momento do vídeo.</Text></View>}
  </View>;
}

type LayerProps = StudioCanvasEditorProps & { clip: StudioRecipeClip; frame: StudioCanvasFrame; paintIndex: number; selected: boolean; owner: SharedValue<string> };
function CanvasLayer(props: LayerProps) {
  const { clip, frame, selected, disabled, owner } = props;
  const main = clip.zIndex === 0;
  const live = useRef(props); live.current = props;
  const mounted = useRef(true);
  const transaction = useRef<{ epoch: number; finishing: boolean } | undefined>(undefined);
  const [error, setError] = useState<string>();
  const rect = useSharedValue({ ...clip.rect });
  const font = useSharedValue(clip.text?.fontSize ?? 0);
  const baseline = useSharedValue<StudioCanvasTransform>({ rect: { ...clip.rect }, ...(clip.text ? { textFontSize: clip.text.fontSize } : {}) });
  const panBase = useSharedValue({ ...clip.rect });
  const pinchBase = useSharedValue<StudioCanvasTransform>(baseline.value);
  const mask = useSharedValue(0), epoch = useSharedValue(0), pending = useSharedValue(false), cancelled = useSharedValue(false);
  const panOriginX = useSharedValue(0), panOriginY = useSharedValue(0), panLastX = useSharedValue(0), panLastY = useSharedValue(0);
  const cornerOwner = useSharedValue(''), lastPreview = useSharedValue(0);
  const currentTransform = () => {
    'worklet';
    return { rect: { ...rect.value }, ...(font.value > 0 ? { textFontSize: font.value } : {}) };
  };
  const synchronize = () => {
    rect.value = { ...live.current.clip.rect }; font.value = live.current.clip.text?.fontSize ?? 0;
  };
  const beginJS = (value: number) => {
    if (!mounted.current || value !== epoch.value || transaction.current) return;
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
    try { if (save) await live.current.onCommitRect(clip.id, transform); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Não foi possível salvar a posição.'); }
    finally {
      if (transaction.current !== active) return;
      transaction.current = undefined;
      live.current.onPreviewRect(clip.id, undefined); live.current.onInteractionEnd?.();
      pending.value = false; if (owner.value === clip.id) owner.value = '';
      if (mounted.current) synchronize();
    }
  };
  const cancelJS = () => {
    epoch.value++; mask.value = 0; cancelled.value = true; cornerOwner.value = '';
    const active = transaction.current;
    // A started disk write owns the interaction until it resolves.
    if (active?.finishing) return;
    if (active) { transaction.current = undefined; live.current.onPreviewRect(clip.id, undefined); live.current.onInteractionEnd?.(); }
    pending.value = false; if (owner.value === clip.id) owner.value = '';
    synchronize();
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelJS(); };
  }, []);
  useEffect(() => {
    if (!selected || disabled) cancelJS();
    else if (!mask.value && !pending.value) synchronize();
  }, [selected, disabled, clip.rect.x, clip.rect.y, clip.rect.width, clip.rect.height, clip.text?.fontSize]);
  const previousFrame = useRef({ width: frame.width, height: frame.height, rotation: clip.rotationDegrees });
  useEffect(() => {
    const previous = previousFrame.current;
    if (previous.width !== frame.width || previous.height !== frame.height || previous.rotation !== clip.rotationDegrees) cancelJS();
    previousFrame.current = { width: frame.width, height: frame.height, rotation: clip.rotationDegrees };
  }, [frame.width, frame.height, clip.rotationDegrees]);

  const begin = (bit: number) => {
    'worklet';
    if (pending.value || owner.value && owner.value !== clip.id) return false;
    if (!mask.value) {
      owner.value = clip.id; epoch.value++; cancelled.value = false; lastPreview.value = 0;
      baseline.value = currentTransform(); runOnJS(beginJS)(epoch.value);
    }
    mask.value |= bit;
    return true;
  };
  const publish = () => {
    'worklet';
    if (cancelled.value) return;
    const now = Date.now();
    if (now - lastPreview.value >= 33) { lastPreview.value = now; runOnJS(previewJS)(epoch.value, currentTransform()); }
  };
  const finish = (bit: number, success: boolean) => {
    'worklet';
    if (!(mask.value & bit)) return;
    mask.value &= ~bit;
    if (!success) cancelled.value = true;
    if (bit === 2 && mask.value & 1) {
      panBase.value = { ...rect.value }; panOriginX.value = panLastX.value; panOriginY.value = panLastY.value;
    }
    if (mask.value) return;
    const transform = currentTransform();
    const save = !cancelled.value && studioCanvasTransformChanged(baseline.value, transform);
    if (!save) { rect.value = { ...baseline.value.rect }; font.value = baseline.value.textFontSize ?? 0; }
    pending.value = true;
    runOnJS(endJS)(epoch.value, transform, save);
  };
  const selectJS = () => {
    if (!mounted.current || live.current.disabled || owner.value) return;
    if (main) live.current.onSelectMainClip?.(clip.id); else live.current.onSelectLayer(clip.id);
  };
  const tapJS = () => {
    if (main && live.current.selected && live.current.onCanvasPress && !owner.value && !live.current.disabled) live.current.onCanvasPress();
    else selectJS();
  };
  const editTextJS = () => {
    if (!mounted.current || live.current.disabled || owner.value) return;
    if (live.current.onEditText) live.current.onEditText(clip.id); else selectJS();
  };
  const gestures = useMemo(() => {
    const pan = Gesture.Pan().enabled(selected && !disabled).minDistance(4).averageTouches(true).activateAfterLongPress(main ? 150 : 0)
      .onStart(() => {
        if (!begin(1)) return;
        panBase.value = { ...rect.value }; panOriginX.value = 0; panOriginY.value = 0; panLastX.value = 0; panLastY.value = 0;
      }).onUpdate(event => {
        if (!(mask.value & 1) || cancelled.value) return;
        panLastX.value = event.translationX; panLastY.value = event.translationY;
        if (mask.value & 2) return;
        rect.value = studioCanvasMove(panBase.value, event.translationX - panOriginX.value, event.translationY - panOriginY.value, frame.width, frame.height); publish();
      }).onEnd(event => {
        if (!(mask.value & 1) || cancelled.value) return;
        panLastX.value = event.translationX; panLastY.value = event.translationY;
        if (!(mask.value & 2)) rect.value = studioCanvasMove(panBase.value, event.translationX - panOriginX.value, event.translationY - panOriginY.value, frame.width, frame.height);
      }).onFinalize((_, success) => finish(1, success));
    const pinch = Gesture.Pinch().enabled(selected && !disabled).onStart(() => {
      if (begin(2)) pinchBase.value = currentTransform();
    }).onUpdate(event => {
      if (!(mask.value & 2) || cancelled.value) return;
      const next = studioCanvasScale(pinchBase.value, event.scale, frame.width, frame.height, undefined, 0, main ? 0.1 : 0.025);
      rect.value = next.rect; font.value = next.textFontSize ?? 0; publish();
    }).onEnd(event => {
      if (!(mask.value & 2) || cancelled.value) return;
      const next = studioCanvasScale(pinchBase.value, event.scale, frame.width, frame.height, undefined, 0, main ? 0.1 : 0.025);
      rect.value = next.rect; font.value = next.textFontSize ?? 0;
    }).onFinalize((_, success) => finish(2, success));
    const tap = Gesture.Tap().enabled(!disabled).maxDuration(250).onEnd((_, success) => { if (success) runOnJS(tapJS)(); });
    const doubleTap = Gesture.Tap().enabled(!disabled && !!props.onEditText).numberOfTaps(2).maxDelay(240)
      .onEnd((_, success) => { if (success) runOnJS(editTextJS)(); });
    const handles = corners.map(corner => Gesture.Pan().enabled(selected && !disabled).minDistance(0).maxPointers(1)
      .blocksExternalGesture(pan, pinch, tap, doubleTap)
      .onStart(() => {
        if (mask.value || !begin(4)) return;
        cornerOwner.value = corner;
      }).onUpdate(event => {
        if (!(mask.value & 4) || cornerOwner.value !== corner || cancelled.value) return;
        const next = studioCanvasResize(baseline.value, corner, event.translationX, event.translationY, frame.width, frame.height, clip.rotationDegrees, main ? 0.1 : 0.025);
        rect.value = next.rect; font.value = next.textFontSize ?? 0; publish();
      }).onEnd(event => {
        if (!(mask.value & 4) || cornerOwner.value !== corner || cancelled.value) return;
        const next = studioCanvasResize(baseline.value, corner, event.translationX, event.translationY, frame.width, frame.height, clip.rotationDegrees, main ? 0.1 : 0.025);
        rect.value = next.rect; font.value = next.textFontSize ?? 0;
      }).onFinalize((_, success) => { if (cornerOwner.value === corner) { cornerOwner.value = ''; finish(4, success); } }));
    return { body: Gesture.Race(Gesture.Simultaneous(pan, pinch), main ? Gesture.Exclusive(doubleTap, tap) : Gesture.Simultaneous(tap, doubleTap)), handles };
  }, [clip.id, clip.kind, clip.rotationDegrees, selected, disabled, frame.width, frame.height, !!props.onEditText]);
  const geometry = useAnimatedStyle(() => ({ left: rect.value.x * frame.width, top: rect.value.y * frame.height,
    width: rect.value.width * frame.width, height: rect.value.height * frame.height, transform: [{ rotate: `${clip.rotationDegrees}deg` }] }));
  const title = clip.kind === 'text' || clip.kind === 'caption' ? clip.text?.content || 'Texto' : clip.kind === 'image' ? 'Imagem' : 'Vídeo';
  const accessibility = async (event: AccessibilityActionEvent) => {
    if (disabled || owner.value) return;
    if (event.nativeEvent.actionName === 'activate') { selectJS(); return; }
    if (!selected) return;
    const original: StudioCanvasTransform = { rect: { ...live.current.clip.rect }, ...(live.current.clip.text ? { textFontSize: live.current.clip.text.fontSize } : {}) };
    const action = event.nativeEvent.actionName;
    const next = action === 'increment' || action === 'decrement' ? studioCanvasScale(original, action === 'increment' ? 1.1 : 1 / 1.1, frame.width, frame.height, undefined, 0, main ? 0.1 : 0.025)
      : { ...original, rect: studioCanvasMove(original.rect, action === 'moveLeft' ? -frame.width * 0.025 : action === 'moveRight' ? frame.width * 0.025 : 0,
        action === 'moveUp' ? -frame.height * 0.025 : action === 'moveDown' ? frame.height * 0.025 : 0, frame.width, frame.height) };
    owner.value = clip.id; pending.value = true; epoch.value++; beginJS(epoch.value);
    rect.value = next.rect; font.value = next.textFontSize ?? 0; previewJS(epoch.value, next);
    await endJS(epoch.value, next, studioCanvasTransformChanged(original, next));
  };
  return <GestureDetector gesture={gestures.body}><Animated.View pointerEvents={disabled ? 'none' : 'auto'} accessible={!disabled} accessibilityRole="button"
    accessibilityLabel={`${selected ? 'Mover ou redimensionar' : 'Selecionar'} ${title}`} accessibilityState={{ selected, disabled: !!disabled }}
    accessibilityHint={selected ? 'Arraste para mover, use dois dedos ou um canto para aumentar e diminuir.' : 'Toque para editar esta camada.'}
    accessibilityActions={[{ name: 'activate', label: 'Selecionar camada' }, ...(selected ? [
      { name: 'increment', label: 'Aumentar' }, { name: 'decrement', label: 'Diminuir' },
      { name: 'moveLeft', label: 'Mover para esquerda' }, { name: 'moveRight', label: 'Mover para direita' },
      { name: 'moveUp', label: 'Mover para cima' }, { name: 'moveDown', label: 'Mover para baixo' }] : [])]}
    onAccessibilityAction={event => { void accessibility(event); }}
    style={[styles.layer, { zIndex: props.paintIndex + 1 }, geometry]}>
    {selected && <View pointerEvents="none" style={styles.outline} />}
    {selected && corners.map((corner, index) => <GestureDetector key={corner} gesture={gestures.handles[index]}><View accessible={false}
      style={[styles.handleTarget, { left: corner === 'topLeft' || corner === 'bottomLeft' ? -16 : undefined,
        right: corner === 'topRight' || corner === 'bottomRight' ? -16 : undefined,
        top: corner === 'topLeft' || corner === 'topRight' ? -16 : undefined,
        bottom: corner === 'bottomLeft' || corner === 'bottomRight' ? -16 : undefined }]}><View pointerEvents="none" style={styles.handle} /></View></GestureDetector>)}
    {selected && error && <View pointerEvents="none" style={styles.error}><Text style={styles.errorText}>{error}</Text></View>}
  </Animated.View></GestureDetector>;
}
const styles = StyleSheet.create({
  canvas: { position: 'absolute', overflow: 'hidden' },
  layer: { position: 'absolute', backgroundColor: 'transparent' },
  outline: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5, borderColor: '#FFFFFF', borderRadius: 1,
    shadowColor: '#000', shadowRadius: 1, shadowOpacity: 0.8, shadowOffset: { width: 0, height: 0 } },
  handleTarget: { position: 'absolute', width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 10, height: 10, borderRadius: 2, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#232A32' },
  notice: { position: 'absolute', left: 16, right: 16, bottom: 10, alignItems: 'center' },
  noticeText: { color: '#E0E3E8', fontSize: 11, backgroundColor: '#111820DB', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  error: { position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 8, backgroundColor: '#111820E8', padding: 5, borderRadius: 4 },
  errorText: { color: '#FF899E', fontSize: 10, textAlign: 'center' },
});
