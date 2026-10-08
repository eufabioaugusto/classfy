import { useEffect, useRef, useState, type RefObject } from 'react';
import { findNodeHandle } from 'react-native';
import type { CameraView, CameraType } from 'expo-camera';
import {
  getStudioCameraCapabilitiesAsync, configureStudioCameraAsync,
  isStudioCameraControlsAvailable, setStudioCameraZoomAsync,
  setStudioCameraExposureAsync, setStudioCameraFocusAsync,
  type StudioCameraState, type StudioCameraFPS,
} from '../../../modules/classfy-studio-media';

type Quality = '720p' | '1080p' | '2160p';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function studioZoomFactor(normalized: number, state: Pick<StudioCameraState, 'minZoom' | 'maxZoom'>) {
  const min = Math.max(0.01, state.minZoom);
  const max = Math.max(min, state.maxZoom);
  return min * Math.pow(max / min, clamp(normalized, 0, 1));
}
export function studioNormalizedZoom(factor: number, state: Pick<StudioCameraState, 'minZoom' | 'maxZoom'>) {
  const min = Math.max(0.01, state.minZoom);
  const max = Math.max(min, state.maxZoom);
  return max === min ? 0 : clamp(Math.log(Math.max(min, factor) / min) / Math.log(max / min), 0, 1);
}

// Every control operates the exact mounted Expo Camera view. Serialize hardware
// changes and coalesce gesture targets, so a fast wheel never builds a backlog.
// A response from a disposed/front camera cannot replace the new back state.
export function useStudioCaptureCamera(camera: RefObject<CameraView | null>, facing: CameraType, enabled: boolean) {
  const available = isStudioCameraControlsAvailable();
  const [state, setState] = useState<StudioCameraState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<StudioCameraState | null>(null);
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const mounted = useRef(true);
  const generation = useRef(0);
  const tag = useRef<number | null>(null);
  const busyRef = useRef(false);
  const serial = useRef<Promise<unknown>>(Promise.resolve());
  const pendingZoom = useRef<number | null>(null);
  const pendingExposure = useRef<number | null>(null);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomSequence = useRef(0);
  const exposurePump = useRef(false);

  useEffect(() => {
    generation.current++; tag.current = null; stateRef.current = null;
    pendingZoom.current = null; pendingExposure.current = null;
    zoomSequence.current++; if (zoomTimer.current) clearTimeout(zoomTimer.current); zoomTimer.current = null;
    busyRef.current = false; setBusy(false); setState(null); setError(null);
  }, [enabled, facing]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; generation.current++;
    pendingZoom.current = null; pendingExposure.current = null;
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
  }; }, []);

  function current(token: number, targetTag: number | null) {
    return mounted.current && enabledRef.current && generation.current === token && tag.current === targetTag;
  }
  function apply(next: StudioCameraState, token: number, targetTag: number) {
    if (!current(token, targetTag)) return;
    stateRef.current = next; setState(next); setError(null);
  }
  function fail(cause: unknown, token: number, targetTag: number | null) {
    if (!current(token, targetTag)) return;
    setError(cause instanceof Error ? cause.message : 'Não foi possível ajustar a câmera. Tente novamente.');
  }
  function enqueue<T>(token: number, targetTag: number, work: () => Promise<T>) {
    const operation = serial.current.catch(() => undefined).then(async () => {
      if (!current(token, targetTag)) return undefined;
      return work();
    });
    serial.current = operation;
    return operation;
  }
  async function initialize(): Promise<boolean | undefined> {
    if (!enabledRef.current) return undefined;
    if (!available) return true;
    const token = generation.current;
    const targetTag = findNodeHandle(camera.current);
    tag.current = targetTag; busyRef.current = true; setBusy(true); setError(null);
    try {
      if (!targetTag) throw new Error('A câmera ainda está preparando os controles. Abra a captura novamente.');
      const result = await enqueue(token, targetTag, () => getStudioCameraCapabilitiesAsync(targetTag));
      if (!current(token, targetTag) || !result) return undefined;
      const preferred = result.qualities.find(item => item.quality === result.quality)
        || result.qualities.find(item => item.quality === '1080p') || result.qualities[0];
      if (!preferred?.fps.length) throw new Error('Esta câmera não oferece um formato de vídeo compatível. Tente a outra câmera.');
      const initialFPS = preferred.fps.includes(30) ? 30 : preferred.fps[0];
      const configured = await enqueue(token, targetTag, () => configureStudioCameraAsync(targetTag, { quality: preferred.quality, fps: initialFPS }));
      if (!configured || !current(token, targetTag)) return undefined;
      apply(configured, token, targetTag);
      return true;
    } catch (cause) { fail(cause, token, targetTag); return false; }
    finally { if (current(token, targetTag)) { busyRef.current = false; setBusy(false); } }
  }
  async function configure(quality: Quality, fps?: number) {
    const targetTag = tag.current; const token = generation.current; const snapshot = stateRef.current;
    if (!available || !targetTag || !snapshot || busyRef.current) return;
    const supported = snapshot.qualities.find(item => item.quality === quality);
    if (!supported) return;
    const wanted = fps ?? snapshot.fps ?? 30;
    const selectedFps = supported.fps.includes(wanted as StudioCameraFPS) ? wanted as StudioCameraFPS : supported.fps.includes(30) ? 30 : supported.fps[0];
    if (!selectedFps) return;
    busyRef.current = true; setBusy(true); setError(null);
    zoomSequence.current++; pendingZoom.current = null;
    if (zoomTimer.current) clearTimeout(zoomTimer.current); zoomTimer.current = null;
    try {
      const next = await enqueue(token, targetTag, () => configureStudioCameraAsync(targetTag, { quality, fps: selectedFps }));
      if (next) apply(next, token, targetTag);
    } catch (cause) { fail(cause, token, targetTag); }
    finally { if (current(token, targetTag)) { busyRef.current = false; setBusy(false); } }
  }
  function dispatchZoom() {
    zoomTimer.current = null;
    const factor = pendingZoom.current; pendingZoom.current = null;
    const targetTag = tag.current; const token = generation.current; const sequence = zoomSequence.current;
    if (factor === null || !targetTag || !current(token, targetTag)) return;
    // Native zoom ramps deliberately allow a newer gesture target to cancel
    // an older ramp. Awaiting each ramp would add seconds of gesture latency.
    void setStudioCameraZoomAsync(targetTag, factor).then(next => {
      if (sequence !== zoomSequence.current || !current(token, targetTag) || !stateRef.current) return;
      const confirmed = { ...stateRef.current, zoom: next.zoom, minZoom: next.minZoom, maxZoom: next.maxZoom };
      stateRef.current = confirmed; setState(confirmed); setError(null);
    }).catch(cause => { if (sequence === zoomSequence.current) fail(cause, token, targetTag); });
  }
  function setZoom(normalized: number) {
    const snapshot = stateRef.current;
    if (!available || !snapshot || !tag.current) return;
    zoomSequence.current++;
    pendingZoom.current = studioZoomFactor(normalized, snapshot);
    if (!zoomTimer.current) zoomTimer.current = setTimeout(dispatchZoom, 30);
  }
  async function drainExposure() {
    if (exposurePump.current) return;
    exposurePump.current = true;
    try {
      while (pendingExposure.current !== null && enabledRef.current) {
        const bias = pendingExposure.current; pendingExposure.current = null;
        const targetTag = tag.current; const token = generation.current;
        if (!targetTag) continue;
        try {
          const next = await enqueue(token, targetTag, () => setStudioCameraExposureAsync(targetTag, bias));
          if (next) apply(next, token, targetTag);
        } catch (cause) { fail(cause, token, targetTag); }
      }
    } finally { exposurePump.current = false; }
  }
  function setExposure(bias: number) {
    const snapshot = stateRef.current;
    if (!available || !snapshot || !snapshot.supportsExposure || !tag.current) return;
    pendingExposure.current = clamp(bias, snapshot.minExposure, snapshot.maxExposure);
    void drainExposure();
  }
  async function focus(point: { x: number; y: number; locked: boolean }) {
    const targetTag = tag.current; const token = generation.current; const snapshot = stateRef.current;
    if (!available || !targetTag || !snapshot?.supportsFocus || point.locked && !snapshot.supportsFocusLock) return;
    try {
      const next = await enqueue(token, targetTag, () => setStudioCameraFocusAsync(targetTag, point));
      if (next) apply(next, token, targetTag);
    } catch (cause) { fail(cause, token, targetTag); }
  }
  function recordingProbe() {
    const targetTag = tag.current; const token = generation.current;
    if (!available || !targetTag) return undefined;
    // Freeze this view's generation and tag for one recording. A remount cannot
    // redirect its pending stop confirmation to the new front/back camera.
    return async () => {
      if (!current(token, targetTag)) return undefined;
      const snapshot = await getStudioCameraCapabilitiesAsync(targetTag);
      return current(token, targetTag) ? snapshot.isRecording : undefined;
    };
  }
  return { available, state, busy, error, initialize, configure, setZoom, setExposure, focus,
    isBusy: () => busyRef.current,
    isReady: () => enabledRef.current && (!available || !!tag.current && !!stateRef.current && !busyRef.current),
    recordingProbe,
  };
}
