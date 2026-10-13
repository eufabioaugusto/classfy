import type { StudioAudioInputState } from '../../../modules/classfy-studio-media';

const port = (value: unknown): value is NonNullable<StudioAudioInputState['current']> => {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return ['id', 'name', 'type'].every(key => typeof input[key] === 'string' && input[key].trim().length > 0);
};

/** Only system ports and confirmed routes may become selectable UI state. */
export function remoteCameraAudioInputState(value: unknown): StudioAudioInputState | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as StudioAudioInputState;
  if (state.version !== 1 || !Array.isArray(state.available) || state.available.length > 64 || state.available.some(input => !port(input))
    || new Set(state.available.map(input => input.id)).size !== state.available.length
    || state.current !== null && !port(state.current)
    || state.preferredId !== null && (typeof state.preferredId !== 'string' || !state.preferredId.trim())
    || typeof state.confirmed !== 'boolean' || typeof state.selecting !== 'boolean'
    || state.warning !== null && typeof state.warning !== 'string') return null;
  return state;
}

export function remoteCameraAudioInputSelected(state: StudioAudioInputState | null, id: string | null) {
  return !!state?.confirmed && !!state.current && state.preferredId === id
    && (id === null || state.current.id === id);
}

export function remoteCameraAudioPortLabel(type: string) {
  if (/bluetooth|hfp|ble/i.test(type)) return 'Bluetooth';
  if (/usb/i.test(type)) return 'USB';
  if (/headset|linein|headphone/i.test(type)) return 'Conectado por cabo';
  if (/builtin|built-in|microphonebuilt/i.test(type)) return 'Integrado';
  return 'Entrada disponível';
}
