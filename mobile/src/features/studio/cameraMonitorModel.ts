import type { StudioCameraMonitorState } from './cameraMonitorProtocol';

export const STUDIO_CAMERA_MONITOR_URL = 'https://www.classfy.com.br/studio/monitor';
export const STUDIO_CAMERA_MONITOR_HEARTBEAT_MS = 10_000;
export const studioMonitorUUID = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** This is presentation only; the server authorizes every monitor operation. */
export function hasStudioMonitorPremium(profile: {
  plan?: string | null; plan_expires_at?: string | null; entitlement_source?: string | null;
  subscription_status?: string | null; subscription_grace_until?: string | null;
} | null | undefined, now = Date.now()) {
  if (profile?.plan !== 'premium' || !['stripe', 'admin', 'legacy', 'apple', 'google'].includes(profile.entitlement_source || '')) return false;
  const admin = profile.entitlement_source === 'admin';
  if (!admin && !['active', 'trialing', 'canceled', 'past_due'].includes(profile.subscription_status || '')) return false;
  const expiry = !admin && profile.subscription_status === 'past_due' ? profile.subscription_grace_until : profile.plan_expires_at;
  return typeof expiry === 'string' && Date.parse(expiry) > now;
}
export function validStudioMonitorState(value: unknown): value is StudioCameraMonitorState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return Object.keys(state).length === 6 && Object.keys(state).every(key => ['recording', 'elapsedSeconds', 'width', 'height', 'fps', 'cameraFacing'].includes(key))
    && typeof state.recording === 'boolean'
    && typeof state.elapsedSeconds === 'number' && Number.isFinite(state.elapsedSeconds) && state.elapsedSeconds >= 0 && state.elapsedSeconds <= 86_400
    && ['width', 'height'].every(key => typeof state[key] === 'number' && Number.isInteger(state[key]) && (state[key] as number) > 0 && (state[key] as number) <= 7680)
    && typeof state.fps === 'number' && Number.isFinite(state.fps) && state.fps > 0 && state.fps <= 120
    && (state.cameraFacing === 'front' || state.cameraFacing === 'back');
}
export function studioMonitorCaptureState(value: {
  recording: boolean; elapsedSeconds: number; width?: number; height?: number; fps?: number | null; cameraFacing: 'front' | 'back';
}): StudioCameraMonitorState {
  return { recording: value.recording, elapsedSeconds: value.recording ? Math.max(0, Math.min(86_400, value.elapsedSeconds || 0)) : 0,
    width: Math.max(1, Math.min(7680, Math.round(value.width || 1920))),
    height: Math.max(1, Math.min(7680, Math.round(value.height || 1080))),
    fps: Math.max(1, Math.min(120, value.fps || 30)), cameraFacing: value.cameraFacing };
}
export function studioMonitorConfigurationChanged(previous: StudioCameraMonitorState, next: StudioCameraMonitorState) {
  return previous.recording !== next.recording || previous.width !== next.width || previous.height !== next.height
    || previous.fps !== next.fps || previous.cameraFacing !== next.cameraFacing;
}
export function studioMonitorErrorMessage(cause: unknown) {
  return (cause instanceof Error ? cause.message : 'Não foi possível conectar o monitor. Sua gravação continua no iPhone.')
    .replace(/(?:https?|wss?|file):\/\/\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gi, '[dado privado omitido]').slice(0, 500);
}
