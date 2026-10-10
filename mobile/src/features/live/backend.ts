import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { createLiveFetch, liveRequestFailure, withLiveDeadline } from './request';
import { assertLiveScope, LiveBackendError, LiveCancelledError, liveCoverCrop, readLiveMessage, readLiveRecord,
  validateCreateLiveInput, type CreateStudioLiveInput, type LiveConnection, type LiveFollowerNotice, type LiveMessage,
  type LivePlaybackSource, type LiveRecord, type LiveReplaySubmission, type LiveRequestScope } from './model';

export const LIVE_COLUMNS = 'id,creator_id,title,description,status,visibility,price,thumbnail_url,chat_enabled,gifts_enabled,viewer_count,peak_viewers,mux_live_stream_id,livekit_egress_id,scheduled_for,started_at,ended_at,recording_ready_at,replay_content_id,replay_published_at,followers_notified_at,created_at,updated_at';
const MESSAGE_COLUMNS = 'id,live_id,user_id,content,type,is_pinned,created_at,user:profiles!user_id(display_name,avatar_url)';
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const operations = new Map<string, Promise<void>>();
type Request = <T>(run: (signal: AbortSignal) => PromiseLike<T>) => Promise<T>;
type Authenticated = { ownerId: string; client: typeof supabase; recoveryClient: typeof supabase; request: Request;
  recoveryRequest: Request; headers: { Authorization: string }; check(): void; assert(): Promise<void> };

function safeErrorMessage(value: unknown, fallback: string) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  return value.replace(/https?:\/\/\S+|wss?:\/\/\S+/gi, '[endereço omitido]')
    .replace(/Bearer\s+\S+/gi, '[credencial omitida]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[credencial omitida]').slice(0, 700);
}
async function backendError(error: unknown, fallback: string): Promise<LiveBackendError | LiveCancelledError> {
  const requestError = liveRequestFailure(error);
  if (requestError) return requestError;
  if (error instanceof LiveBackendError) return error;
  const item = error && typeof error === 'object' ? error as { message?: unknown; code?: unknown; context?: { status?: number; clone?(): { json(): Promise<unknown> }; json?(): Promise<unknown> } } : {};
  const status = item.context?.status;
  let message = item.message;
  try {
    const response = item.context?.clone?.() ?? item.context;
    const body = await withLiveDeadline(async () => response?.json?.()) as { error?: unknown; message?: unknown } | undefined;
    message = body?.error ?? body?.message ?? message;
  } catch { /* Preserve a useful database/transport error if no JSON was returned. */ }
  if (message === 'Edge Function returned a non-2xx status code') message = fallback;
  return new LiveBackendError(safeErrorMessage(message, fallback), status, typeof item.code === 'string' ? item.code : undefined);
}
function requireId(id: string) { if (!id.trim()) throw new LiveBackendError('Esta live não está disponível.'); }
async function authenticated<T>(ownerId: string, scope: LiveRequestScope | undefined, run: (context: Authenticated) => Promise<T>, verifyUser = false): Promise<T> {
  assertLiveScope(scope);
  if (!ownerId) throw new LiveBackendError('Entre na sua conta para abrir esta live.', 401, 'auth_required');
  const { data, error } = await withLiveDeadline(() => supabase.auth.getSession(), scope?.signal);
  const session = data.session;
  if (error || session?.user.id !== ownerId || !session.access_token) throw new LiveCancelledError();
  let changed = false;
  const listener = supabase.auth.onAuthStateChange((_event, next) => { if (next?.user.id !== ownerId) changed = true; });
  const check = () => { assertLiveScope(scope); if (changed) throw new LiveCancelledError(); };
  const headers = { Authorization: `Bearer ${session.access_token}` };
  // Every request, including Storage cleanup, uses the captured account. Never
  // let the SDK attach a new user's token while an older request awaits I/O.
  const makeClient = (fetch: typeof globalThis.fetch) => createClient(process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers, fetch },
    });
  const client = makeClient(createLiveFetch(check, scope?.signal));
  // Reconciliation/compensation outlives screen cancellation, but still uses
  // the original JWT and the same bounded transport. No new account is adopted.
  const recoveryClient = makeClient(createLiveFetch());
  const request: Request = async run => { check(); const result = await withLiveDeadline(run, scope?.signal); check(); return result; };
  const context: Authenticated = { ownerId, client, recoveryClient, request, recoveryRequest: run => withLiveDeadline(run), headers, check, assert: async () => {
    check();
    const current = await withLiveDeadline(() => supabase.auth.getSession(), scope?.signal);
    check();
    if (current.error || current.data.session?.user.id !== ownerId || !current.data.session.access_token) throw new LiveCancelledError();
  } };
  try {
    if (verifyUser) {
      const verified = await request(() => client.auth.getUser(session.access_token));
      check();
      if (verified.error && liveRequestFailure(verified.error)) throw liveRequestFailure(verified.error);
      if (verified.error || verified.data.user?.id !== ownerId) throw new LiveBackendError('Sua sessão expirou. Entre novamente para continuar.', 401, 'auth_required');
    }
    await context.assert();
    const result = await run(context);
    await context.assert();
    return result;
  } finally { listener.data.subscription.unsubscribe(); }
}
async function locked<T>(key: string, run: () => Promise<T>, rejectBusy = false) {
  const previous = operations.get(key);
  if (previous && rejectBusy) throw new LiveBackendError('Aguarde a operação atual desta live terminar.', 409, 'operation_busy');
  let release!: () => void;
  const completion = new Promise<void>(resolve => { release = resolve; });
  operations.set(key, completion);
  try {
    await previous;
    return await run();
  } finally {
    release();
    if (operations.get(key) === completion) operations.delete(key);
  }
}
async function invoke(context: Authenticated, action: string, body: Record<string, unknown>, scope?: LiveRequestScope): Promise<Record<string, unknown>> {
  await context.assert();
  const { data, error } = await context.request(signal => context.client.functions.invoke('live-control', { body: { ...body, action }, headers: context.headers, signal }));
  context.check();
  if (error) throw await backendError(error, 'Não foi possível concluir esta operação de live.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new LiveBackendError('Resposta inválida da operação de live.', undefined, 'invalid_response');
  if (typeof data.error === 'string') throw new LiveBackendError(safeErrorMessage(data.error, 'Não foi possível concluir esta operação.'));
  return data;
}
async function detail(context: Authenticated, id: string) {
  requireId(id); await context.assert();
  const { data, error } = await context.request(signal => context.client.from('lives').select(LIVE_COLUMNS).eq('id', id).abortSignal(signal).maybeSingle());
  context.check();
  if (error) throw await backendError(error, 'Não foi possível carregar esta live.');
  if (!data) throw new LiveBackendError('Esta live não está disponível para sua conta.', 404, 'live_not_found');
  return readLiveRecord(data);
}
async function ownDetail(context: Authenticated, id: string) {
  const live = await detail(context, id);
  if (live.creator_id !== context.ownerId) throw new LiveBackendError('Abra esta live na conta que a criou.', 403, 'owner_required');
  return live;
}
async function creatorAccess(context: Authenticated) {
  const [roles, profile] = await Promise.all([
    context.request(signal => context.client.from('user_roles').select('role').eq('user_id', context.ownerId).in('role', ['creator', 'admin']).abortSignal(signal)),
    context.request(signal => context.client.from('profiles').select('creator_status').eq('id', context.ownerId).abortSignal(signal).maybeSingle()),
  ]);
  context.check();
  if (roles.error || profile.error) throw await backendError(roles.error || profile.error, 'Não foi possível verificar seu acesso de creator.');
  return roles.data?.some(value => value.role === 'admin') === true
    || roles.data?.some(value => value.role === 'creator') === true && profile.data?.creator_status === 'approved';
}
export function getLiveCreatorAccess(ownerId: string, scope?: LiveRequestScope) { return authenticated(ownerId, scope, creatorAccess, true); }
export function getLive(ownerId: string, id: string, scope?: LiveRequestScope) { return authenticated(ownerId, scope, context => detail(context, id)); }
export function listStudioLives(ownerId: string, scope?: LiveRequestScope) {
  return authenticated(ownerId, scope, async context => {
    const { data, error } = await context.request(signal => context.client.from('lives').select(LIVE_COLUMNS).eq('creator_id', ownerId).order('created_at', { ascending: false }).limit(100).abortSignal(signal));
    context.check();
    if (error) throw await backendError(error, 'Não foi possível carregar suas lives.');
    return (data || []).map(readLiveRecord).filter(live => live.creator_id === ownerId);
  });
}
async function prepareCover(uri: string, context: Authenticated) {
  const info = await FileSystem.getInfoAsync(uri); context.check();
  if (!info.exists || info.isDirectory || info.size <= 0 || info.size > 20 * 1024 * 1024) throw new LiveBackendError('Escolha uma imagem válida de até 20 MB para a capa.');
  const canvas = ImageManipulator.manipulate(uri);
  let original: Awaited<ReturnType<typeof canvas.renderAsync>> | undefined;
  let rendered: Awaited<ReturnType<typeof canvas.renderAsync>> | undefined;
  let savedUri: string | undefined;
  try {
    original = await canvas.renderAsync(); context.check();
    canvas.crop(liveCoverCrop(original.width, original.height)).resize({ width: 1920, height: 1080 });
    rendered = await canvas.renderAsync(); context.check();
    for (const compress of [0.85, 0.65, 0.45]) {
      if (savedUri) await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
      savedUri = (await rendered.saveAsync({ format: SaveFormat.JPEG, compress })).uri; context.check();
      const encoded = await FileSystem.getInfoAsync(savedUri); context.check();
      if (encoded.exists && !encoded.isDirectory && encoded.size > 0 && encoded.size <= MAX_COVER_BYTES) return { uri: savedUri, size: encoded.size };
    }
    throw new LiveBackendError('Não foi possível preparar uma capa de até 2 MB. Escolha outra imagem.');
  } catch (error) {
    if (savedUri) await FileSystem.deleteAsync(savedUri, { idempotent: true }).catch(() => undefined);
    throw error;
  } finally { rendered?.release(); original?.release(); canvas.release(); }
}
function decodeCover(base64: string) {
  if (base64.length > Math.ceil(MAX_COVER_BYTES / 3) * 4 + 4) throw new LiveBackendError('A capa ultrapassou o tamanho permitido.');
  const binary = atob(base64), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
export function createStudioLive(ownerId: string, input: CreateStudioLiveInput, scope?: LiveRequestScope): Promise<LiveRecord> {
  const values = validateCreateLiveInput(input);
  return locked(`create:${ownerId}`, () => authenticated(ownerId, scope, async context => {
    if (!await creatorAccess(context)) throw new LiveBackendError('Sua conta precisa estar aprovada como creator para criar uma live.', 403, 'approved_creator_required');
    await context.assert();
    const cover = await prepareCover(values.coverUri, context);
    const path = `thumbnails/${ownerId}/lives/${randomUUID()}.jpg`;
    const bucket = context.client.storage.from('contents');
    const thumbnailUrl = bucket.getPublicUrl(path).data.publicUrl;
    let uploaded = false, requestStarted = false;
    try {
      const bytes = decodeCover(await FileSystem.readAsStringAsync(cover.uri, { encoding: FileSystem.EncodingType.Base64 }));
      await context.assert();
      // The response can be lost/cancelled after Storage accepted the bytes.
      uploaded = true;
      const upload = await context.request(() => bucket.upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false, headers: context.headers }));
      if (upload.error) throw await backendError(upload.error, 'Não foi possível enviar a capa da live.');
      await context.assert(); requestStarted = true;
      const data = await invoke(context, 'create', { title: values.title, description: values.description, thumbnailUrl }, scope);
      if (typeof data.liveId !== 'string') throw new LiveBackendError('Não foi possível confirmar a criação da live.', undefined, 'creation_unknown');
      return await ownDetail(context, data.liveId);
    } catch (error) {
      if (uploaded) {
        // Even after cancellation, read under the captured account before any
        // cleanup. A successful create whose response was lost owns this cover.
        const lookup = await context.recoveryRequest(signal => context.recoveryClient.from('lives').select(LIVE_COLUMNS).eq('creator_id', ownerId).eq('thumbnail_url', thumbnailUrl).abortSignal(signal).maybeSingle())
          .catch(() => ({ data: null, error: true }));
        if (!lookup.error && lookup.data) { await context.assert(); return readLiveRecord(lookup.data); }
        const status = error instanceof LiveBackendError ? error.status : undefined;
        const definiteFailure = !requestStarted || !!status && status >= 400 && status < 500 && status !== 408;
        if (!lookup.error && !lookup.data && definiteFailure) await context.recoveryRequest(() => context.recoveryClient.storage.from('contents').remove([path])).catch(() => undefined);
        if (requestStarted && (lookup.error || !definiteFailure) && !(error instanceof LiveCancelledError)) {
          throw new LiveBackendError('Não foi possível confirmar a criação. Atualize suas lives antes de tentar novamente; a capa foi preservada.', status, 'creation_unknown');
        }
      }
      throw error;
    } finally { await FileSystem.deleteAsync(cover.uri, { idempotent: true }).catch(() => undefined); }
  }, true), true);
}
function connection(value: Record<string, unknown>): LiveConnection {
  if (typeof value.url !== 'string' || !/^(wss?|https?):\/\//.test(value.url) || typeof value.token !== 'string' || !value.token) throw new LiveBackendError('Não foi possível obter uma conexão válida para a live.', undefined, 'invalid_response');
  return { url: value.url, token: value.token };
}
function assertViewerAccess(live: LiveRecord, ownerId: string) {
  if (live.creator_id !== ownerId && live.visibility !== 'free') throw new LiveBackendError('Este formato de live ainda não está disponível no aplicativo.', 403, 'live_access_unsupported');
}
export function connectHost(ownerId: string, id: string, scope?: LiveRequestScope) {
  return authenticated(ownerId, scope, async context => { await ownDetail(context, id); return connection(await invoke(context, 'connect', { liveId: id }, scope)); });
}
async function ownerCommand(ownerId: string, id: string, action: string, body: Record<string, unknown>, scope?: LiveRequestScope) {
  requireId(id);
  return locked(`live:${ownerId}:${id}`, () => authenticated(ownerId, scope, async context => {
    await ownDetail(context, id); return invoke(context, action, { ...body, liveId: id }, scope);
  }, action !== 'sync'));
}
export async function startBridge(ownerId: string, id: string, restart = false, scope?: LiveRequestScope) {
  const result = await ownerCommand(ownerId, id, restart ? 'restart' : 'start', {}, scope);
  if (result.waitingForMux !== true || typeof result.egressId !== 'string') throw new LiveBackendError('Não foi possível confirmar a ponte da live.', undefined, 'invalid_response');
  return { waitingForMux: true as const, egressId: result.egressId };
}
export async function syncLive(ownerId: string, id: string, scope?: LiveRequestScope) {
  const value = await ownerCommand(ownerId, id, 'sync', {}, scope);
  if (!['scheduled', 'waiting', 'live', 'ended', 'cancelled'].includes(String(value.status))) throw new LiveBackendError('Não foi possível verificar o sinal da live.', undefined, 'invalid_response');
  return { status: value.status as LiveRecord['status'] };
}
export async function endLive(ownerId: string, id: string, scope?: LiveRequestScope) {
  const result = await ownerCommand(ownerId, id, 'end', {}, scope);
  if (result.ending !== true) throw new LiveBackendError('Não foi possível confirmar o encerramento da live.', undefined, 'invalid_response');
}
export async function setLiveChat(ownerId: string, id: string, enabled: boolean, scope?: LiveRequestScope) {
  const value = await ownerCommand(ownerId, id, 'set-chat', { enabled }, scope);
  if (typeof value.chatEnabled !== 'boolean') throw new LiveBackendError('Não foi possível confirmar a mudança do chat.', undefined, 'invalid_response');
  return value.chatEnabled;
}
export async function notifyLiveFollowers(ownerId: string, id: string, scope?: LiveRequestScope): Promise<LiveFollowerNotice> {
  const value = await ownerCommand(ownerId, id, 'notify-followers', {}, scope);
  if (typeof value.alreadyNotified !== 'boolean' || !Number.isFinite(value.notifiedCount) || Number(value.notifiedCount) < 0) throw new LiveBackendError('Não foi possível confirmar o aviso aos seguidores.', undefined, 'invalid_response');
  return { alreadyNotified: value.alreadyNotified, notifiedCount: Number(value.notifiedCount) };
}
export async function publishStudioLiveReplay(ownerId: string, id: string, scope?: LiveRequestScope): Promise<LiveReplaySubmission> {
  const value = await ownerCommand(ownerId, id, 'publish', {}, scope);
  if (typeof value.contentId !== 'string' || !value.contentId) throw new LiveBackendError('Não foi possível confirmar o envio da gravação.', undefined, 'invalid_response');
  return { contentId: value.contentId, alreadySubmitted: value.alreadySubmitted === true, submittedForReview: value.submittedForReview === true };
}
export async function discardStudioLive(ownerId: string, id: string, scope?: LiveRequestScope) {
  const value = await ownerCommand(ownerId, id, 'discard', {}, scope);
  if (value.discarded !== true) throw new LiveBackendError('Não foi possível confirmar o descarte da live.', undefined, 'invalid_response');
}
export function getViewerConnection(ownerId: string, id: string, scope?: LiveRequestScope) {
  return authenticated(ownerId, scope, async context => { assertViewerAccess(await detail(context, id), ownerId); return connection(await invoke(context, 'viewer-connect', { liveId: id }, scope)); });
}
export function getLivePlayback(ownerId: string, id: string, scope?: LiveRequestScope): Promise<LivePlaybackSource> {
  return authenticated(ownerId, scope, async context => {
    assertViewerAccess(await detail(context, id), ownerId); const value = await invoke(context, 'playback', { liveId: id }, scope);
    if (!['hls', 'mp4'].includes(String(value.type)) || typeof value.url !== 'string' || !/^https:\/\//.test(value.url)) throw new LiveBackendError('Não foi possível obter o vídeo desta live.', undefined, 'invalid_response');
    return { type: value.type as LivePlaybackSource['type'], url: value.url,
      ...(typeof value.duration === 'number' ? { duration: value.duration } : {}), ...(typeof value.expiresAt === 'string' ? { expiresAt: value.expiresAt } : {}) };
  });
}

type PresenceLease = { released: boolean; scope?: LiveRequestScope };
type PresenceEntry = { leases: Set<PresenceLease>; ready: Promise<boolean>; context?: Authenticated; mayBeJoined: boolean; cleanup?: Promise<void> };
const presences = new Map<string, PresenceEntry>();
export type LiveViewerPresenceLease = { ready: Promise<boolean>; release(): Promise<void> };
// Leases avoid one component leaving while another watches in the same app.
// The existing UNIQUE(live_id,user_id) server schema still shares presence
// between two devices; it has no heartbeat TTL. This does not claim otherwise.
export function acquireLiveViewerPresence(ownerId: string, id: string, scope?: LiveRequestScope): LiveViewerPresenceLease {
  assertLiveScope(scope); requireId(id);
  const key = `presence:${ownerId}:${id}`, lease: PresenceLease = { released: false, scope };
  let entry = presences.get(key);
  if (!entry || entry.cleanup) {
    entry = { leases: new Set(), ready: Promise.resolve(false), mayBeJoined: false };
    const current = entry;
    presences.set(key, current);
    current.leases.add(lease);
    const active: LiveRequestScope = { isCurrent: () => [...current.leases].some(value => {
      if (value.released) return false;
      try { assertLiveScope(value.scope); return true; } catch { return false; }
    }) };
    current.ready = locked(key, () => authenticated(ownerId, active, async context => {
      current.context = context;
      const live = await detail(context, id);
      if (live.creator_id === ownerId || live.status !== 'live') return false;
      assertViewerAccess(live, ownerId); await context.assert();
      // A response lost after this boundary may still have inserted the row.
      current.mayBeJoined = true;
      const { error } = await context.request(signal => context.client.from('live_viewers').upsert({ live_id: id, user_id: ownerId,
        is_active: true, joined_at: new Date().toISOString(), left_at: null }, { onConflict: 'live_id,user_id' }).abortSignal(signal));
      context.check(); if (error) throw await backendError(error, 'Não foi possível registrar sua presença na live.');
      // Existing viewer RLS permits a late upsert after the host's end action.
      // Reconcile once after joining so that race cannot leave an ended live active.
      const latest = await detail(context, id);
      if (latest.status !== 'live') {
        await context.assert();
        const stopped = await context.request(signal => context.client.from('live_viewers').update({ is_active: false, left_at: new Date().toISOString() })
          .eq('live_id', id).eq('user_id', ownerId).eq('is_active', true).abortSignal(signal));
        if (stopped.error) throw await backendError(stopped.error, 'Não foi possível encerrar sua presença na live.');
        current.mayBeJoined = false; context.check(); return false;
      }
      return true;
    }));
  } else entry.leases.add(lease);
  const current = entry;
  return { ready: current.ready.then(value => { assertLiveScope(scope); if (lease.released) throw new LiveCancelledError(); return value; }),
    async release() {
      if (lease.released) return current.cleanup;
      lease.released = true; current.leases.delete(lease);
      if (current.leases.size) return;
      current.cleanup = locked(key, async () => {
        await current.ready.catch(() => undefined);
        if (!current.mayBeJoined || !current.context) return;
        const context = current.context;
        // Unmount/focus cancellation cannot invalidate compensation, and a new
        // account's SDK session must never authorize it. Verify the captured JWT.
        const verified = await context.recoveryRequest(() => context.recoveryClient.auth.getUser(context.headers.Authorization.slice(7)));
        if (verified.error && liveRequestFailure(verified.error)) throw liveRequestFailure(verified.error);
        if (verified.error || verified.data.user?.id !== ownerId) return;
        const { error } = await context.recoveryRequest(signal => context.recoveryClient.from('live_viewers').update({ is_active: false, left_at: new Date().toISOString() })
          .eq('live_id', id).eq('user_id', ownerId).eq('is_active', true).abortSignal(signal));
        if (error) throw await backendError(error, 'Não foi possível encerrar sua presença na live.');
      }).finally(() => { if (presences.get(key) === current) presences.delete(key); });
      return current.cleanup;
    },
  };
}
export function listLiveMessages(ownerId: string, id: string, scope?: LiveRequestScope): Promise<LiveMessage[]> {
  return authenticated(ownerId, scope, async context => {
    assertViewerAccess(await detail(context, id), ownerId);
    // Fetch the most recent 200, then present oldest first. The web's ascending
    // limit would lose the current conversation when reopening a busy live.
    const result = await context.request(signal => context.client.from('live_messages').select(MESSAGE_COLUMNS).eq('live_id', id).order('created_at', { ascending: false }).limit(200).abortSignal(signal));
    context.check(); if (result.error) throw await backendError(result.error, 'Não foi possível carregar o chat.');
    return (result.data || []).map(readLiveMessage).reverse();
  });
}
/** Gate before subscribing: existing chat SELECT/Realtime RLS is broader than playback. */
export function assertLiveChatAccess(ownerId: string, id: string, scope?: LiveRequestScope) {
  return authenticated(ownerId, scope, async context => { assertViewerAccess(await detail(context, id), ownerId); });
}
export function getLiveChatProfiles(ownerId: string, id: string, userIds: readonly string[], scope?: LiveRequestScope): Promise<Record<string, NonNullable<LiveMessage['user']>>> {
  const ids = [...new Set(userIds.filter(value => typeof value === 'string' && !!value))].slice(0, 20);
  if (!ids.length) return Promise.resolve({});
  return authenticated(ownerId, scope, async context => {
    assertViewerAccess(await detail(context, id), ownerId);
    const { data, error } = await context.request(signal => context.client.from('profiles').select('id,display_name,avatar_url').in('id', ids).abortSignal(signal));
    context.check(); if (error) throw await backendError(error, 'Não foi possível carregar os participantes do chat.');
    const profiles: Record<string, NonNullable<LiveMessage['user']>> = {};
    for (const row of data || []) if (typeof row.id === 'string' && ids.includes(row.id)) {
      profiles[row.id] = { display_name: typeof row.display_name === 'string' ? row.display_name : null,
        avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null };
    }
    return profiles;
  });
}
export function sendLiveMessage(ownerId: string, id: string, content: string, scope?: LiveRequestScope): Promise<LiveMessage> {
  const text = content.trim();
  if (!text || text.length > 2000) return Promise.reject(new LiveBackendError('Envie uma mensagem de até 2.000 caracteres.'));
  return authenticated(ownerId, scope, async context => {
    const live = await detail(context, id);
    assertViewerAccess(live, ownerId);
    if (!live.chat_enabled || !['waiting', 'live'].includes(live.status)) throw new LiveBackendError('O chat está fechado nesta live.', 409, 'chat_closed');
    await context.assert();
    const result = await context.request(signal => context.client.from('live_messages').insert({ live_id: id, user_id: ownerId, content: text, type: 'text', is_pinned: false }).select(MESSAGE_COLUMNS).abortSignal(signal).single());
    context.check(); if (result.error) throw await backendError(result.error, 'Não foi possível enviar sua mensagem.');
    return readLiveMessage(result.data);
  });
}
export function deleteLiveMessage(ownerId: string, id: string, messageId: string, scope?: LiveRequestScope) {
  requireId(messageId);
  return authenticated(ownerId, scope, async context => {
    const live = await detail(context, id);
    const selected = await context.request(signal => context.client.from('live_messages').select('id,user_id').eq('id', messageId).eq('live_id', id).abortSignal(signal).maybeSingle());
    context.check(); if (selected.error) throw await backendError(selected.error, 'Não foi possível verificar esta mensagem.');
    if (!selected.data) return;
    if (selected.data.user_id !== ownerId && live.creator_id !== ownerId) throw new LiveBackendError('Você não pode apagar esta mensagem.', 403, 'forbidden');
    await context.assert();
    const result = await context.request(signal => context.client.from('live_messages').delete().eq('id', messageId).eq('live_id', id).select('id').abortSignal(signal));
    context.check(); if (result.error) throw await backendError(result.error, 'Não foi possível apagar esta mensagem.');
    if (!result.data?.length) throw new LiveBackendError('A mensagem não foi removida. Atualize o chat e tente novamente.', 409, 'state_changed');
  });
}
