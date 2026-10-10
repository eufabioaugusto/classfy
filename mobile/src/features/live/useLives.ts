import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { acquireLiveViewerPresence, assertLiveChatAccess, createStudioLive, deleteLiveMessage, discardStudioLive, getLive, getLiveChatProfiles, getLiveCreatorAccess, listLiveMessages,
  listStudioLives, publishStudioLiveReplay, sendLiveMessage } from './backend';
import { assertLiveScope, isLiveCancellation, readLiveMessage, readLiveRecord, type CreateStudioLiveInput,
  type LiveMessage, type LiveRecord, type LiveRequestScope } from './model';

function message(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível atualizar esta live.'; }
function useScope(ownerId: string | null | undefined, liveId: string | null = '') {
  const identity = `${ownerId || ''}:${liveId}`;
  const live = useRef({ identity, mounted: true, epoch: 0 });
  // A render that changes account/id invalidates old callbacks immediately,
  // before effect cleanup runs. Token refresh for the same account is harmless.
  if (live.current.identity !== identity) { live.current.identity = identity; live.current.epoch++; }
  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; live.current.epoch++; };
  }, [identity]);
  return useCallback((additional?: LiveRequestScope): LiveRequestScope => {
    const epoch = live.current.epoch;
    return { signal: additional?.signal, isCurrent: () => live.current.mounted && live.current.identity === identity
      && live.current.epoch === epoch && additional?.isCurrent?.() !== false };
  }, [identity]);
}

export function useLiveViewerPresence(ownerId: string | null | undefined, liveId: string | null | undefined, active: boolean) {
  const scope = useScope(ownerId, liveId);
  const activity = useRef({ active, foreground: AppState.currentState === 'active' });
  activity.current.active = active;
  const [isForeground, setForeground] = useState(activity.current.foreground);
  const [snapshot, setSnapshot] = useState({ ownerId, liveId, joined: false, error: null as string | null });
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      activity.current.foreground = state === 'active'; setForeground(state === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!ownerId || !liveId || !active || !isForeground) return;
    const internal = scope(); let released = false;
    const request: LiveRequestScope = { isCurrent: () => internal.isCurrent?.() === true && !released && activity.current.active && activity.current.foreground };
    if (!request.isCurrent?.()) return;
    const lease = acquireLiveViewerPresence(ownerId, liveId, request);
    setSnapshot({ ownerId, liveId, joined: false, error: null });
    void lease.ready.then(joined => { if (request.isCurrent?.()) setSnapshot({ ownerId, liveId, joined, error: null }); })
      .catch(error => { if (request.isCurrent?.() && !isLiveCancellation(error)) setSnapshot({ ownerId, liveId, joined: false, error: message(error) }); });
    return () => {
      released = true;
      // Presence is best effort on teardown. The server's end action also closes
      // all rows; stale viewer rows across devices need a separate backend fix.
      void lease.release().catch(() => undefined);
    };
  }, [ownerId, liveId, active, isForeground, scope]);
  const current = snapshot.ownerId === ownerId && snapshot.liveId === liveId && active && isForeground;
  return { joined: current && snapshot.joined, error: current ? snapshot.error : null };
}
function foreground(refresh: () => void) {
  return AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
}
export function useStudioLives() {
  const { user } = useAuth();
  const ownerId = user?.id;
  const scope = useScope(ownerId);
  const [snapshot, setSnapshot] = useState({ ownerId, lives: [] as LiveRecord[], loading: !!ownerId, error: null as string | null });
  const [access, setAccess] = useState({ ownerId, loading: !!ownerId, granted: false });
  const requests = useRef(0), accessRequests = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requests.current, active = scope();
    if (!ownerId) return;
    setSnapshot(previous => ({ ownerId, lives: previous.ownerId === ownerId ? previous.lives : [],
      loading: previous.ownerId !== ownerId || previous.loading, error: null }));
    try {
      const lives = await listStudioLives(ownerId, active);
      assertLiveScope(active);
      if (request === requests.current) setSnapshot({ ownerId, lives, loading: false, error: null });
    } catch (error) {
      if (active.isCurrent?.() && request === requests.current && !isLiveCancellation(error)) setSnapshot(previous => ({ ...previous, loading: false, error: message(error) }));
    }
  }, [ownerId, scope]);
  const loadAccess = useCallback(async () => {
    const request = ++accessRequests.current, active = scope();
    if (!ownerId) return;
    setAccess({ ownerId, loading: true, granted: false });
    try {
      const granted = await getLiveCreatorAccess(ownerId, active);
      if (active.isCurrent?.() && request === accessRequests.current) setAccess({ ownerId, loading: false, granted });
    } catch { if (active.isCurrent?.() && request === accessRequests.current) setAccess({ ownerId, loading: false, granted: false }); }
  }, [ownerId, scope]);
  useEffect(() => {
    if (!ownerId) return;
    const active = scope();
    void refresh(); void loadAccess();
    const channel = supabase.channel(`mobile-studio-lives:${ownerId}:${randomUUID()}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'lives', filter: `creator_id=eq.${ownerId}`,
    }, () => { if (active.isCurrent?.() && AppState.currentState === 'active') void refresh(); }).subscribe();
    const app = foreground(() => { if (active.isCurrent?.()) { void refresh(); void loadAccess(); } });
    return () => { app.remove(); void supabase.removeChannel(channel); };
  }, [ownerId, scope, refresh, loadAccess]);
  const requireOwner = () => { if (!ownerId) throw new Error('Entre na sua conta para abrir o Studio.'); return ownerId; };
  const create = async (input: CreateStudioLiveInput, additional?: LiveRequestScope) => {
    const active = scope(additional), result = await createStudioLive(requireOwner(), input, active);
    assertLiveScope(active); await refresh(); assertLiveScope(active); return result;
  };
  const publishReplay = async (id: string, additional?: LiveRequestScope) => {
    const active = scope(additional), result = await publishStudioLiveReplay(requireOwner(), id, active);
    assertLiveScope(active); await refresh(); assertLiveScope(active); return result;
  };
  const discard = async (id: string, additional?: LiveRequestScope) => {
    const active = scope(additional); await discardStudioLive(requireOwner(), id, active);
    assertLiveScope(active); await refresh(); assertLiveScope(active);
  };
  return { lives: snapshot.ownerId === ownerId ? snapshot.lives : [],
    loading: !!ownerId && (snapshot.ownerId !== ownerId || snapshot.loading),
    error: snapshot.ownerId === ownerId ? snapshot.error : null,
    canCreate: !!ownerId && access.ownerId === ownerId && access.granted,
    accessLoading: !!ownerId && (access.ownerId !== ownerId || access.loading), refresh, create, publishReplay, discard };
}

export function useLive(ownerId: string | null | undefined, liveId: string | null | undefined) {
  const scope = useScope(ownerId, liveId);
  const [snapshot, setSnapshot] = useState({ ownerId, liveId, live: null as LiveRecord | null, loading: !!ownerId && !!liveId, error: null as string | null });
  const requests = useRef(0);
  const reload = useCallback(async () => {
    if (!ownerId || !liveId) return;
    const request = ++requests.current, active = scope();
    setSnapshot(previous => {
      const current = previous.ownerId === ownerId && previous.liveId === liveId ? previous.live : null;
      return { ownerId, liveId, live: current, loading: !current, error: null };
    });
    try {
      const live = await getLive(ownerId, liveId, active);
      if (active.isCurrent?.() && request === requests.current) setSnapshot({ ownerId, liveId, live, loading: false, error: null });
    } catch (error) {
      if (active.isCurrent?.() && request === requests.current && !isLiveCancellation(error)) setSnapshot(previous => ({ ...previous, loading: false, error: message(error) }));
    }
  }, [ownerId, liveId, scope]);
  useEffect(() => {
    if (!ownerId || !liveId) return;
    const active = scope(); void reload();
    const channel = supabase.channel(`mobile-live:${ownerId}:${liveId}:${randomUUID()}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'lives', filter: `id=eq.${liveId}`,
    }, payload => {
      if (!active.isCurrent?.()) return;
      // Refetch invalidates an older in-flight response, including a fetch that
      // began before the UPDATE/DELETE. No terminal state is overwritten by it.
      if (payload.eventType === 'DELETE') {
        requests.current++; setSnapshot({ ownerId, liveId, live: null, loading: false, error: 'Esta live não está mais disponível.' });
      } else {
        try {
          const live = readLiveRecord(payload.new);
          if (live.id !== liveId) return;
          requests.current++; setSnapshot({ ownerId, liveId, live, loading: false, error: null });
        } catch { void reload(); }
      }
    }).subscribe();
    const app = foreground(() => { if (active.isCurrent?.()) void reload(); });
    const poll = setInterval(() => { if (active.isCurrent?.() && AppState.currentState === 'active') void reload(); }, 5000);
    return () => { clearInterval(poll); app.remove(); void supabase.removeChannel(channel); };
  }, [ownerId, liveId, scope, reload]);
  const current = snapshot.ownerId === ownerId && snapshot.liveId === liveId;
  return { live: current ? snapshot.live : null, loading: !!ownerId && !!liveId && (!current || snapshot.loading), error: current ? snapshot.error : null, reload };
}

export function useLiveChat(ownerId: string | null | undefined, liveId: string | null | undefined, enabled = true) {
  const scope = useScope(ownerId, liveId);
  const [snapshot, setSnapshot] = useState({ ownerId, liveId, messages: [] as LiveMessage[], loading: !!ownerId && !!liveId, error: null as string | null, sending: false });
  const requests = useRef(0), version = useRef(0), sending = useRef<object | null>(null);
  const reload: () => Promise<void> = useCallback(async () => {
    if (!ownerId || !liveId) return;
    const request = ++requests.current, active = scope(), revision = version.current;
    try {
      const messages = await listLiveMessages(ownerId, liveId, active);
      if (active.isCurrent?.() && request === requests.current) {
        if (revision !== version.current) { void reload(); return; }
        setSnapshot({ ownerId, liveId, messages, loading: false, error: null, sending: !!sending.current });
      }
    } catch (error) {
      if (active.isCurrent?.() && request === requests.current && !isLiveCancellation(error)) setSnapshot(previous => ({ ...previous, loading: false, error: message(error) }));
    }
  }, [ownerId, liveId, scope]);
  useEffect(() => {
    if (!ownerId || !liveId) return;
    const active = scope(); sending.current = null; version.current++;
    setSnapshot({ ownerId, liveId, messages: [], loading: true, error: null, sending: false });
    const profiles = new Map<string, LiveMessage['user']>(), pendingProfiles = new Set<string>(), fetchingProfiles = new Set<string>();
    let hydrateTimer: ReturnType<typeof setTimeout> | undefined;
    const hydrate = () => {
      if (hydrateTimer || !pendingProfiles.size || !active.isCurrent?.()) return;
      hydrateTimer = setTimeout(async () => {
        hydrateTimer = undefined;
        const ids = [...pendingProfiles].slice(0, 20);
        for (const id of ids) { pendingProfiles.delete(id); fetchingProfiles.add(id); }
        try {
          const loaded = await getLiveChatProfiles(ownerId, liveId, ids, active);
          if (!active.isCurrent?.()) return;
          for (const id of ids) profiles.set(id, loaded[id]);
          setSnapshot(previous => ({ ...previous, messages: previous.messages.map(value =>
            loaded[value.user_id] ? { ...value, user: loaded[value.user_id] } : value) }));
        } catch { /* A later message or foreground refresh can retry a missing participant. */ }
        finally { for (const id of ids) fetchingProfiles.delete(id); hydrate(); }
      }, 120);
    };
    let disposed = false, channel: ReturnType<typeof supabase.channel> | undefined, historyStarted = false;
    // Chat Realtime SELECT is broad on the existing backend. Never subscribe
    // before the mobile access gate has confirmed this live/account pair.
    void assertLiveChatAccess(ownerId, liveId, active).then(() => {
      if (disposed || !active.isCurrent?.()) return;
      channel = supabase.channel(`mobile-live-chat:${ownerId}:${liveId}:${randomUUID()}`).on('postgres_changes', {
        event: '*', schema: 'public', table: 'live_messages', filter: `live_id=eq.${liveId}`,
      }, payload => {
        if (!active.isCurrent?.()) return;
        version.current++;
        if (payload.eventType === 'DELETE') {
          setSnapshot(previous => ({ ...previous, messages: previous.messages.filter(value => value.id !== payload.old.id) })); return;
        }
        try {
          const incoming = readLiveMessage(payload.new);
          if (incoming.live_id !== liveId) return;
          if (incoming.user) profiles.set(incoming.user_id, incoming.user);
          else if (!profiles.has(incoming.user_id) && !fetchingProfiles.has(incoming.user_id)) {
            pendingProfiles.add(incoming.user_id); hydrate();
          }
          setSnapshot(previous => {
            const existing = previous.messages.find(value => value.id === incoming.id);
            const user = incoming.user || profiles.get(incoming.user_id) || existing?.user || previous.messages.find(value => value.user_id === incoming.user_id && value.user)?.user;
            const messages = [...previous.messages.filter(value => value.id !== incoming.id), { ...incoming, ...(user ? { user } : {}) }]
              .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-200);
            return { ...previous, messages, loading: false };
          });
        } catch { void reload(); }
      }).subscribe(status => {
        // A second backfill after the join ACK closes the fetch/subscription
        // window, while history still loads when Realtime is unavailable.
        if (status === 'SUBSCRIBED' && historyStarted && !disposed && active.isCurrent?.()) void reload();
      });
      historyStarted = true; void reload();
    }).catch(error => {
      if (!disposed && active.isCurrent?.() && !isLiveCancellation(error)) {
        setSnapshot(previous => ({ ...previous, messages: [], loading: false, error: message(error) }));
      }
    });
    const app = foreground(() => { if (active.isCurrent?.()) void reload(); });
    return () => { disposed = true; if (hydrateTimer) clearTimeout(hydrateTimer); app.remove(); if (channel) void supabase.removeChannel(channel); };
  }, [ownerId, liveId, scope, reload]);
  const send = async (content: string, additional?: LiveRequestScope) => {
    if (!ownerId || !liveId) throw new Error('Entre na sua conta para conversar.');
    if (!enabled) throw new Error('O chat está fechado nesta live.');
    if (sending.current) throw new Error('Aguarde o envio da mensagem atual.');
    const active = scope(additional), internal = scope(), operation = {};
    assertLiveScope(active); sending.current = operation;
    setSnapshot(previous => ({ ...previous, sending: true, error: null }));
    try {
      const sent = await sendLiveMessage(ownerId, liveId, content, active); assertLiveScope(active);
      version.current++;
      setSnapshot(previous => ({ ...previous, messages: previous.messages.some(value => value.id === sent.id) ? previous.messages : [...previous.messages, sent].slice(-200) }));
      return sent;
    } catch (error) {
      if (active.isCurrent?.() && !isLiveCancellation(error)) setSnapshot(previous => ({ ...previous, error: message(error) }));
      throw error;
    } finally {
      if (sending.current === operation) {
        sending.current = null;
        if (internal.isCurrent?.()) setSnapshot(previous => ({ ...previous, sending: false }));
      }
    }
  };
  const remove = async (id: string, additional?: LiveRequestScope) => {
    if (!ownerId || !liveId) throw new Error('Entre na sua conta para moderar o chat.');
    const active = scope(additional); await deleteLiveMessage(ownerId, liveId, id, active); assertLiveScope(active);
    version.current++; setSnapshot(previous => ({ ...previous, messages: previous.messages.filter(value => value.id !== id) }));
  };
  const current = snapshot.ownerId === ownerId && snapshot.liveId === liveId;
  return { messages: current ? snapshot.messages : [], loading: !!ownerId && !!liveId && (!current || snapshot.loading),
    error: current ? snapshot.error : null, sending: current && snapshot.sending, send, delete: remove, reload };
}
