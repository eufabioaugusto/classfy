import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioRemoteLocalTakeView, StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import { StudioRemoteLocalTakes } from './StudioRemoteLocalTakes';

const thumbnail = { version: 1 as const, hash: 'a'.repeat(64), bytes: 1200, mime: 'image/jpeg' as const, width: 240, height: 135 };
const raw = { bytes: 123456789, mime: 'video/quicktime', width: 3840, height: 2160, fps: 30, duration: 66 };
function view(rows?: StudioRemoteLocalTakeView[]): StudioRemoteView {
  return { connection: 'connected', pairing: null, transfer: 'idle', transferTakeId: null, pendingTakeId: null, error: null,
    session: { id: 'phone-session' } as StudioRemoteView['session'],
    localTakes: rows ?? [{ id: 'phone-take', sessionId: 'phone-session', metadata: raw, sourceMetadata: raw, localSaved: true, phase: 'local_ready', thumbnail }],
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let root: Root, host: HTMLDivElement;
const download = vi.fn(), importFile = vi.fn(), getThumbnail = vi.fn<(take: string, session: string) => Promise<string | null>>(), revoke = vi.fn();
async function render(state = view(), props: { owner?: string; savedIds?: Set<string>; disabled?: boolean; recording?: boolean; savingId?: string | null; getter?: typeof getThumbnail } = {}) {
  await act(async () => root.render(<StudioRemoteLocalTakes owner={props.owner ?? 'owner'} state={state} savedIds={props.savedIds ?? new Set()} disabled={props.disabled ?? false} recording={props.recording ?? false} savingId={props.savingId} onDownload={download} onImport={importFile} getThumbnail={props.getter ?? getThumbnail} />));
}
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === name || node.textContent?.trim() === name)!;
async function click(name: string) { expect(button(name)).toBeTruthy(); await act(async () => button(name).click()); }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); download.mockReset(); importFile.mockReset(); getThumbnail.mockReset().mockResolvedValue('https://private.example/signed-thumbnail'); revoke.mockReset(); vi.stubGlobal('URL', Object.assign(class extends URL {}, { revokeObjectURL: revoke })); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('minicards de originais do iPhone', () => {
  it('mostra miniatura real e duração; uma ação Baixar inicia a transferência vinculada pelo ID', async () => {
    await render(); expect(getThumbnail.mock.calls).toEqual([['phone-take', 'phone-session']]); expect(host.querySelector('img')?.getAttribute('src')).toBe('https://private.example/signed-thumbnail'); expect(host.querySelector('.se-recording-phone-take-duration')?.textContent).toBe('1:06');
    expect(host.querySelector('article')?.textContent).toContain('No iPhone'); expect(host.querySelectorAll('.se-recording-phone-take-download')).toHaveLength(1); expect(host.textContent).not.toContain('Enviar ao computador');
    await click('Baixar take 1'); expect(download.mock.calls).toEqual([['phone-take']]); expect(importFile).not.toHaveBeenCalled();
  });
  it('estado confirmado No projeto conserva Baixar local, inclusive sem descriptor em app antigo', async () => {
    const state = view(); delete state.localTakes![0].thumbnail; getThumbnail.mockResolvedValue('blob:local-original-thumbnail');
    await render(state, { savedIds: new Set(['phone-take']), recording: true }); expect(host.querySelector('.is-saved')?.textContent).toContain('No projeto'); expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:local-original-thumbnail');
    await click('Baixar take 1'); expect(download.mock.calls).toEqual([['phone-take']]); expect(importFile).not.toHaveBeenCalled();
  });
  it('AirDrop fica no menu secundário, conserva takeId, recebe foco e fecha por Escape', async () => {
    await render(); expect(button('Importar original recebido do take 1')).toBeUndefined(); await click('Mais opções do take 1');
    expect(host.querySelector('[role="menu"]')).toBeTruthy(); expect(document.activeElement).toBe(button('Importar original recebido do take 1'));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); expect(host.querySelector('[role="menu"]')).toBeNull(); expect(document.activeElement).toBe(button('Mais opções do take 1'));
    await click('Mais opções do take 1'); await click('Importar original recebido do take 1'); expect(importFile.mock.calls).toEqual([['phone-take']]); expect(download).not.toHaveBeenCalled(); expect(host.querySelector('[role="menu"]')).toBeNull();
  });
  it('importação geral continua discreta e funciona sem câmera, sessão ou catálogo', async () => {
    const state = view([]); state.session = null; await render(state); await click('Importar original recebido'); expect(importFile).toHaveBeenCalledOnce(); expect(importFile.mock.calls[0]).toEqual([]); expect(getThumbnail).not.toHaveBeenCalled(); expect(host.querySelector('article')).toBeNull();
  });
  it('original de conexão anterior usa Adicionar arquivo com contexto explícito e nunca dispara envio', async () => {
    const state = view(); state.localTakes![0].sessionId = 'old-session'; await render(state, { recording: true }); expect(host.textContent).toContain('No iPhone · conexão anterior'); expect(button('Baixar take 1')).toBeUndefined();
    await click('Adicionar arquivo do take 1'); expect(importFile.mock.calls).toEqual([['phone-take']]); expect(download).not.toHaveBeenCalled();
  });
  it('REC bloqueia envio novo, mas original já enviado pode baixar; processo em curso mantém estado sem novo comando', async () => {
    const state = view(); await render(state, { recording: true }); expect(button('Baixar take 1').disabled).toBe(true); await click('Baixar take 1'); expect(download).not.toHaveBeenCalled();
    state.localTakes![0].phase = 'uploaded'; await render(state, { recording: true }); expect(button('Baixar take 1').disabled).toBe(false); await click('Baixar take 1'); expect(download).toHaveBeenCalledOnce();
    state.transferTakeId = 'phone-take'; state.transfer = 'uploading'; state.transferBytes = 50; state.transferTotalBytes = 100; await render(state, { recording: true }); expect(host.textContent).toContain('Enviando do iPhone… 50%'); expect(button('Baixar take 1').disabled).toBe(true); expect(host.querySelector('progress')?.value).toBe(50);
    state.transfer = 'downloading'; state.transferBytes = 25; await render(state, { recording: true }); expect(host.textContent).toContain('Baixando para o computador… 25%'); expect(host.textContent).not.toContain('Enviando do iPhone'); expect(download).toHaveBeenCalledOnce();
  });
  it('retry mostra erro e repete só Baixar; não oferece ação duplicada por ícone', async () => {
    const state = view(); state.transferTakeId = 'phone-take'; state.transfer = 'retry'; state.error = 'Conexão pausada. O original continua no iPhone.'; await render(state); expect(host.querySelector('[role="alert"]')?.textContent).toContain('Conexão pausada'); await click('Baixar take 1'); expect(download.mock.calls).toEqual([['phone-take']]); expect(host.querySelectorAll('.se-recording-phone-take-download')).toHaveLength(1);
  });
  it('preparação/salvamento ocupa o card sem afirmar No projeto antes do append confirmado', async () => {
    const state = view(); state.transferTakeId = 'phone-take'; state.transfer = 'validating'; await render(state); expect(host.textContent).toContain('Conferindo original'); expect(host.querySelector('.is-saved')).toBeNull(); expect(host.querySelector('article')?.getAttribute('aria-busy')).toBe('true');
    await render(state, { savingId: 'phone-take' }); expect(host.textContent).toContain('Adicionando ao projeto'); expect(button('Baixar take 1').disabled).toBe(true); expect(button('Mais opções do take 1').disabled).toBe(true);
  });
  it('descriptor ausente/inválido, fetch falho ou decode falho mantém placeholder honesto', async () => {
    const state = view(); delete state.localTakes![0].thumbnail; await render(state); expect(getThumbnail).not.toHaveBeenCalled(); expect(host.querySelector('img')).toBeNull();
    state.localTakes![0].thumbnail = { ...thumbnail, bytes: 16385 }; await render(state); expect(getThumbnail).not.toHaveBeenCalled();
    state.localTakes![0].thumbnail = thumbnail; getThumbnail.mockRejectedValueOnce(Error('Sem miniatura')); await render(state); expect(host.querySelector('img')).toBeNull();
    state.localTakes![0].thumbnail = { ...thumbnail, hash: 'b'.repeat(64) }; await render(state); expect(host.querySelector('img')).toBeTruthy(); await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error'))); expect(host.querySelector('img')).toBeTruthy();
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error'))); expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('[aria-label="Miniatura indisponível"]')).toBeTruthy(); expect(getThumbnail).toHaveBeenCalledTimes(3);
  });
  it('renova uma vez a URL privada expirada de imagem lazy sem baixar o original', async () => {
    getThumbnail.mockResolvedValueOnce('https://private.example/expired').mockResolvedValueOnce('https://private.example/renewed');
    await render(); expect(host.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error'))); expect(host.querySelector('img')?.getAttribute('src')).toBe('https://private.example/renewed'); expect(getThumbnail.mock.calls).toEqual([['phone-take', 'phone-session'], ['phone-take', 'phone-session']]);
    expect(download).not.toHaveBeenCalled(); expect(importFile).not.toHaveBeenCalled(); expect(revoke).not.toHaveBeenCalled();
    await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error'))); expect(host.querySelector('img')).toBeNull(); expect(getThumbnail).toHaveBeenCalledTimes(2);
  });
  it('renovação atrasada não substitui miniatura de outra conta e libera seu blob', async () => {
    const retry = deferred<string | null>(); getThumbnail.mockResolvedValueOnce('blob:expired').mockReturnValueOnce(retry.promise).mockResolvedValueOnce('blob:current-owner');
    await render(); await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error'))); expect(revoke).toHaveBeenCalledWith('blob:expired');
    await render(view(), { owner: 'new-owner' }); expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:current-owner');
    await act(async () => retry.resolve('blob:old-owner-retry')); expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:current-owner'); expect(revoke).toHaveBeenCalledWith('blob:old-owner-retry'); expect(download).not.toHaveBeenCalled();
  });
  it('heartbeat não refaz fetch e troca de conta descarta URL/resposta anterior, revogando somente blobs próprios', async () => {
    const state = view(), old = deferred<string | null>(); getThumbnail.mockReturnValueOnce(old.promise); await render(state); state.transferBytes = 3; await render(state); expect(getThumbnail).toHaveBeenCalledTimes(1);
    getThumbnail.mockResolvedValueOnce('blob:new-owner'); await render(state, { owner: 'other-owner' }); expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:new-owner');
    await act(async () => old.resolve('blob:old-owner')); expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:new-owner'); expect(revoke).toHaveBeenCalledWith('blob:old-owner');
    await render(state, { owner: 'third-owner' }); expect(revoke).toHaveBeenCalledWith('blob:new-owner'); await act(async () => root.unmount()); expect(revoke.mock.calls.flat().filter(url => url.startsWith('https:'))).toEqual([]); root = createRoot(host);
  });
});
