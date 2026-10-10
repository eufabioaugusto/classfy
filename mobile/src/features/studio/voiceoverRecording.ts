import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';

export type StudioVoiceoverAudio = { uri: string; duration: number; name: string };
export type StudioVoiceoverRecording = {
  start: () => Promise<void>;
  finish: () => Promise<StudioVoiceoverAudio>;
  cancel: () => Promise<void>;
};
type Scope = { isCurrent: () => boolean; onStatus?: (status: { duration: number; recording: boolean; metering?: number }) => void };
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
      if (scope.isCurrent() && !closed) scope.onStatus?.({ duration: Math.max(0, status.durationMillis / 1000), recording: status.isRecording, metering: status.metering });
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
      try { await recorder.startAsync(); started = true; check(); }
      catch (cause) { closed = true; await cleanup(false); throw cause; }
    }),
    finish: () => serialized(async () => {
      check(); if (result) return result;
      if (closed) throw new Error('Esta gravação já foi encerrada.');
      closed = true;
      const { uri, status } = await cleanup(true);
      const duration = (status?.durationMillis || 0) / 1000;
      if (!uri || !Number.isFinite(duration) || duration < 0.1) {
        if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
        throw new Error('Grave ao menos um instante de áudio antes de parar.');
      }
      if (!scope.isCurrent()) { await FileSystem.deleteAsync(uri, { idempotent: true }); check(); }
      result = { uri, duration, name: 'Narração.m4a' };
      return result;
    }),
    cancel: () => serialized(async () => { closed = true; await cleanup(false); result = undefined; }),
  };
}
