import { describe, expect, it } from 'vitest';
import { remoteCameraFocusPoint } from './remoteCameraFocusPoint';

const rect = { left: 30, top: 20, width: 1000, height: 1000 };
describe('foco do iPhone na imagem exibida', () => {
  it('ignora barras horizontais e transforma um ponto na imagem 16:9', () => {
    const base = { rect, imageWidth: 1920, imageHeight: 1080 };
    expect(remoteCameraFocusPoint({ ...base, clientX: 530, clientY: 120 })).toBeNull();
    const point = remoteCameraFocusPoint({ ...base, clientX: 280, clientY: 520 })!; expect(point.x).toBeCloseTo(.25); expect(point.y).toBe(.5);
    expect(remoteCameraFocusPoint({ ...base, clientX: 530, clientY: 900 })).toBeNull();
  });
  it('ignora barras laterais, respeita retrato e desfaz espelhamento só no eixo horizontal', () => {
    const base = { rect, imageWidth: 1080, imageHeight: 1920 };
    expect(remoteCameraFocusPoint({ ...base, clientX: 130, clientY: 520 })).toBeNull();
    const point = remoteCameraFocusPoint({ ...base, clientX: 389.375, clientY: 270 })!; expect(point.x).toBe(.25); expect(point.y).toBeCloseTo(.25);
    const mirror = remoteCameraFocusPoint({ ...base, clientX: 389.375, clientY: 270, mirrored: true })!; expect(mirror.x).toBe(.75); expect(mirror.y).toBeCloseTo(.25);
  });
  it('mapeia cover ao trecho visível da imagem e não ao quadro recortado inteiro', () => {
    const base = { rect: { left: 0, top: 0, width: 900, height: 1600 }, imageWidth: 1920, imageHeight: 1080, fit: 'cover' as const };
    const left = remoteCameraFocusPoint({ ...base, clientX: 0, clientY: 800 })!;
    expect(left.x).toBeCloseTo(.341796875); expect(left.y).toBe(.5);
    expect(remoteCameraFocusPoint({ ...base, clientX: 450, clientY: 800 })).toEqual({ x: .5, y: .5 });
  });
  it('aguarda dimensões reais do vídeo e rejeita geometria inválida ou gesto fora da prévia', () => {
    const base = { rect, imageWidth: 0, imageHeight: 0, clientX: 530, clientY: 520 };
    expect(remoteCameraFocusPoint(base)).toBeNull();
    expect(remoteCameraFocusPoint({ ...base, imageWidth: 1920, imageHeight: 1080, clientX: 29 })).toBeNull();
    expect(remoteCameraFocusPoint({ ...base, imageWidth: NaN, imageHeight: 1080 })).toBeNull();
  });
});
