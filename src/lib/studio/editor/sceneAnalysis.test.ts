import { describe, expect, it } from 'vitest';
import { measureStudioScene, studioEnhancementPixel, suggestStudioEnhancement } from '../../../../shared/studio/autoEnhance';
import { studioAnalysisTimes } from './sceneAnalysis';

const pixels = (rgb: number[]) => new Uint8ClampedArray(Array.from({ length: 64 }, () => [...rgb, 255]).flat());
describe('Melhoria de cena medida no original', () => {
  it('levanta uma cena subexposta e reduz uma cena clara com parâmetros diferentes', () => {
    const dark = suggestStudioEnhancement([measureStudioScene(pixels([40, 40, 40]))]);
    const bright = suggestStudioEnhancement([measureStudioScene(pixels([224, 224, 224]))]);
    expect(dark.exposure).toBeGreaterThan(0); expect(bright.exposure).toBeLessThan(0);
    expect(studioEnhancementPixel([40 / 255, 40 / 255, 40 / 255], dark)[0]).toBeGreaterThan(40 / 255);
    expect(studioEnhancementPixel([224 / 255, 224 / 255, 224 / 255], bright)[0]).toBeLessThan(224 / 255);
  });
  it('corrige dominante de branco, sem neutralizar objetos coloridos', () => {
    const warm = suggestStudioEnhancement([measureStudioScene(pixels([160, 154, 140]))]);
    const red = suggestStudioEnhancement([measureStudioScene(pixels([220, 30, 20]))]);
    expect(warm.temperature).toBeLessThan(0); expect(red.temperature).toBe(0); expect(red.tint).toBe(0);
  });
  it('usa mediana para não deixar um quadro isolado alterar toda a cena', () => {
    const standard = measureStudioScene(pixels([110, 110, 110])), flash = measureStudioScene(pixels([255, 255, 255]));
    const a = suggestStudioEnhancement([standard, standard, standard]), b = suggestStudioEnhancement([standard, flash, standard]);
    expect(b).toEqual(a);
  });
  it('protege as áreas claras de um rosto sobre fundo escuro', () => {
    const sample = { ...measureStudioScene(pixels([32, 32, 32])), p90: .75, p99: .95 };
    const look = suggestStudioEnhancement([sample]);
    expect(look.exposure).toBeLessThan(.11); expect(look.shadows).toBeGreaterThan(0);
    expect(studioEnhancementPixel([.95, .95, .95], look)[0]).toBeLessThan(.99);
  });
  it('preserva identidade em zero, limita saída e mantém ordenação tonal neutra', () => {
    const look = suggestStudioEnhancement([measureStudioScene(pixels([64, 64, 64]))]);
    const rgb = [.12, .42, .65]; expect(studioEnhancementPixel(rgb, { ...look, strength: 0 })).toEqual(rgb);
    const output = Array.from({ length: 256 }, (_, i) => studioEnhancementPixel([i / 255, i / 255, i / 255], look)[0]);
    output.forEach((v, i) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); if (i) expect(v).toBeGreaterThanOrEqual(output[i - 1]); });
  });
  it('amostra somente o intervalo do original, inclusive com corte', () => {
    const times = studioAnalysisTimes({ kind: 'video', sourceStartTicks: 8 * 120000, sourceEndTicks: 12 * 120000 }, 120000);
    expect(times).toHaveLength(8); expect(times[0]).toBeGreaterThan(8); expect(times.at(-1)).toBeLessThan(12);
    expect(studioAnalysisTimes({ kind: 'image', sourceStartTicks: 0, sourceEndTicks: 0 }, 120000)).toEqual([0]);
  });
  it('recusa análise vazia ou não finita antes de modificar receita', () => {
    expect(() => measureStudioScene(new Uint8Array(4))).toThrow();
    expect(() => suggestStudioEnhancement([])).toThrow();
    expect(() => suggestStudioEnhancement([{ ...measureStudioScene(pixels([10, 20, 30])), p50: NaN }])).toThrow();
  });
});
