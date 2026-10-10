export type LiveStatus = 'scheduled' | 'waiting' | 'live' | 'ended' | 'cancelled';
export type LiveRecord = {
  id: string; creator_id: string; title: string; description: string | null;
  status: LiveStatus; visibility: string; price: number; thumbnail_url: string | null;
  chat_enabled: boolean; gifts_enabled: boolean; viewer_count: number; peak_viewers: number;
  mux_live_stream_id: string | null; livekit_egress_id: string | null;
  scheduled_for: string | null; started_at: string | null; ended_at: string | null;
  recording_ready_at: string | null; replay_content_id: string | null; replay_published_at: string | null;
  followers_notified_at: string | null; created_at: string; updated_at: string;
};
export type StudioLive = LiveRecord;
export type CreateStudioLiveInput = { title: string; description?: string; coverUri: string };
export type LiveRequestScope = { signal?: AbortSignal; isCurrent?: () => boolean };
export type LiveConnection = { url: string; token: string };
export type LivePlaybackSource = { type: 'hls' | 'mp4'; url: string; duration?: number; expiresAt?: string };
export type LiveMessage = {
  id: string; live_id: string; user_id: string; content: string;
  type: 'text' | 'gift' | 'system' | 'pinned'; is_pinned: boolean; created_at: string;
  user?: { display_name: string | null; avatar_url: string | null };
};
export type LiveReplaySubmission = { contentId: string; alreadySubmitted: boolean; submittedForReview: boolean };
export type LiveFollowerNotice = { alreadyNotified: boolean; notifiedCount: number };
export class LiveCancelledError extends Error {
  constructor() { super('Esta operação de live foi cancelada.'); this.name = 'LiveCancelledError'; }
}
export class LiveBackendError extends Error {
  readonly status?: number;
  readonly code?: string;
  constructor(message: string, status?: number, code?: string) { super(message); this.name = 'LiveBackendError'; this.status = status; this.code = code; }
}
export function assertLiveScope(scope?: LiveRequestScope) {
  if (scope?.signal?.aborted || scope?.isCurrent?.() === false) throw new LiveCancelledError();
}
export function isLiveCancellation(error: unknown) { return error instanceof LiveCancelledError; }
const nullableString = (value: unknown) => typeof value === 'string' && value ? value : null;
const count = (value: unknown) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
export function readLiveRecord(value: unknown): LiveRecord {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof row.id !== 'string' || !row.id || typeof row.creator_id !== 'string' || !row.creator_id
    || typeof row.title !== 'string' || !['scheduled', 'waiting', 'live', 'ended', 'cancelled'].includes(String(row.status))) {
    throw new LiveBackendError('O servidor devolveu uma live inválida. Atualize a lista e tente novamente.', undefined, 'invalid_response');
  }
  return { id: row.id, creator_id: row.creator_id, title: row.title, description: nullableString(row.description),
    status: row.status as LiveStatus, visibility: typeof row.visibility === 'string' ? row.visibility : 'free',
    price: Number.isFinite(Number(row.price)) ? Number(row.price) : 0, thumbnail_url: nullableString(row.thumbnail_url),
    chat_enabled: row.chat_enabled !== false, gifts_enabled: row.gifts_enabled === true,
    viewer_count: count(row.viewer_count), peak_viewers: count(row.peak_viewers),
    mux_live_stream_id: nullableString(row.mux_live_stream_id), livekit_egress_id: nullableString(row.livekit_egress_id),
    scheduled_for: nullableString(row.scheduled_for), started_at: nullableString(row.started_at), ended_at: nullableString(row.ended_at),
    recording_ready_at: nullableString(row.recording_ready_at), replay_content_id: nullableString(row.replay_content_id),
    replay_published_at: nullableString(row.replay_published_at), followers_notified_at: nullableString(row.followers_notified_at),
    created_at: typeof row.created_at === 'string' ? row.created_at : '', updated_at: typeof row.updated_at === 'string' ? row.updated_at : '' };
}
export function readLiveMessage(value: unknown): LiveMessage {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (![row.id, row.live_id, row.user_id, row.content, row.created_at].every(value => typeof value === 'string')
    || !['text', 'gift', 'system', 'pinned'].includes(String(row.type))) throw new LiveBackendError('O servidor devolveu uma mensagem inválida.', undefined, 'invalid_response');
  const rawUser = Array.isArray(row.user) ? row.user[0] : row.user;
  const user = rawUser && typeof rawUser === 'object' ? rawUser as Record<string, unknown> : null;
  return { id: row.id as string, live_id: row.live_id as string, user_id: row.user_id as string, content: row.content as string,
    created_at: row.created_at as string, type: row.type as LiveMessage['type'], is_pinned: row.is_pinned === true,
    ...(user ? { user: { display_name: nullableString(user.display_name), avatar_url: nullableString(user.avatar_url) } } : {}) };
}
export function validateCreateLiveInput(input: CreateStudioLiveInput) {
  const title = input.title.trim(), description = input.description?.trim() || '';
  if (title.length < 3 || title.length > 150) throw new LiveBackendError('O título deve ter entre 3 e 150 caracteres.');
  if (description.length > 1000) throw new LiveBackendError('A descrição deve ter até 1.000 caracteres.');
  if (!input.coverUri.startsWith('file://')) throw new LiveBackendError('Escolha uma capa disponível neste aparelho.');
  return { title, description, coverUri: input.coverUri };
}
export function liveCoverCrop(width: number, height: number) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new LiveBackendError('Não foi possível ler esta imagem.');
  const cropWidth = Math.min(Math.floor(width), Math.floor(height * 16 / 9));
  const cropHeight = Math.min(Math.floor(height), Math.floor(width * 9 / 16));
  if (cropWidth < 1 || cropHeight < 1) throw new LiveBackendError('A imagem é pequena demais para a capa.');
  return { originX: Math.floor((width - cropWidth) / 2), originY: Math.floor((height - cropHeight) / 2), width: cropWidth, height: cropHeight };
}
export function liveStudioStatus(live: LiveRecord): string {
  if (live.replay_published_at) return 'Publicada';
  if (live.replay_content_id) return 'Em revisão';
  if (!live.mux_live_stream_id) return 'Registro antigo';
  if (live.status === 'live') return 'Ao vivo';
  if (live.status === 'waiting') return 'Pronta para iniciar';
  if (live.status === 'scheduled') return 'Agendada';
  if (live.status === 'cancelled') return 'Cancelada';
  return live.recording_ready_at ? 'Gravação pronta' : 'Preparando gravação';
}
export function canSubmitLiveReplay(live: LiveRecord) { return live.status === 'ended' && !!live.recording_ready_at && !live.replay_content_id; }
export function canDiscardStudioLive(live: LiveRecord) {
  if (live.replay_content_id || live.replay_published_at) return false;
  return live.status === 'ended' || live.status === 'cancelled' || live.status === 'waiting' && !live.livekit_egress_id;
}
// The deployed contract supports text and delete, not durable pin/unpin.
export const liveChatCapabilities = Object.freeze({ text: true, delete: true, pin: false, gifts: false });
