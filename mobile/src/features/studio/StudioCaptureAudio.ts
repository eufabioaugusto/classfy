import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioCaptureAudioEvent, StudioAudioInputPort, StudioAudioInputState } from '../../../modules/classfy-studio-media';

export const studioAudioFreshnessMs = 1500;
type MonitorStatus = 'waiting' | 'live' | 'unavailable' | 'interrupted';
type Monitor = {
  scope: string; epoch: number; generation: number; revision: number; sequence: number; timestampMs: number;
  input: StudioCaptureAudioEvent['input']; channels: StudioCaptureAudioEvent['channels'];
  status: MonitorStatus; message?: string; warningUntil?: number;
  audioInput?: StudioAudioInputState;
};
const initial = (scope: string, epoch = 0): Monitor => ({ scope, epoch, generation: -1, revision: -1, sequence: -1, timestampMs: 0,
  input: null, channels: [], status: 'waiting' });

function validAudioInputPort(value: unknown): value is StudioAudioInputPort {
  if (!value || typeof value !== 'object') return false;
  const port = value as StudioAudioInputPort;
  return [port.id, port.name, port.type].every(field => typeof field === 'string' && field.trim().length > 0 && field.length <= 512);
}
export function validStudioAudioInputState(value: unknown): value is StudioAudioInputState {
  if (!value || typeof value !== 'object') return false;
  const state = value as StudioAudioInputState;
  return state.version === 1 && Array.isArray(state.available) && state.available.length <= 32
    && state.available.every(validAudioInputPort) && new Set(state.available.map(port => port.id)).size === state.available.length
    && (state.preferredId === null || typeof state.preferredId === 'string' && state.preferredId.length > 0 && state.preferredId.length <= 512)
    && (state.current === null || validAudioInputPort(state.current)) && typeof state.confirmed === 'boolean'
    && typeof state.selecting === 'boolean' && (!state.confirmed || state.current !== null)
    && (state.warning === null || typeof state.warning === 'string' && state.warning.length <= 512);
}

/** Accept device observations only; a preference or a connected accessory is not an active input. */
export function validStudioCaptureAudioEvent(value: unknown): value is StudioCaptureAudioEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as StudioCaptureAudioEvent;
  if (event.version !== 1 || !Number.isSafeInteger(event.generation) || event.generation < 0
    || !Number.isSafeInteger(event.sequence) || event.sequence < 0 || !Number.isSafeInteger(event.revision) || event.revision < 0
    || typeof event.active !== 'boolean' || !Number.isFinite(event.timestampMs) || event.timestampMs < 0
    || !Array.isArray(event.channels) || event.channels.length > 8 || !Number.isSafeInteger(event.channelCount)
    || event.channelCount < 0 || event.channelCount > 8
    || event.ageMs !== null && (typeof event.ageMs !== 'number' || !Number.isFinite(event.ageMs) || event.ageMs < 0)
    || event.sampleRate !== null && (typeof event.sampleRate !== 'number' || !Number.isFinite(event.sampleRate) || event.sampleRate <= 0)
    || event.reason !== undefined && !['routeChanged', 'inputLost', 'interrupted', 'inactive', 'preparing', 'unavailable'].includes(event.reason)) return false;
  if (event.audioInput !== undefined && !validStudioAudioInputState(event.audioInput)) return false;
  if (event.input !== null && (!event.input || !['id', 'name', 'type'].every(key =>
    typeof event.input?.[key as keyof NonNullable<StudioCaptureAudioEvent['input']>] === 'string'
      && event.input[key as keyof NonNullable<StudioCaptureAudioEvent['input']>].trim().length > 0))) return false;
  if (event.channels.some(channel => !channel || !Number.isFinite(channel.averageDb) || !Number.isFinite(channel.peakDb)
    || channel.averageDb < -160 || channel.peakDb < -160 || channel.averageDb > 6 || channel.peakDb > 6
    || channel.peakDb + 0.01 < channel.averageDb)) return false;
  if (event.channels.length && (!event.active || !event.input || event.channelCount !== event.channels.length
    || typeof event.ageMs !== 'number' || !Number.isFinite(event.ageMs) || event.ageMs < 0
    || typeof event.sampleRate !== 'number' || !Number.isFinite(event.sampleRate) || event.sampleRate <= 0)) return false;
  return true;
}

export function useStudioCaptureAudioMonitor({ active, available, scopeKey, generation }: {
  active: boolean; available: boolean; scopeKey: string; generation?: number;
}) {
  const live = useRef({ active, available, scopeKey, generation, epoch: 0 });
  const epoch = live.current.epoch + (live.current.active !== active || live.current.available !== available
    || live.current.scopeKey !== scopeKey ? 1 : 0);
  live.current = { active, available, scopeKey, generation, epoch };
  const [monitor, setMonitor] = useState<Monitor>(() => initial(scopeKey, epoch));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setMonitor(initial(scopeKey, epoch)); }, [scopeKey, epoch]);
  const onAudioMonitor = useCallback((value: StudioCaptureAudioEvent) => {
    const current = live.current;
    if (!mounted.current || !current.active || !current.available || current.scopeKey !== scopeKey || current.epoch !== epoch
      || !validStudioCaptureAudioEvent(value) || current.generation !== undefined && value.generation < current.generation) return;
    const now = Date.now();
    // Native timestamp also rejects events which waited in a blocked JS queue.
    if (now - value.timestampMs > studioAudioFreshnessMs || value.timestampMs - now > 1000) return;
    setMonitor(previous => {
      if (!mounted.current || !live.current.active || live.current.scopeKey !== scopeKey || live.current.epoch !== epoch) return previous;
      const owned = previous.scope === scopeKey && previous.epoch === epoch ? previous : initial(scopeKey, epoch);
      if (value.generation < owned.generation || value.generation === owned.generation
        && (value.sequence <= owned.sequence || value.revision < owned.revision)) return previous;
      const fresh = value.active && !!value.input && value.channels.length > 0
        && value.ageMs !== null && value.ageMs <= studioAudioFreshnessMs;
      const lost = value.reason === 'inputLost';
      const warningUntil = lost ? now + 8000 : owned.warningUntil;
      const warning = lost ? 'Microfone desconectado. Confira a entrada.'
        : value.audioInput?.warning || (warningUntil && warningUntil > now ? owned.message : undefined);
      const status: MonitorStatus = value.reason === 'unavailable' ? 'unavailable'
        : value.reason === 'interrupted' || value.reason === 'inactive' ? 'interrupted' : fresh ? 'live' : 'waiting';
      return { scope: scopeKey, epoch, generation: value.generation, revision: value.revision, sequence: value.sequence, timestampMs: value.timestampMs,
        input: value.active ? value.input : null, channels: fresh ? value.channels : [], status,
        message: warning, warningUntil, audioInput: value.audioInput };
    });
  }, [scopeKey, epoch]);
  useEffect(() => {
    if (!active || !available) return;
    const timer = setInterval(() => {
      if (!mounted.current) return;
      const now = Date.now();
      setMonitor(previous => {
        if (previous.scope !== scopeKey || previous.epoch !== epoch) return previous;
        if (previous.status === 'live' && now - previous.timestampMs > studioAudioFreshnessMs)
          return { ...previous, input: null, channels: [], status: 'interrupted', message: 'Áudio sem leitura. Confira o microfone.',
            ...(previous.audioInput ? { audioInput: { ...previous.audioInput, current: null, confirmed: false } } : {}) };
        if (previous.warningUntil && now >= previous.warningUntil && previous.status === 'live')
          return { ...previous, message: undefined, warningUntil: undefined };
        return previous;
      });
    }, 250);
    return () => clearInterval(timer);
  }, [active, available, scopeKey, epoch]);
  const current = active && available && monitor.scope === scopeKey && monitor.epoch === epoch
    && (generation === undefined || monitor.generation >= generation) ? monitor : initial(scopeKey, epoch);
  return { input: current.input, channels: current.channels,
    status: available ? current.status : 'unavailable' as MonitorStatus,
    message: available ? current.message : 'Atualize o app para identificar o microfone.', audioInput: current.audioInput, onAudioMonitor };
}
