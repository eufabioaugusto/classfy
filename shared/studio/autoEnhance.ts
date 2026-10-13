import type { StudioEnhancement } from './model';

export type StudioSceneSample = {
  p10: number; p50: number; p90: number; p99: number; saturation: number;
  neutralRed: number; neutralGreen: number; neutralBlue: number; neutralFraction: number;
};
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (lo: number, hi: number, v: number) => { const t = clamp((v - lo) / (hi - lo)); return t * t * (3 - 2 * t); };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2; };

/** Small SDR frames only. Neutral pixels limit gray-world color casts on colorful scenes. */
export function measureStudioScene(rgba: ArrayLike<number>): StudioSceneSample {
  const histogram = new Uint32Array(256); let count = 0, saturation = 0, neutral = 0, red = 0, green = 0, blue = 0;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const r = rgba[i] / 255, g = rgba[i + 1] / 255, b = rgba[i + 2] / 255;
    const y = r * .2126 + g * .7152 + b * .0722, maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
    const s = maximum > .001 ? (maximum - minimum) / maximum : 0;
    histogram[Math.round(clamp(y) * 255)]++; count++; saturation += s;
    if (s < .22 && y > .12 && y < .88) { neutral++; red += r; green += g; blue += b; }
  }
  if (!count) throw new Error('A cena não contém pixels visíveis para analisar.');
  const percentile = (fraction: number) => { let sum = 0; for (let i = 0; i < 256; i++) { sum += histogram[i]; if (sum >= count * fraction) return i / 255; } return 1; };
  return { p10: percentile(.1), p50: percentile(.5), p90: percentile(.9), p99: percentile(.99), saturation: saturation / count,
    neutralRed: neutral ? red / neutral : 0, neutralGreen: neutral ? green / neutral : 0, neutralBlue: neutral ? blue / neutral : 0, neutralFraction: neutral / count };
}

/** One stable correction per selected clip; never pump exposure while playing. */
export function suggestStudioEnhancement(samples: readonly StudioSceneSample[]): StudioEnhancement {
  if (!samples.length || samples.length > 24 || samples.some(sample => Object.values(sample).some(value => !Number.isFinite(value) || value < 0 || value > 1))) throw new Error('A análise da cena está incompleta.');
  const mid = median(samples.map(s => s.p50)), low = median(samples.map(s => s.p10)), high = median(samples.map(s => s.p90)), peak = median(samples.map(s => s.p99));
  // Preserve near-white faces/windows; lift shadow detail instead of sacrificing highlights.
  const exposure = clamp(Math.log2(.43 / Math.max(.08, mid)), -.7, Math.min(.9, Math.log2(1.02 / Math.max(.05, peak))));
  const spread = high - low;
  const neutrals = samples.filter(s => s.neutralFraction >= .025);
  const temperature = neutrals.length >= Math.ceil(samples.length / 2) ? clamp(median(neutrals.map(s => (s.neutralBlue - s.neutralRed) / Math.max(.12, (s.neutralBlue + s.neutralRed) / 2))) * 2.4, -.65, .65) : 0;
  const tint = neutrals.length >= Math.ceil(samples.length / 2) ? clamp(median(neutrals.map(s => ((s.neutralRed + s.neutralBlue) / 2 - s.neutralGreen) / Math.max(.12, s.neutralGreen))) * 3, -.5, .5) : 0;
  const sat = median(samples.map(s => s.saturation));
  return { version: 1, strength: .8, analyzedFrames: samples.length, exposure,
    contrast: clamp((.65 - spread) * .7, -.25, .25), saturation: sat > .65 ? -.16 : sat < .12 ? .08 : .025,
    temperature, tint, shadows: clamp((.16 - low * 2 ** exposure) * 2.2, 0, .42), highlights: clamp((.86 - peak * 2 ** exposure) * 2, -.8, 0) };
}

/** Identical equations in the WebGL shader and native Core Image kernel. RGB is SDR display encoded. */
export function studioEnhancementPixel(rgb: readonly number[], look?: StudioEnhancement): number[] {
  if (!look || look.strength === 0) return [...rgb];
  const e = rgb.map((v, i) => v * 2 ** look.exposure * (i === 0 ? 1 + look.temperature * .08 : i === 1 ? 1 + look.tint * .06 : 1 - look.temperature * .08));
  const y = e[0] * .2126 + e[1] * .7152 + e[2] * .0722;
  const lift = look.shadows * .14 * (1 - smooth(.05, .65, y)) + look.highlights * .14 * smooth(.5, 1, y);
  const corrected = e.map(v => (v + lift - .42) * (1 + look.contrast * .25) + .42);
  const luma = corrected[0] * .2126 + corrected[1] * .7152 + corrected[2] * .0722;
  return corrected.map((v, i) => clamp(rgb[i] + (luma + (v - luma) * (1 + look.saturation * .4) - rgb[i]) * look.strength));
}
