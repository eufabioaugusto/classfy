import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { studioGrade } from '../../../../shared/studio/model';
import type { StudioRemoteResponse } from '../../../../shared/studio/remoteCamera';
import { createStudioRemoteSceneStore, recoverStudioRemoteScene, studioRemoteScreenFileName, type StudioRemoteSceneRecovery, type StudioRemoteSceneStore } from './remoteSceneRecovery';
import { studioDefaultSceneConfiguration } from './sceneTypes';
import type { StudioRemoteClient } from './remoteCameraClient';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
const raw = vi.hoisted(() => ({ file: vi.fn(), prepare: vi.fn(async () => undefined), dispose: vi.fn() }));
vi.mock('./sceneRecordingBuffer', () => ({ createStudioSceneRecordingBuffer: () => raw }));
const metadata = { kind: 'video' as const, width: 3840, height: 2160, frameRate: 30, duration: 6, hasAudio: true, mimeType: 'video/mp4', warnings: [] };
function entry(): StudioRemoteSceneRecovery {
  return { version: 1, key: 'owner:session:intent', owner: 'owner', sessionId: 'session', controllerId: 'controller', takeId: 'take', bufferId: 'raw-buffer', screenMime: 'video/webm', title: 'Aula', createdAt: 1, status: 'recoverable', output: { width: 3840, height: 2160, frameRate: 30 }, startedAtServerMs: 100000, screenStartedAtServerMs: 100250, cameraOffsetSeconds: .25, events: [{ atSeconds: 0, scene: 'camera', configuration: studioDefaultSceneConfiguration(), grade: studioGrade(), zoom: 1 }] };
}
function fixture(withFiles = true) {
  let saved = entry(); const screen = new File(['screen-raw'], 'raw.webm'), camera = new File(['native'], 'native.mp4');
  if (withFiles) Object.assign(saved, { screenFile: screen, cameraFile: camera, screenMetadata: { ...metadata, duration: 5 }, cameraMetadata: metadata, take: { id: 'take', status: 'uploaded', metadata: { bytes: camera.size, width: 3840, height: 2160, fps: 30, duration: 6, mime: 'video/mp4' } } });
  const writes: StudioRemoteSceneRecovery[] = [], store: StudioRemoteSceneStore = { get: vi.fn(async () => saved), list: vi.fn(async () => [saved]), save: vi.fn(async value => { saved = { ...value }; writes.push(saved); }) };
  const response = { session: { id: 'session', activeTakeId: 'take', kind: 'aula', controllerId: 'controller' }, takes: [{ id: 'take', status: 'uploaded', metadata: { bytes: camera.size, width: 3840, height: 2160, fps: 30, duration: 6, mime: 'video/mp4' } }], download: { parts: [], bytes: camera.size, nextPartIndex: null }, commands: [], serverAt: '' } as unknown as StudioRemoteResponse;
  const client: StudioRemoteClient = { request: vi.fn(async () => response), download: vi.fn(async () => camera) };
  const inspect = vi.fn(async () => metadata), output = new File(['composed'], 'Final.mp4'), render = vi.fn(async () => output);
  return { store, client, inspect, render, output, screen, camera, writes, saved: () => saved };
}
afterEach(() => { raw.file.mockReset(); raw.dispose.mockClear(); vi.clearAllMocks(); });
describe('recuperação durável das cenas remotas', () => {
  it('IndexedDB separa contas e impede acesso à chave de outroowner', async () => {
    const store = createStudioRemoteSceneStore(new IDBFactory(), `recovery-${crypto.randomUUID()}`), first = entry(); await store.save(first); await store.save({ ...first, key: 'other:session:intent', owner: 'other' });
    expect((await store.list('owner')).map(value => value.key)).toEqual([first.key]); await expect(store.get('other', first.key)).rejects.toThrow('outra conta'); expect((await store.get('owner', first.key))!.bufferId).toBe('raw-buffer');
  });
  it('falha deexport preserva ambosoriginais e retry retorna mesmoarquivo sem novoREC', async () => {
    const h = fixture(); h.render.mockRejectedValueOnce(new Error('Encoder ocupado'));
    await expect(recoverStudioRemoteScene('owner', entry().key, h)).rejects.toThrow('Encoder ocupado'); expect(h.saved()).toMatchObject({ status: 'recoverable', cameraFile: h.camera, screenFile: h.screen }); expect(h.client.request).not.toHaveBeenCalled();
    expect(await recoverStudioRemoteScene('owner', entry().key, h)).toBe(h.output); expect(await recoverStudioRemoteScene('owner', entry().key, h)).toBe(h.output); expect(h.render).toHaveBeenCalledTimes(2); expect(h.saved().status).toBe('complete');
  });
  it('recebe masterprivado mesmo sem tela/ACK e oferece originalsem inventar montagem', async () => {
    const h = fixture(false); h.saved().takeId = null; h.saved().startedAtServerMs = null; raw.file.mockRejectedValueOnce(new Error('Tela incompleta'));
    await expect(recoverStudioRemoteScene('owner', entry().key, h)).rejects.toThrow('Tela incompleta'); expect(h.saved().cameraFile?.size).toBe(h.camera.size); expect(h.saved().takeId).toBe('take'); expect(h.render).not.toHaveBeenCalled(); expect(h.client.request).toHaveBeenCalledWith(expect.objectContaining({ action: 'download', clientId: 'controller', partStart: 0, partCount: 100 }), expect.anything()); expect(raw.dispose).not.toHaveBeenCalled();
  });
  it('limitação decodec preserva bytes nativos antes de falharinspect', async () => {
    const h = fixture(false); raw.file.mockResolvedValue(h.screen); h.inspect.mockRejectedValue(new Error('HEVC indisponível'));
    await expect(recoverStudioRemoteScene('owner', entry().key, h)).rejects.toThrow('HEVC'); expect(h.saved().cameraFile?.size).toBe(h.camera.size); expect(h.saved().screenFile).toBe(h.screen); expect(h.render).not.toHaveBeenCalled();
  });
  it('cancelado não publica take e mantém arquivos já recebidos', async () => {
    const h = fixture(), controller = new AbortController(); h.render.mockImplementation(async () => { controller.abort(); return h.output; });
    await expect(recoverStudioRemoteScene('owner', entry().key, { ...h, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(h.saved()).toMatchObject({ status: 'recoverable', cameraFile: h.camera, screenFile: h.screen }); expect(h.saved().outputFile).toBeUndefined();
  });
  it('rejeita outroowner antesrede ou IDB', async () => { const h = fixture(); await expect(recoverStudioRemoteScene('other', entry().key, h)).rejects.toThrow('outra conta'); expect(h.store.get).not.toHaveBeenCalled(); expect(h.client.request).not.toHaveBeenCalled(); });
  it('preserva MOV/MIME nativo e extensão da tela negociada sem renomear bytesMP4', async () => {
    const h = fixture(false); raw.file.mockResolvedValue(h.screen); const response = await h.client.request({ action: 'status' }); response.takes[0].metadata!.mime = 'video/quicktime';
    h.render.mockRejectedValueOnce(new Error('Sem sync')); await expect(recoverStudioRemoteScene('owner', entry().key, h)).rejects.toThrow('Sem sync');
    expect(h.saved().cameraFile).toMatchObject({ name: 'iPhone original Classfy.mov', type: 'video/quicktime' }); expect(studioRemoteScreenFileName('video/mp4;codecs=avc1')).toBe('Tela original Classfy.mp4'); expect(studioRemoteScreenFileName('video/webm;codecs=vp9,opus')).toBe('Tela original Classfy.webm');
  });
});
