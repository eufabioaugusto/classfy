type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
type LockPort = { request(name: string, options: { ifAvailable: true }, callback: (lock: unknown | null) => Promise<void>): Promise<unknown> };
export type StudioMonitorAutoLease = { current(): boolean; release(): void };
export type StudioMonitorAutoCoordination = {
  dismissed(sessionId: string): boolean;
  dismiss(sessionId: string): void;
  acquire(sessionId: string, onLost: () => void): Promise<StudioMonitorAutoLease | null>;
  manual(active: boolean): void;
  dispose(): void;
};
/** One automatic viewer per browser origin. Stored values contain IDs only. */
export function createStudioMonitorAutoCoordination(owner: string, options: { storage?: StoragePort; locks?: LockPort; tabId?: string; now?: () => number } = {}): StudioMonitorAutoCoordination {
  let storage: StoragePort | undefined = options.storage;
  try { storage ??= localStorage; } catch { /* Manual monitor stays available without shared storage. */ }
  const locks = options.locks ?? navigator.locks, now = options.now ?? Date.now, tabId = options.tabId ?? crypto.randomUUID();
  const prefix = `classfy:studio:monitor:auto:v1:${owner}:`, leaseKey = `${prefix}lease`, manualKey = `${prefix}manual:${tabId}`;
  const dismissed = new Set<string>(); let disposed = false, manualTimer: ReturnType<typeof setInterval> | undefined;
  const read = (key: string) => { try { return storage?.getItem(key) ?? null; } catch { return null; } };
  const write = (key: string, value: string) => { try { if (!storage) return false; storage.setItem(key, value); return storage.getItem(key) === value; } catch { return false; } };
  const remove = (key: string) => { try { storage?.removeItem(key); } catch { /* Storage may be disabled mid-session. */ } };
  const manualPresent = () => {
    try { for (let index = 0; storage && index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith(`${prefix}manual:`) && Number(read(key)) > now()) return true; } } catch { /* No automatic viewer if coordination becomes unavailable. */ }
    return false;
  };
  const storedLease = () => { try { const value = JSON.parse(read(leaseKey) ?? 'null'); return value && typeof value.tabId === 'string' && typeof value.until === 'number' ? value as { tabId: string; until: number } : null; } catch { return null; } };
  const active = new Set<StudioMonitorAutoLease>();
  const manual = (enabled: boolean) => {
    clearInterval(manualTimer); manualTimer = undefined;
    if (!enabled || disposed) { remove(manualKey); return; }
    const renew = () => { write(manualKey, String(now() + 9_000)); }; renew(); manualTimer = setInterval(renew, 3_000);
  };
  const acquire = async (sessionId: string, onLost: () => void): Promise<StudioMonitorAutoLease | null> => {
    if (disposed || manualPresent() || dismissed.has(sessionId) || read(`${prefix}dismiss:${sessionId}`) === '1') return null;
    // Verify shared dismissal storage before opening; private-storage failures
    // must not make every visible tab open an unsolicited monitor.
    if (!write(`${prefix}probe:${tabId}`, '1')) return null; remove(`${prefix}probe:${tabId}`);
    let unlock: (() => void) | undefined;
    const hold = () => {
      const existing = storedLease(); if (existing && existing.until > now() && existing.tabId !== tabId) return null;
      let released = false;
      const renew = () => write(leaseKey, JSON.stringify({ tabId, sessionId, until: now() + 9_000 }));
      if (!renew()) return null;
      const lease: StudioMonitorAutoLease = {
        current: () => !released && !disposed && !manualPresent() && storedLease()?.tabId === tabId && !dismissed.has(sessionId) && read(`${prefix}dismiss:${sessionId}`) !== '1',
        release: () => { if (released) return; released = true; clearInterval(timer); active.delete(lease); if (storedLease()?.tabId === tabId) remove(leaseKey); unlock?.(); },
      };
      const timer = setInterval(() => { if (!lease.current() || !renew()) { lease.release(); onLost(); } }, 2_000);
      active.add(lease); return lease;
    };
    if (locks) {
      return new Promise(resolve => {
        void locks.request(`classfy-studio-monitor-auto-${owner}`, { ifAvailable: true }, async lock => {
          if (!lock || disposed || manualPresent()) { resolve(null); return; }
          const held = new Promise<void>(release => { unlock = release; }); const lease = hold(); resolve(lease);
          if (lease) await held;
        }).catch(() => resolve(null));
      });
    }
    const lease = hold(); if (!lease) return null;
    // A short election lets simultaneous fallback claims settle before display.
    await new Promise(resolve => setTimeout(resolve, 60));
    if (!lease.current()) { lease.release(); return null; } return lease;
  };
  return {
    dismissed: sessionId => dismissed.has(sessionId) || read(`${prefix}dismiss:${sessionId}`) === '1',
    dismiss: sessionId => { dismissed.add(sessionId); write(`${prefix}dismiss:${sessionId}`, '1'); },
    acquire, manual,
    dispose: () => { disposed = true; manual(false); active.forEach(lease => lease.release()); active.clear(); },
  };
}
