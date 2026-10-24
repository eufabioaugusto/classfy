import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadStudioOriginal } from './originalDownload';

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:private-original') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
describe('cópia do original sem duplicar a transferência', () => {
  it('passa o Blob já confirmado ao navegador sem ler seus bytes ou montar outro arquivo', () => {
    const original = new File(['existing-disk-backed-video'], 'take.mov', { type: 'video/quicktime' });
    const read = vi.fn(() => { throw Error('Não ler o original inteiro'); }), anchors: HTMLAnchorElement[] = [];
    Object.defineProperty(original, 'arrayBuffer', { value: read });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { anchors.push(this); });
    downloadStudioOriginal(original, '../take.mov');
    expect(URL.createObjectURL).toHaveBeenCalledWith(original); expect(read).not.toHaveBeenCalled();
    expect(anchors).toHaveLength(1); expect(anchors[0].download).toBe('..-take.mov'); expect(anchors[0].href).toBe('blob:private-original');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); vi.advanceTimersByTime(60_000); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-original');
  });
  it('libera sua URL quando o navegador rejeita iniciar o download', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw Error('Download bloqueado'); });
    expect(() => downloadStudioOriginal(new Blob(['original']), 'take.mp4')).toThrow('Download bloqueado');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-original'); expect(vi.getTimerCount()).toBe(0);
  });
});
