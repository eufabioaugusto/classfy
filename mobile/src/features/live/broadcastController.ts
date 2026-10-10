import type { LiveRecord } from './model';

export type BroadcastPhase = 'idle' | 'preparing' | 'preview' | 'countdown' | 'connecting' | 'awaiting-signal' | 'live' | 'reconnecting' | 'interrupted' | 'ending' | 'ended' | 'error';
export type BroadcastSnapshot = {
  phase: BroadcastPhase; countdown: number; error: string | null;
  localPublishing: boolean; mayBeOnAir: boolean; waitingSince: number | null;
};
type LiveState = Pick<LiveRecord, 'id' | 'creator_id' | 'status' | 'livekit_egress_id' | 'mux_live_stream_id'>;
type Scope = { isCurrent: () => boolean };
export type BroadcastTransport = {
  prepare(options?: { facing?: 'front' | 'back'; quality?: '720p' | '1080p' }): Promise<void>;
  connectAndPublish(connection: { url: string; token: string; operationId?: string }): Promise<void>;
  disconnect(): Promise<void>; dispose(): Promise<void>;
};
export type BroadcastBackend = {
  getLive(owner: string, id: string, scope?: Scope): Promise<LiveState>;
  connectHost(owner: string, id: string, scope?: Scope): Promise<{ url: string; token: string }>;
  startBridge(owner: string, id: string, restart?: boolean, scope?: Scope): Promise<unknown>;
  syncLive(owner: string, id: string, scope?: Scope): Promise<{ status: string }>;
  endLive(owner: string, id: string, scope?: Scope): Promise<unknown>;
};

// The database/Mux signal confirms public status. Capturing or publishing RTC
// tracks alone must never make the UI claim that viewers can already watch.
export function createBroadcastController({ owner, liveId, transport, backend, isCurrent = () => true,
  now = Date.now, wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)), countdownSeconds = 3,
}: { owner: string; liveId: string; transport: BroadcastTransport; backend: BroadcastBackend;
  isCurrent?: () => boolean; now?: () => number; wait?: (ms: number) => Promise<void>; countdownSeconds?: number }) {
  let state: BroadcastSnapshot = { phase: 'idle', countdown: 0, error: null, localPublishing: false, mayBeOnAir: false, waitingSince: null };
  let row: LiveState | null = null;
  let generation = 0, disposed = false, foreground = true, busy = false, ready = false, syncing = false;
  const listeners = new Set<(value: BroadcastSnapshot) => void>();
  const current = () => !disposed && isCurrent();
  const emit = (patch: Partial<BroadcastSnapshot>) => {
    if (disposed) return;
    state = { ...state, ...patch };
    if (!current()) return;
    for (const listener of listeners) listener(state);
  };
  const scope = (epoch: number): Scope => ({ isCurrent: () => current() && epoch === generation && foreground });
  const valid = (epoch: number) => scope(epoch).isCurrent();
  const terminal = (live: LiveState) => live.status === 'ended' || live.status === 'cancelled';
  const safeDisconnect = async () => { try { await transport.disconnect(); } catch { /* state remains recoverable */ } };
  const idlePhase = (): BroadcastPhase => ready ? 'preview' : 'idle';

  return {
    getSnapshot: () => state,
    subscribe(listener: (value: BroadcastSnapshot) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; },
    mustConfirmLeave: () => busy || state.mayBeOnAir || state.localPublishing || row?.status === 'live',
    updateLive(live: LiveState) {
      if (!current() || live.id !== liveId || live.creator_id !== owner) return;
      row = live;
      if (terminal(live)) {
        ++generation; ready = false;
        emit({ phase: 'ended', countdown: 0, localPublishing: false, mayBeOnAir: false, waitingSince: null, error: null });
        void safeDisconnect();
      } else if (live.status === 'live') {
        emit({ mayBeOnAir: true, ...(state.localPublishing && state.phase !== 'ending' && state.phase !== 'reconnecting' ? { phase: 'live' as const, waitingSince: null } : {}) });
      }
    },
    async prepare() {
      if (!current() || busy || !foreground || row && terminal(row) || state.localPublishing) return false;
      busy = true; const epoch = ++generation;
      emit({ phase: 'preparing', error: null });
      try {
        await transport.prepare({ quality: '720p' });
        if (!valid(epoch)) { await safeDisconnect(); return false; }
        ready = true; emit({ phase: 'preview' }); return true;
      } catch {
        if (valid(epoch)) emit({ phase: 'error', error: 'Não foi possível abrir câmera e microfone. Verifique as permissões e tente novamente.' });
        return false;
      } finally { busy = false; }
    },
    async start() {
      if (!current() || busy || !foreground || !ready || state.localPublishing || row && terminal(row)) return false;
      busy = true; const epoch = ++generation;
      emit({ phase: 'connecting', error: null });
      try {
        const latest = await backend.getLive(owner, liveId, scope(epoch));
        if (!valid(epoch)) return false;
        if (latest.creator_id !== owner || latest.id !== liveId) throw new Error('owner');
        row = latest;
        if (terminal(latest)) { emit({ phase: 'ended', mayBeOnAir: false }); await safeDisconnect(); return false; }
        if (!latest.mux_live_stream_id) throw new Error('legacy');
        if (latest.status === 'live') emit({ mayBeOnAir: true });
        if (row?.status === 'waiting') {
          for (let count = countdownSeconds; count > 0; --count) {
            emit({ phase: 'countdown', countdown: count });
            await wait(1000); if (!valid(epoch)) return false;
          }
        }
        emit({ phase: 'connecting', countdown: 0 });
        const connection = await backend.connectHost(owner, liveId, scope(epoch));
        if (!valid(epoch)) return false;
        await transport.connectAndPublish({ ...connection, operationId: `host-${liveId}-${epoch}` });
        if (!valid(epoch)) { await safeDisconnect(); return false; }
        emit({ localPublishing: true });
        if (row.status === 'waiting') {
          // Once this request is dispatched, a lost response is not proof that
          // the server rolled back. Keep the end/leave guard until reconciled.
          emit({ mayBeOnAir: true, phase: 'awaiting-signal', waitingSince: now() });
          await backend.startBridge(owner, liveId, !!row.livekit_egress_id, scope(epoch));
          if (!valid(epoch)) { await safeDisconnect(); return false; }
        } else emit({ phase: 'live' });
        return true;
      } catch {
        if (valid(epoch)) {
          await safeDisconnect();
          if (!valid(epoch)) return false;
          ready = false;
          emit({ phase: 'interrupted', localPublishing: false, countdown: 0,
            error: state.mayBeOnAir ? 'O sinal foi interrompido. Retome a transmissão ou encerre a live.' : 'Não foi possível conectar. Ative a prévia e tente novamente.' });
        }
        return false;
      } finally { busy = false; }
    },
    async sync() {
      if (!current() || !foreground || syncing || row && terminal(row) || !state.mayBeOnAir) return;
      syncing = true; const epoch = generation;
      try {
        if (state.localPublishing && row?.status === 'waiting') await backend.syncLive(owner, liveId, scope(epoch));
        if (!valid(epoch)) return;
        const latest = await backend.getLive(owner, liveId, scope(epoch));
        if (valid(epoch)) this.updateLive(latest);
      } catch { /* A polling failure cannot invent a public status or stop RTC. */ }
      finally { syncing = false; }
    },
    connectionChanged(connection: 'disconnected' | 'connecting' | 'connected' | 'reconnecting') {
      if (!current() || !foreground || state.phase === 'ending' || state.phase === 'ended') return;
      if (connection === 'reconnecting' && state.localPublishing) emit({ phase: 'reconnecting' });
      if (connection === 'disconnected' && state.localPublishing) {
        ++generation; ready = false;
        emit({ phase: 'interrupted', localPublishing: false, error: 'Conexão interrompida. Ative a prévia para retomar ou encerre a live.' });
        void safeDisconnect();
      }
      if (connection === 'connected' && state.localPublishing && state.phase === 'reconnecting') {
        emit({ phase: row?.status === 'live' ? 'live' : 'awaiting-signal' });
      }
    },
    captureInterrupted() {
      if (!current() || state.phase === 'ended' || state.phase === 'ending') return;
      ++generation; ready = false;
      emit({ phase: 'interrupted', localPublishing: false, countdown: 0,
        error: 'A câmera ou o microfone foi interrompido. Ative a prévia para retomar.' });
      void safeDisconnect();
    },
    async end() {
      if (!current() || busy || row && terminal(row)) return false;
      busy = true; const epoch = ++generation; const previous = state.phase;
      emit({ phase: 'ending', error: null, countdown: 0 });
      try {
        await backend.endLive(owner, liveId, { isCurrent: () => current() && epoch === generation });
        if (!current() || epoch !== generation) return false;
        ready = false;
        emit({ phase: 'ended', localPublishing: false, mayBeOnAir: false, waitingSince: null });
        await safeDisconnect(); return true;
      } catch {
        if (current() && epoch === generation) emit({ phase: previous, error: 'Não foi possível confirmar o encerramento. Tente novamente; a live pode continuar no ar.' });
        return false;
      } finally { busy = false; }
    },
    async setForeground(active: boolean) {
      if (disposed || foreground === active) return;
      foreground = active;
      if (!active) {
        ++generation; ready = false;
        emit({ phase: state.mayBeOnAir || state.localPublishing ? 'interrupted' : 'idle', localPublishing: false, countdown: 0,
          error: state.mayBeOnAir ? 'A captura parou ao sair do aplicativo. Retome ou encerre sua live.' : null });
        await safeDisconnect();
      } else await this.sync();
    },
    async cancelPreparation() {
      if (!current() || state.mayBeOnAir || state.localPublishing) return false;
      ++generation; ready = false; await safeDisconnect();
      emit({ phase: idlePhase(), countdown: 0, error: null }); return true;
    },
    async dispose() { if (disposed) return; disposed = true; ++generation; listeners.clear(); await transport.dispose(); },
  };
}
