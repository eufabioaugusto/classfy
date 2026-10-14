import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioMonitorAutoCoordination } from './cameraMonitorAutoLease';
class StorageMap { values = new Map<string, string>(); get length() { return this.values.size; } key(index: number) { return [...this.values.keys()][index] ?? null; } getItem(key: string) { return this.values.get(key) ?? null; } setItem(key: string, value: string) { this.values.set(key, value); } removeItem(key: string) { this.values.delete(key); } }
function locks() { const held = new Set<string>(); return { async request(name: string, _options: { ifAvailable: true }, callback: (lock: unknown | null) => Promise<void>) { if (held.has(name)) return callback(null); held.add(name); try { return await callback({ name }); } finally { held.delete(name); } } }; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
describe('coordenação entre abas do monitor automático', () => {
  it('Web Lock permite apenas uma aba até o viewer liberar, sem gravar dados da cena', async () => {
    const storage = new StorageMap(), lock = locks(), a = createStudioMonitorAutoCoordination('owner', { storage, locks: lock, tabId: 'a' }), b = createStudioMonitorAutoCoordination('owner', { storage, locks: lock, tabId: 'b' });
    const lease = await a.acquire('session', vi.fn()); expect(lease?.current()).toBe(true); expect(await b.acquire('session', vi.fn())).toBeNull(); lease!.release(); for (let index = 0; index < 4; index++) await Promise.resolve(); const next = await b.acquire('session', vi.fn()); expect(next?.current()).toBe(true); expect([...storage.values.values()].join('')).not.toMatch(/token|state|recording|device/); a.dispose(); b.dispose();
  });
  it('fallback storage e eleição não abrem duas abas simultâneas', async () => {
    const storage = new StorageMap(), a = createStudioMonitorAutoCoordination('owner', { storage, tabId: 'a' }), b = createStudioMonitorAutoCoordination('owner', { storage, tabId: 'b' });
    const first = a.acquire('session', vi.fn()), second = b.acquire('session', vi.fn()); await vi.advanceTimersByTimeAsync(61); const values = await Promise.all([first, second]); expect(values.filter(Boolean)).toHaveLength(1); a.dispose(); b.dispose();
  });
  it('fechar é compartilhado por owner e session, e novo toggle pode abrir', async () => {
    const storage = new StorageMap(), lock = locks(), a = createStudioMonitorAutoCoordination('owner', { storage, locks: lock, tabId: 'a' }), b = createStudioMonitorAutoCoordination('owner', { storage, locks: lock, tabId: 'b' }), other = createStudioMonitorAutoCoordination('other', { storage, locks: lock, tabId: 'c' });
    a.dismiss('session'); expect(b.dismissed('session')).toBe(true); expect(other.dismissed('session')).toBe(false); expect(await b.acquire('session', vi.fn())).toBeNull(); expect(await b.acquire('new-session', vi.fn())).toBeTruthy(); a.dispose(); b.dispose(); other.dispose();
  });
  it('rota manual visível suprime auto e libera ao fechar sem marcar sessão como dismiss', async () => {
    const storage = new StorageMap(), lock = locks(), lost = vi.fn(), a = createStudioMonitorAutoCoordination('owner', { storage, locks: lock, tabId: 'auto' }), b = createStudioMonitorAutoCoordination('owner', { storage, locks: lock, tabId: 'manual' });
    const lease = await a.acquire('session', lost); b.manual(true); expect(lease?.current()).toBe(false); await vi.advanceTimersByTimeAsync(2000); expect(lost).toHaveBeenCalledTimes(1); expect(await a.acquire('session', vi.fn())).toBeNull(); b.manual(false); expect(await a.acquire('session', vi.fn())).toBeTruthy(); expect(a.dismissed('session')).toBe(false); a.dispose(); b.dispose();
  });
  it('falha de shared storage não dispara monitores automáticos duplicados', async () => {
    const storage = new StorageMap(); storage.setItem = () => { throw new Error('private storage'); }; const a = createStudioMonitorAutoCoordination('owner', { storage, locks: locks() }); expect(await a.acquire('session', vi.fn())).toBeNull(); a.dispose();
  });
});
