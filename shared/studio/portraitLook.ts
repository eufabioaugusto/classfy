/** Portrait v2: SDR luminance-only texture reduction. v1 remains a separate, unchanged renderer. */
export const STUDIO_PORTRAIT_V2 = Object.freeze({
  sigma: .09, radiusFactor: .018, minimumRadius: 1.25,
  radiusScales: [.5, 1, 1.8] as const, bandWeights: [.55, .3, .15] as const,
  maximumDelta: .14, mix: 1,
});
export function studioPortraitV2Radius(faceWidthPixels: number) {
  return Math.max(STUDIO_PORTRAIT_V2.minimumRadius, faceWidthPixels * STUDIO_PORTRAIT_V2.radiusFactor);
}
export function studioPortraitV2Amount(strength: number) { return STUDIO_PORTRAIT_V2.mix * Math.pow(strength, 1.5); }
/** Three bands, each with cardinal then diagonal neighbours; centre spatial weight is1. */
export function studioPortraitV2Target(center: number, bands: readonly (readonly number[])[]) {
  if (bands.length !== 3 || bands.some(band => band.length !== 8)) throw new Error('As amostras de textura do retrato estão incompletas.');
  return bands.reduce((target, band, index) => {
    let sum = center, weight = 1;
    band.forEach((value, tap) => {
      const delta = value - center, w = (tap < 4 ? .75 : .5) * Math.exp(-delta * delta / (2 * STUDIO_PORTRAIT_V2.sigma ** 2));
      sum += value * w; weight += w;
    });
    return target + sum / weight * STUDIO_PORTRAIT_V2.bandWeights[index];
  }, 0);
}
export function studioPortraitV2Pixel(rgb: readonly number[], targetLuminance: number, mask: number, strength: number) {
  if (strength === 0 || mask === 0) return [...rgb];
  const center = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const requested = Math.max(-STUDIO_PORTRAIT_V2.maximumDelta, Math.min(STUDIO_PORTRAIT_V2.maximumDelta, targetLuminance - center))
    * studioPortraitV2Amount(strength) * mask;
  const delta = Math.max(-Math.min(...rgb), Math.min(1 - Math.max(...rgb), requested));
  return rgb.map(value => value + delta);
}
