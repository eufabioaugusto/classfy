import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ owner: 'owner', session: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: io.session }, functions: { invoke: io.invoke } } }));
import { createStudioRemoteClient, type StudioRemoteDownload } from './remoteCameraClient';

const envelope = () => ({ session: { id: 'private-session' }, commands: [], takes: [], serverAt: new Date().toISOString() });
const url = (part: number) => `https://fixture.supabase.co/storage/v1/object/sign/private/part-${part}?token=fixture`;
let fetcher: ReturnType<typeof vi.fn>, content: Uint8Array, commits: number;
const encoder = new TextEncoder();
function opfs() {
  content = new Uint8Array(); commits = 0;
  const handle = {
    getFile: vi.fn(async () => new File([content as Uint8Array<ArrayBuffer>], 'original')),
    createWritable: vi.fn(async () => {
      let pending = new Uint8Array(content), cursor = 0;
      return {
        truncate: vi.fn(async (length: number) => { pending = pending.slice(0, length); }),
        seek: vi.fn(async (position: number) => { cursor = position; }),
        write: vi.fn(async (bytes: Uint8Array) => { const next = new Uint8Array(Math.max(pending.byteLength, cursor + bytes.byteLength)); next.set(pending); next.set(bytes, cursor); cursor += bytes.byteLength; pending = next; }),
        close: vi.fn(async () => { content = pending; commits++; }), abort: vi.fn(async () => undefined),
      };
    }),
  };
  const directory = { getFileHandle: vi.fn(async () => handle) };
  Object.defineProperty(navigator, 'storage', { value: { getDirectory: vi.fn(async () => ({ getDirectoryHandle: vi.fn(async () => directory) })) }, configurable: true });
  return handle;
}
const response = (value: string) => ({ ok: true, body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(value)); controller.close(); } }) });
beforeEach(() => {
  io.owner = 'owner'; io.session.mockImplementation(async () => ({ data: { session: { user: { id: io.owner }, access_token: 'fixture-session' } }, error: null }));
  io.invoke.mockResolvedValue({ data: envelope(), error: null }); fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); vi.stubEnv('VITE_SUPABASE_URL', 'https://fixture.supabase.co');
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('cliente da câmera remota privada', () => {
  it('requisições usam somente a conta atual; troca de conta invalida resposta recebida', async () => {
    const client = createStudioRemoteClient('owner'); await client.request({ action: 'create', controllerId: 'fixture-controller' });
    expect(io.invoke).toHaveBeenCalledWith('studio-camera', expect.objectContaining({ body: { action: 'create', controllerId: 'fixture-controller' }, headers: { Authorization: 'Bearer fixture-session' }, signal: expect.any(AbortSignal) }));
    io.invoke.mockImplementation(async () => { io.owner = 'other'; return { data: envelope(), error: null }; }); await expect(client.request({ action: 'status' })).rejects.toMatchObject({ code: 'account_changed' });
  });
  it('nega proprietário errado, scope cancelado e endereços externos sem executar fetch', async () => {
    const client = createStudioRemoteClient('owner'); io.owner = 'other'; await expect(client.request({ action: 'create' })).rejects.toMatchObject({ code: 'account_changed' }); expect(io.invoke).not.toHaveBeenCalled();
    io.owner = 'owner'; await expect(client.request({ action: 'create' }, { isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(client.download('https://untrusted.example/master.mp4')).rejects.toMatchObject({ code: 'invalid_download' }); expect(fetcher).not.toHaveBeenCalled();
  });
  it('expõe erro real Premium do backend sem otimizar autorização no cliente', async () => {
    const client = createStudioRemoteClient('owner'); io.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ code: 'premium_required', message: 'Este recurso faz parte do Premium.' }), { status: 403 }) } });
    await expect(client.request({ action: 'create' })).rejects.toMatchObject({ code: 'premium_required', message: 'Este recurso faz parte do Premium.' });
  });
  it('grava multipart sequencial no disco e solicita páginas quando necessário', async () => {
    const handle = opfs(), client = createStudioRemoteClient('owner'); fetcher.mockImplementation(async (target: string) => response(target.includes('part-0') ? 'ABCD' : target.includes('part-1') ? 'EFGH' : 'IJKL'));
    const first: StudioRemoteDownload = { parts: [{ url: url(0), index: 0, bytes: 4 }, { url: url(1), index: 1, bytes: 4 }], bytes: 12, mime: 'video/mp4', totalParts: 3, nextPartIndex: 2, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    const nextPage = vi.fn(async () => ({ ...first, parts: [{ url: url(2), index: 2, bytes: 4 }], nextPartIndex: null }));
    const onProgress = vi.fn(); const file = await client.download(first, { cacheKey: 'session-take', nextPage, onProgress });
    expect(file.size).toBe(12); expect(new TextDecoder().decode(content)).toBe('ABCDEFGHIJKL'); expect(commits).toBe(3); expect(handle.createWritable).toHaveBeenCalledTimes(3); expect(nextPage).toHaveBeenCalledWith(2);
    expect(onProgress.mock.calls).toEqual([[4, 12], [8, 12], [12, 12]]);
  });
  it('retry retém partes concluídas e baixa apenas partes restantes, sem concatenar RAM', async () => {
    opfs(); const client = createStudioRemoteClient('owner'); const descriptor: StudioRemoteDownload = { parts: [0, 1, 2].map(index => ({ url: url(index), index, bytes: 4 })), bytes: 12, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    let failure = true; fetcher.mockImplementation(async (target: string) => { if (target.includes('part-1') && failure) throw new Error('network interrupted'); return response(target.includes('part-0') ? 'ABCD' : target.includes('part-1') ? 'EFGH' : 'IJKL'); });
    await expect(client.download(descriptor, { cacheKey: 'session-take' })).rejects.toThrow('network interrupted'); expect(new TextDecoder().decode(content)).toBe('ABCD');
    failure = false; const onProgress = vi.fn(); const file = await client.download(descriptor, { cacheKey: 'session-take', onProgress }); expect(file.size).toBe(12); expect(new TextDecoder().decode(content)).toBe('ABCDEFGHIJKL');
    expect(fetcher.mock.calls.filter(([target]) => target.includes('part-0'))).toHaveLength(1);
    expect(onProgress.mock.calls).toEqual([[4, 12], [8, 12], [12, 12]]);
  });
  it('parte com bytes diferentes aborta escrita e mantém original parcial recuperável', async () => {
    opfs(); const client = createStudioRemoteClient('owner'); fetcher.mockResolvedValue(response('ABC')); const descriptor = { parts: [{ url: url(0), index: 0, bytes: 4 }], bytes: 4, expiresAt: new Date(Date.now() + 120_000).toISOString() };
    await expect(client.download(descriptor, { cacheKey: 'session-take' })).rejects.toMatchObject({ code: 'original_incomplete' }); expect(content.byteLength).toBe(0); expect(commits).toBe(0);
  });
  it('uma página trocada não pode ser anexada ao original já recebido', async () => {
    opfs(); const client = createStudioRemoteClient('owner'); fetcher.mockResolvedValue(response('ABCD'));
    await expect(client.download({ parts: [{ url: url(0), index: 0, bytes: 4 }], bytes: 8, nextPartIndex: 1, expiresAt: new Date(Date.now() + 120_000).toISOString() }, { nextPage: async () => ({ parts: [{ url: url(1), index: 1, bytes: 4 }], bytes: 99, nextPartIndex: null, expiresAt: new Date(Date.now() + 120_000).toISOString() }) })).rejects.toMatchObject({ code: 'invalid_download' }); expect(content.byteLength).toBe(4);
  });
  it('timeout cancela invocação pendente sem manter a tela travada', async () => {
    vi.useFakeTimers(); const client = createStudioRemoteClient('owner'); io.invoke.mockImplementation(() => new Promise(() => {}));
    const response = client.request({ action: 'create' }).catch(error => error); await vi.advanceTimersByTimeAsync(20_001); expect((await response).message).toMatch(/demorou|cancelada/); expect(vi.getTimerCount()).toBe(0);
  });
  it('renova somente os links pendentes expirados, preservando partes já recebidas', async () => {
    opfs(); content = encoder.encode('ABCD'); const client = createStudioRemoteClient('owner'); fetcher.mockResolvedValue(response('EFGH'));
    const descriptor = { parts: [0, 1].map(index => ({ url: url(index), index, bytes: 4 })), bytes: 8, nextPartIndex: null, expiresAt: new Date(Date.now() - 1).toISOString() };
    const nextPage = vi.fn(async () => ({ ...descriptor, parts: [{ url: url(1), index: 1, bytes: 4 }], expiresAt: new Date(Date.now() + 120_000).toISOString() }));
    const file = await client.download(descriptor, { cacheKey: 'same-original', nextPage }); expect(file.size).toBe(8); expect(nextPage).toHaveBeenCalledWith(1); expect(fetcher).toHaveBeenCalledTimes(1); expect(new TextDecoder().decode(content)).toBe('ABCDEFGH');
  });
  it('original longo continua além de dez minutos enquanto há progresso de leitura', async () => {
    vi.useFakeTimers(); opfs(); const client = createStudioRemoteClient('owner');
    fetcher.mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { let count = 0; const timer = setInterval(() => { controller.enqueue(encoder.encode('A')); if (++count === 40) { clearInterval(timer); controller.close(); } }, 20_000); } }) });
    const pending = client.download({ parts: [{ url: url(0), index: 0, bytes: 40 }], bytes: 40, expiresAt: new Date(Date.now() + 120_000).toISOString() }, { cacheKey: 'long-original' });
    await vi.advanceTimersByTimeAsync(800_001); const file = await pending; expect(file.size).toBe(40); expect(commits).toBe(1); expect(vi.getTimerCount()).toBe(0);
  });
  it('parte sem progresso encerra por inatividade e pode retomar seus bytes salvos', async () => {
    vi.useFakeTimers(); opfs(); const client = createStudioRemoteClient('owner'); fetcher.mockResolvedValue({ ok: true, body: new ReadableStream({ start() {} }) });
    const pending = client.download({ parts: [{ url: url(0), index: 0, bytes: 4 }], bytes: 4, expiresAt: new Date(Date.now() + 120_000).toISOString() }, { cacheKey: 'stalled-original' }).catch(error => error);
    await vi.advanceTimersByTimeAsync(30_001); expect(await pending).toMatchObject({ code: 'download_stalled' }); expect(content.byteLength).toBe(0); expect(commits).toBe(0); expect(vi.getTimerCount()).toBe(0);
  });
});
