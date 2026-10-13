import { describe, expect, it } from 'vitest';
import { studioPortraitV2Amount, studioPortraitV2Pixel, studioPortraitV2Radius, studioPortraitV2Target } from './portraitLook';

describe('retoque v2 de luminância em três raios', () => {
  it('máximo é forte e os valores naturais conservam uma curva gradual', () => {
    expect(studioPortraitV2Radius(1000)).toBe(18);
    expect(studioPortraitV2Radius(20)).toBe(1.25);
    expect(studioPortraitV2Amount(1)).toBe(1);
    expect(studioPortraitV2Amount(.45) / studioPortraitV2Amount(1)).toBeCloseTo(.30187, 4);
    const rgb = [.4,.3,.2], full = studioPortraitV2Pixel(rgb, 1, 1, 1), natural = studioPortraitV2Pixel(rgb, 1, 1, .4);
    expect(full[0] - rgb[0]).toBeCloseTo(.14);
    expect(natural[0] - rgb[0]).toBeCloseTo(.14 * Math.pow(.4, 1.5));
  });
  it('regiões protegidas são identidade e o delta conserva diferenças RGB sem estourar gamut', () => {
    for (const rgb of [[.02,.01,0],[.4,.3,.2],[1,.9,.8]]) {
      expect(studioPortraitV2Pixel(rgb, .8, 0, 1)).toEqual(rgb);
      expect(studioPortraitV2Pixel(rgb, .8, 1, 0)).toEqual(rgb);
      for (const target of [0,1]) {
        const pixel = studioPortraitV2Pixel(rgb, target, 1, 1);
        expect(pixel.every(value => value >= 0 && value <= 1)).toBe(true);
        expect(pixel[0]-pixel[1]).toBeCloseTo(rgb[0]-rgb[1]);
        expect(pixel[1]-pixel[2]).toBeCloseTo(rgb[1]-rgb[2]);
      }
    }
  });
  it('bilateral reduz textura local sem misturar uma borda de grande contraste', () => {
    expect(studioPortraitV2Target(.4, Array.from({length:3},()=>Array(8).fill(.4)))).toBeCloseTo(.4);
    const texture = studioPortraitV2Target(.4, Array.from({length:3},()=>Array(8).fill(.46)));
    expect(texture).toBeGreaterThan(.44); expect(texture).toBeLessThan(.46);
    const edge = studioPortraitV2Target(.4, Array.from({length:3},()=>Array(8).fill(.95)));
    expect(Math.abs(edge-.4)).toBeLessThan(.000001);
    expect(()=>studioPortraitV2Target(.4, [[.4]])).toThrow('incompletas');
  });
});
