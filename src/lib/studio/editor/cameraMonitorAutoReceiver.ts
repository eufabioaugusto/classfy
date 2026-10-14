import { supabase } from '@/integrations/supabase/client';
import type { StudioCameraMonitor } from '../../../../shared/studio/cameraMonitor';
import { createStudioCameraMonitorClient, studioCameraMonitorFresh, type StudioCameraMonitorClient } from './cameraMonitorClient';
import { createStudioMonitorAutoCoordination, type StudioMonitorAutoCoordination, type StudioMonitorAutoLease } from './cameraMonitorAutoLease';

export type StudioMonitorAutoSignals = (owner: string, changed: () => void, ready: (healthy: boolean) => void) => () => void;
/** Realtime rows are wake-up signals only; the Edge confirms owner and Premium. */
export const subscribeStudioMonitorAutoSignals: StudioMonitorAutoSignals = (owner, changed, ready) => {
  const channel = supabase.channel(`studio-monitor-auto-${owner}-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'studio_camera_monitor_sessions', filter: `owner_id=eq.${owner}` }, changed)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'studio_camera_monitor_sessions', filter: `owner_id=eq.${owner}` }, changed)
    .subscribe(status => { if (status === 'SUBSCRIBED') { ready(true); changed(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') ready(false); });
  return () => { void supabase.removeChannel(channel); };
};
export function createStudioMonitorAutoReceiver(options: {
  owner: string; onOpen(monitor: StudioCameraMonitor): void; onClose(): void;
  client?: StudioCameraMonitorClient; signals?: StudioMonitorAutoSignals; coordination?: StudioMonitorAutoCoordination;
  visible?: () => boolean; manual?: boolean;
}) {
  const client = options.client ?? createStudioCameraMonitorClient(options.owner), coordination = options.coordination ?? createStudioMonitorAutoCoordination(options.owner);
  const signals = options.signals ?? subscribeStudioMonitorAutoSignals, visible = options.visible ?? (() => document.visibilityState === 'visible');
  const scope = new AbortController(); let disposed = false, started = false, healthy = false, dirty = false, manual = options.manual ?? false;
  let timer: ReturnType<typeof setTimeout> | undefined, unsubscribe: (() => void) | undefined, flight: Promise<void> | null = null;
  let lease: StudioMonitorAutoLease | null = null, monitor: StudioCameraMonitor | null = null;
  const close = () => { const previous = lease; lease = null; const wasOpen = !!monitor; monitor = null; previous?.release(); if (!disposed && wasOpen) options.onClose(); };
  const check = async (): Promise<void> => {
    if (disposed || !started) return;
    if (manual || !visible()) { close(); return; }
    if (flight) { dirty = true; return flight; }
    clearTimeout(timer); timer = undefined;
    const operation = (async () => {
      try {
        const response = await client.request({ action: 'monitor-discover' }, { signal: scope.signal, isCurrent: () => !disposed });
        const receivedAt = Date.now();
        if (disposed || manual || !visible()) return;
        const next = response.monitor;
        if (!next || next.ownerId !== options.owner || !studioCameraMonitorFresh(next, Date.parse(response.serverAt))) { close(); return; }
        if (coordination.dismissed(next.id)) { close(); return; }
        if (monitor?.id === next.id && lease?.current()) return;
        close();
        const claim = await coordination.acquire(next.id, () => { close(); });
        if (!claim) return;
        if (disposed || manual || !visible() || !claim.current() || !studioCameraMonitorFresh(next, Date.parse(response.serverAt) + Math.max(0, Date.now() - receivedAt))) { claim.release(); return; }
        lease = claim; monitor = next; options.onOpen(next);
      } catch { if (!disposed) { healthy = false; close(); } }
      finally {
        if (!disposed && !manual && visible()) timer = setTimeout(() => { void check(); }, healthy ? 30_000 : 5_000);
      }
    })();
    flight = operation;
    await operation; if (flight === operation) flight = null;
    if (dirty && !disposed) { dirty = false; void check(); }
  };
  return {
    start() { if (disposed || started) return; started = true; coordination.manual(manual); unsubscribe = signals(options.owner, () => { void check(); }, value => { healthy = value; if (!value) void check(); }); void check(); },
    signal: () => { if (lease && !lease.current()) close(); void check(); },
    coordinationChanged: () => { if (lease && !lease.current()) close(); },
    setManual(value: boolean) { manual = value; coordination.manual(manual); if (manual) close(); else void check(); },
    dismiss() { if (monitor) coordination.dismiss(monitor.id); close(); },
    dispose() { if (disposed) return; close(); disposed = true; scope.abort(); clearTimeout(timer); unsubscribe?.(); coordination.dispose(); },
  };
}
