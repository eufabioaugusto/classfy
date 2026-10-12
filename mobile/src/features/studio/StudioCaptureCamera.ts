import { useEffect, useRef, useState, type RefObject } from 'react';
import { findNodeHandle } from 'react-native';
import type { CameraType } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  getStudioCameraCapabilitiesAsync, configureStudioCameraAsync,
  isStudioCameraControlsAvailable, setStudioCameraZoomAsync,
  setStudioCameraExposureAsync, setStudioCameraFocusAsync,
  isStudioNativeCameraAvailable, getStudioNativeCameraCapabilitiesAsync, configureStudioNativeCameraAsync,
  setStudioNativeCameraZoomAsync, setStudioNativeCameraExposureAsync, setStudioNativeCameraFocusAsync,
  setStudioNativeCameraTorchAsync,
  setStudioNativeCameraProSettingsAsync, isStudioCameraProControlsAvailable,
  type StudioCameraState, type StudioCameraFPS, type StudioCameraProSettings,
} from '../../../modules/classfy-studio-media';
import { isStudioNativeCameraHandle, type StudioCaptureCameraHandle } from './StudioNativeCamera';
import { mergeStudioCameraProSettings } from './cameraProSettings';

type Quality = '720p' | '1080p' | '1440p' | '2160p';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function studioZoomFactor(normalized: number, state: Pick<StudioCameraState, 'minZoom' | 'maxZoom'>) {
  const min = Number.isFinite(state.minZoom) && state.minZoom > 0 ? state.minZoom : 1;
  const max = Number.isFinite(state.maxZoom) ? Math.max(min, state.maxZoom) : min;
  return min * Math.pow(max / min, Number.isFinite(normalized) ? clamp(normalized, 0, 1) : 0);
}
export function studioNormalizedZoom(factor: number, state: Pick<StudioCameraState, 'minZoom' | 'maxZoom'>) {
  const min = studioZoomFactor(0, state), max = studioZoomFactor(1, state);
  return max === min || !Number.isFinite(factor) ? 0 : clamp(Math.log(Math.max(min, factor) / min) / Math.log(max / min), 0, 1);
}
const hasZoom = (state: StudioCameraState | null) => !!state && Number.isFinite(state.minZoom) && Number.isFinite(state.maxZoom) && state.minZoom > 0 && state.maxZoom > state.minZoom;
const sameProfile = (a: StudioCameraState, b: StudioCameraState) => a.deviceId === b.deviceId && a.position === b.position && a.quality === b.quality && a.width === b.width && a.height === b.height
  && (a.fps === b.fps || a.fps !== null && b.fps !== null && Math.abs(a.fps - b.fps) < 0.01)
  && (a.generation === undefined || b.generation === undefined || a.generation === b.generation);

// Every control operates the exact mounted Expo Camera view. Serialize hardware
// changes and coalesce gesture targets, so a fast wheel never builds a backlog.
// A response from a disposed/front camera cannot replace the new back state.
export function useStudioCaptureCamera(camera: RefObject<StudioCaptureCameraHandle | null>, facing: CameraType, enabled: boolean,
  options?: { native: boolean; orientation: 'portrait' | 'landscape' }) {
  const native = options?.native === true;
  const available = native ? isStudioNativeCameraAvailable() : isStudioCameraControlsAvailable();
  const capabilities = native ? getStudioNativeCameraCapabilitiesAsync : getStudioCameraCapabilitiesAsync;
  const zoomCamera = native ? setStudioNativeCameraZoomAsync : setStudioCameraZoomAsync;
  const exposureCamera = native ? setStudioNativeCameraExposureAsync : setStudioCameraExposureAsync;
  const focusCamera = native ? setStudioNativeCameraFocusAsync : setStudioCameraFocusAsync;
  const [state, setState] = useState<StudioCameraState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomPending, setZoomPending] = useState(false);
  const [zoomConfirmation, setZoomConfirmation] = useState(0);
  const zoomReceipt = useRef(0);
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
  const zoomFlight = useRef<Promise<boolean> | null>(null);
  const exposurePump = useRef(false);
  const proOperation = useRef<{ token: number; targetTag: number; profile: StudioCameraState } | null>(null);
  const pendingPro = useRef<StudioCameraProSettings | null>(null);
  const [proBusy, setProBusy] = useState(false);
  const [proConfirmation, setProConfirmation] = useState(0);
  const proReceipt = useRef(0);
  const proUnconfirmedRef = useRef(false);
  const [proUnconfirmed, setProUnconfirmed] = useState(false);

  useEffect(() => {
    generation.current++; tag.current = null; stateRef.current = null;
    pendingZoom.current = null; pendingExposure.current = null;
    proOperation.current = null; pendingPro.current = null; setProBusy(false);
    setProConfirmation(++proReceipt.current);
    proUnconfirmedRef.current = false; setProUnconfirmed(false);
    zoomFlight.current = null;
    zoomSequence.current++; if (zoomTimer.current) clearTimeout(zoomTimer.current); zoomTimer.current = null;
    settleZoom();
    busyRef.current = false; setBusy(false); setState(null); setError(null);
  }, [enabled, facing, native, options?.orientation]);
  useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; generation.current++;
    pendingZoom.current = null; pendingExposure.current = null;
    proOperation.current = null; pendingPro.current = null;
    zoomFlight.current = null;
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
  }; }, []);

  function current(token: number, targetTag: number | null) {
    return mounted.current && enabledRef.current && generation.current === token && tag.current === targetTag;
  }
  function settleZoom() {
    if (!mounted.current) return;
    setZoomPending(false); setZoomConfirmation(++zoomReceipt.current);
  }
  function apply(next: StudioCameraState, token: number, targetTag: number) {
    if (!current(token, targetTag)) return;
    const previous = stateRef.current;
    if (previous?.generation !== undefined && next.generation !== undefined && (next.generation < previous.generation || next.generation === previous.generation && next.revision !== undefined && previous.revision !== undefined && next.revision < previous.revision)) return;
    stateRef.current = next; setState(next); setError(null);
    proUnconfirmedRef.current = next.proConfirmed === false; setProUnconfirmed(proUnconfirmedRef.current);
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
  async function nativeOrientation() {
    const screen = await ScreenOrientation.getOrientationAsync();
    return options?.orientation === 'landscape'
      ? screen === ScreenOrientation.Orientation.LANDSCAPE_LEFT ? 'landscapeLeft' : 'landscapeRight' : 'portrait';
  }
  async function configureCamera(targetTag: number, quality: Quality, fps: StudioCameraFPS, requestedOrientation?: Awaited<ReturnType<typeof nativeOrientation>>) {
    if (!native) return configureStudioCameraAsync(targetTag, { quality, fps });
    const orientation = requestedOrientation || await nativeOrientation();
    return configureStudioNativeCameraAsync(targetTag, { position: facing, quality, fps, orientation, cinematic: false, mirrored: false });
  }
  async function initialize(): Promise<boolean | undefined> {
    if (!enabledRef.current) return undefined;
    if (!available) return true;
    if (busyRef.current) return undefined;
    const token = generation.current;
    const targetTag = isStudioNativeCameraHandle(camera.current) ? camera.current.getNativeTag() : findNodeHandle(camera.current);
    tag.current = targetTag; busyRef.current = true; setBusy(true); setError(null);
    try {
      if (!targetTag) throw new Error('A câmera ainda está preparando os controles. Abra a captura novamente.');
      const result = await enqueue(token, targetTag, () => capabilities(targetTag));
      if (!current(token, targetTag) || !result) return undefined;
      const preferred = result.qualities.find(item => item.quality === result.quality)
        || result.qualities.find(item => item.quality === '1080p') || result.qualities[0];
      if (!preferred?.fps.length) throw new Error('Esta câmera não oferece um formato de vídeo compatível. Tente a outra câmera.');
      const initialFPS = preferred.fps.includes(30) ? 30 : preferred.fps[0];
      const configured = await enqueue(token, targetTag, () => configureCamera(targetTag, preferred.quality, initialFPS));
      if (!configured || !current(token, targetTag)) return undefined;
      apply(configured, token, targetTag);
      settleZoom();
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
    settleZoom();
    if (zoomTimer.current) clearTimeout(zoomTimer.current); zoomTimer.current = null;
    try {
      const next = await enqueue(token, targetTag, () => configureCamera(targetTag, quality, selectedFps));
      if (next) { apply(next, token, targetTag); if (current(token, targetTag)) { zoomFlight.current = null; settleZoom(); } }
    } catch (cause) { fail(cause, token, targetTag); }
    finally { if (current(token, targetTag)) { busyRef.current = false; setBusy(false); } }
  }
  function dispatchZoom(allowBusy = false): Promise<boolean> | null {
    zoomTimer.current = null;
    const factor = pendingZoom.current; pendingZoom.current = null;
    const targetTag = tag.current; const token = generation.current; const sequence = zoomSequence.current;
    const profile = stateRef.current;
    if (factor === null || !targetTag || !profile || !current(token, targetTag) || busyRef.current && !allowBusy) return null;
    // Native zoom ramps deliberately allow a newer gesture target to cancel
    // an older ramp. Awaiting each ramp would add seconds of gesture latency.
    const flight = zoomCamera(targetTag, factor).then(next => {
      if (sequence !== zoomSequence.current || !current(token, targetTag)) return false;
      if (!stateRef.current || !sameProfile(next, profile) || !sameProfile(next, stateRef.current)) { settleZoom(); return false; }
      if (!Number.isFinite(next.zoom) || !Number.isFinite(next.minZoom) || !Number.isFinite(next.maxZoom) || next.minZoom <= 0 || next.maxZoom < next.minZoom) throw new Error('A câmera não confirmou um zoom válido. Tente novamente.');
      const confirmed = { ...stateRef.current, zoom: clamp(next.zoom, next.minZoom, next.maxZoom), minZoom: next.minZoom, maxZoom: next.maxZoom,
        ...(next.revision !== undefined ? { revision: next.revision } : {}) };
      stateRef.current = confirmed; setState(confirmed); setError(null);
      settleZoom();
      return true;
    }).catch(cause => { if (sequence === zoomSequence.current && current(token, targetTag)) { fail(cause, token, targetTag); settleZoom(); } return false; });
    zoomFlight.current = flight;
    void flight.finally(() => { if (zoomFlight.current === flight) zoomFlight.current = null; });
    return flight;
  }
  function setZoom(normalized: number) {
    const snapshot = stateRef.current;
    if (!available || !hasZoom(snapshot) || !snapshot || !tag.current || busyRef.current || !enabledRef.current || !Number.isFinite(normalized)) return;
    zoomSequence.current++;
    setZoomPending(true);
    pendingZoom.current = studioZoomFactor(normalized, snapshot);
    if (!zoomTimer.current) zoomTimer.current = setTimeout(() => { void dispatchZoom(); }, 30);
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
          const next = await enqueue(token, targetTag, () => exposureCamera(targetTag, bias));
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
      const next = await enqueue(token, targetTag, () => focusCamera(targetTag, point));
      if (next) apply(next, token, targetTag);
    } catch (cause) { fail(cause, token, targetTag); }
  }
  async function setTorch(enabled: boolean) {
    const targetTag = tag.current; const token = generation.current;
    if (!native || !targetTag || !stateRef.current?.supportsTorch) return;
    try {
      const next = await enqueue(token, targetTag, () => setStudioNativeCameraTorchAsync(targetTag, enabled));
      if (next) apply(next, token, targetTag);
    } catch (cause) { fail(cause, token, targetTag); }
  }
  async function prepareRecording(): Promise<boolean> {
    if (!enabledRef.current) return false;
    if (!available) return true;
    const targetTag = tag.current; const token = generation.current; const snapshot = stateRef.current;
    if (!targetTag || !snapshot?.quality || busyRef.current || proUnconfirmedRef.current) return false;
    busyRef.current = true; setBusy(true);
    try {
      // Finish the last wheel target before REC hides the controls. A queued
      // target must not start an unnoticed ramp after MovieFileOutput begins.
      if (zoomTimer.current) clearTimeout(zoomTimer.current); zoomTimer.current = null;
      const pending = pendingZoom.current !== null ? dispatchZoom(true) : zoomFlight.current;
      if (pending && !await pending || !current(token, targetTag)) return false;
      if (!native) return true;
      // Freeze the actual interface orientation before MovieFileOutput starts.
      // Rotating the UI alone must never produce a sideways original.
      const orientation = await nativeOrientation();
      if (!current(token, targetTag)) return false;
      if ((snapshot as StudioCameraState & { orientation?: string }).orientation === orientation && snapshot.position === facing) return true;
      const next = await enqueue(token, targetTag, () => configureCamera(targetTag, snapshot.quality!, (snapshot.fps || 30) as StudioCameraFPS, orientation));
      if (!next || !current(token, targetTag)) return false;
      apply(next, token, targetTag); return true;
    } catch (cause) { fail(cause, token, targetTag); return false; }
    finally { if (current(token, targetTag)) { busyRef.current = false; setBusy(false); } }
  }
  async function drainPro(owned: NonNullable<typeof proOperation.current>) {
    try {
      while (proOperation.current === owned && current(owned.token, owned.targetTag) && pendingPro.current) {
        const patch = pendingPro.current; pendingPro.current = null;
        proUnconfirmedRef.current = true; setProUnconfirmed(true);
        const next = await enqueue(owned.token, owned.targetTag, () => setStudioNativeCameraProSettingsAsync(owned.targetTag, patch));
        if (proOperation.current !== owned || !current(owned.token, owned.targetTag)) return;
        if (!next || !sameProfile(next, owned.profile) || !next.pro || next.pro.version !== 1) throw new Error('A câmera mudou antes de confirmar os ajustes PRO. Tente novamente.');
        apply(next, owned.token, owned.targetTag);
      }
    } catch (cause) { if (proOperation.current === owned) { pendingPro.current = null; fail(cause, owned.token, owned.targetTag); } }
    finally {
      if (proOperation.current === owned) {
        proOperation.current = null;
        if (current(owned.token, owned.targetTag)) { busyRef.current = false; setBusy(false); setProBusy(false); setProConfirmation(++proReceipt.current); }
      }
    }
  }
  function setProSettings(patch: StudioCameraProSettings) {
    const snapshot = stateRef.current, targetTag = tag.current, token = generation.current;
    if (!native || typeof isStudioCameraProControlsAvailable !== 'function' || !isStudioCameraProControlsAvailable()
      || !snapshot?.pro || !targetTag || !current(token, targetTag) || snapshot.isRecording || busyRef.current && !proOperation.current) return;
    if (Object.values(patch).some(value => typeof value === 'number' && !Number.isFinite(value))) return;
    pendingPro.current = mergeStudioCameraProSettings(pendingPro.current, patch);
    if (proOperation.current) return;
    const owned = { token, targetTag, profile: snapshot }; proOperation.current = owned;
    busyRef.current = true; setBusy(true); setProBusy(true); setError(null);
    proUnconfirmedRef.current = true; setProUnconfirmed(true);
    void drainPro(owned);
  }
  function recordingProbe() {
    const targetTag = tag.current; const token = generation.current;
    if (!available || !targetTag) return undefined;
    // Freeze this view's generation and tag for one recording. A remount cannot
    // redirect its pending stop confirmation to the new front/back camera.
    return async () => {
      if (!current(token, targetTag)) return undefined;
      const snapshot = await capabilities(targetTag);
      return current(token, targetTag) ? snapshot.isRecording : undefined;
    };
  }
  return { available, native, state, busy, proBusy, proUnconfirmed, proConfirmation, error, zoomAvailable: hasZoom(state), zoomPending, zoomConfirmation, initialize, configure, setZoom, setExposure, focus, setTorch, setProSettings, prepareRecording,
    isBusy: () => busyRef.current,
    isReady: () => enabledRef.current && (!available || !!tag.current && !!stateRef.current && !busyRef.current && !proUnconfirmedRef.current),
    recordingProbe,
  };
}
