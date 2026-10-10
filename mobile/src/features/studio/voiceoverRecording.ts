import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { getMediaInfoAsync } from '../../../modules/classfy-studio-media';

export type StudioVoiceoverAudio = { uri: string; duration: number; name: string };
export class StudioVoiceoverReadError extends Error {
  constructor() { super('Não foi possível conferir o áudio gravado. Tente recuperar a narração.'); this.name = 'StudioVoiceoverReadError'; }
}
export type StudioVoiceoverRecording = {
  start: () => Promise<void>;
  finish: () => Promise<StudioVoiceoverAudio>;
  cancel: () => Promise<void>;
};
type Scope = { isCurrent: () => boolean; onStatus?: (status: { duration: number; recording: boolean; metering?: number; interrupted?: boolean }) => void };
let active: object | undefined;
let abandonedCleanup: (() => Promise<void>) | undefined;

/** One microphone lease; every path unloads it before restoring playback. */
export async function prepareStudioVoiceoverRecording(scope: Scope): Promise<StudioVoiceoverRecording> {
  const check = () => { if (!scope.isCurrent()) throw new Error('A gravação foi cancelada porque a tela ou a sessão mudou.'); };
  check();
  if (abandonedCleanup) {
    const previousCleanup = abandonedCleanup;
    await previousCleanup();
    if (abandonedCleanup === previousCleanup) abandonedCleanup = undefined;
    check();
  }
  if (active) throw new Error('Aguarde a gravação anterior encerrar.');
  const token = {}; active = token;
  const recorder = new Audio.Recording();
  let prepared = false, unloaded = false, modeEnabled = false, closed = false, started = false, result: StudioVoiceoverAudio | undefined;
  let observedDuration = 0, completedUri: string | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(callback: () => Promise<T>) => {
    const next = queue.catch(() => undefined).then(callback); queue = next; return next;
  };
  const cleanup = async (preserve: boolean) => {
    recorder.setOnRecordingStatusUpdate(null);
    let status: Audio.RecordingStatus | undefined, failure: unknown;
    if (prepared && !unloaded) {
      try { status = await recorder.stopAndUnloadAsync(); unloaded = true; }
      catch (cause) {
        failure = cause;
        status = await recorder.getStatusAsync().catch(() => undefined);
        if (!status || status.canRecord || status.isRecording) throw new Error('Não foi possível encerrar o microfone. Tente novamente.');
        unloaded = true;
      }
    }
    if (modeEnabled) {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true, staysActiveInBackground: false });
      modeEnabled = false;
    }
    if (active === token) active = undefined;
    const uri = recorder.getURI();
    if (!preserve && uri) await FileSystem.deleteAsync(uri, { idempotent: true });
    if (failure && preserve) throw new Error('A gravação não gerou áudio válido. Grave novamente.');
    return { status, uri };
  };
  try {
    const permission = await Audio.requestPermissionsAsync(); check();
    if (!permission.granted) throw new Error('Permita o uso do microfone nas configurações do aplicativo para gravar sua narração.');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true, staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix, interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: false, playThroughEarpieceAndroid: false });
    modeEnabled = true; check();
    recorder.setProgressUpdateInterval(100);
    recorder.setOnRecordingStatusUpdate(status => {
      if (!scope.isCurrent() && !closed) { closed = true; void serialized(() => cleanup(false)).catch(() => undefined); return; }
      if (scope.isCurrent() && !closed) {
        // A session interruption can reset Expo's duration to zero. Retain only
        // durations actually observed from the recorder, never a wall clock.
        if (Number.isFinite(status.durationMillis)) observedDuration = Math.max(observedDuration, status.durationMillis / 1000);
        const interrupted = started && (!status.isRecording || status.mediaServicesDidReset);
        scope.onStatus?.({ duration: observedDuration, recording: status.isRecording, metering: status.metering,
          ...(interrupted ? { interrupted: true } : {}) });
      }
    });
    await recorder.prepareToRecordAsync({ ...Audio.RecordingOptionsPresets.HIGH_QUALITY, isMeteringEnabled: true });
    prepared = true; check();
  } catch (cause) {
    closed = true;
    try { await cleanup(false); }
    catch (cleanupError) {
      // No session is returned after a preparation failure. Retain a serialized
      // cleanup so a later attempt can release that recorder before leasing anew.
      abandonedCleanup = () => serialized(async () => { await cleanup(false); });
      throw cleanupError;
    }
    throw cause;
  }
  return {
    start: () => serialized(async () => {
      check(); if (closed) throw new Error('Esta gravação já foi encerrada.');
      if (started) return;
      try {
        const status = await recorder.startAsync(); check();
        if (!status.isRecording || status.mediaServicesDidReset) throw new Error('O microfone não começou a gravar. Tente novamente.');
        started = true;
      }
      catch (cause) { closed = true; await cleanup(false); throw cause; }
    }),
    finish: () => serialized(async () => {
      check(); if (result) return result;
      if (closed && !completedUri) throw new Error('Esta gravação já foi encerrada.');
      if (!completedUri) {
        closed = true;
        const { uri } = await cleanup(true);
        if (!uri) throw new Error('A gravação não gerou um arquivo de áudio. Grave novamente.');
        completedUri = uri;
      }
      const uri = completedUri;
      if (!scope.isCurrent()) { await FileSystem.deleteAsync(uri, { idempotent: true }); completedUri = undefined; check(); }
      // Expo AV on iOS clears its recording timestamps before returning the
      // stop status. A zero there does not establish that the M4A is empty.
      // Validate the finished original through the existing native reader.
      let info: Awaited<ReturnType<typeof getMediaInfoAsync>>;
      try { info = await getMediaInfoAsync(uri); }
      catch {
        if (!scope.isCurrent()) { await FileSystem.deleteAsync(uri, { idempotent: true }); completedUri = undefined; check(); }
        throw new StudioVoiceoverReadError();
      }
      if (!scope.isCurrent()) { await FileSystem.deleteAsync(uri, { idempotent: true }); completedUri = undefined; check(); }
      const duration = info.duration;
      if (!info.hasAudio || !Number.isFinite(info.fileSize) || info.fileSize <= 0 || !Number.isFinite(duration) || duration < 0.1) {
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
        completedUri = undefined;
        throw new Error(observedDuration >= 0.1 ? 'O microfone foi interrompido e não gerou áudio válido. Grave novamente.' : 'Grave ao menos um instante de áudio antes de parar.');
      }
      result = { uri, duration, name: 'Narração.m4a' };
      return result;
    }),
    cancel: () => serialized(async () => { closed = true; await cleanup(false); result = undefined; completedUri = undefined; }),
  };
}
