import type { StudioSignature } from './model';
import type { StudioSceneSample } from './autoEnhance';

export type StudioSignatureSample = { subject: StudioSceneSample | null; background: StudioSceneSample | null; personPresent: boolean; facePresent: boolean };
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); const half = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2; };

/** Fixed Classfy direction, adaptive subject/background corrections. Never use dark clothing to expose a face. */
export function suggestStudioSignature(samples: readonly StudioSignatureSample[]): StudioSignature {
  if (!samples.length || samples.length > 24) throw new Error('A análise desta cena está incompleta.');
  for (const sample of samples) for (const region of [sample.subject, sample.background]) {
    if (region && Object.values(region).some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('A análise da pessoa e do fundo não foi confirmada.');
  }
  const detected = samples.filter(sample => sample.personPresent && sample.subject);
  if (detected.length < Math.ceil(samples.length / 3)) throw new Error('Não consegui destacar uma pessoa neste trecho. Escolha uma cena em que o creator esteja visível.');
  const faces = detected.filter(sample => sample.facePresent);
  const subjects = (faces.length ? faces : detected).map(sample => sample.subject!);
  const mid = median(subjects.map(sample => sample.p50)), peak = median(subjects.map(sample => sample.p99));
  const target = faces.length ? .47 : .4;
  const subjectExposure = clamp(Math.log2(target / Math.max(.08, mid)), -.3, Math.min(.85, Math.log2(.98 / Math.max(.05, peak))));
  const backgrounds = samples.filter(sample => sample.personPresent && sample.background).map(sample => sample.background!);
  const backgroundMid = backgrounds.length ? median(backgrounds.map(sample => sample.p50)) : .45;
  const backgroundExposure = clamp(Math.log2(.18 / Math.max(.04, backgroundMid)), -1.8, -.25);
  return { version: 1, strength: .85, subjectExposure, backgroundExposure, backgroundBlur: .28, temperature: .18 };
}

/** Same six-knot authorial curve in WebGL and Core Image; preserves black and softens bright skin. */
export function studioSignatureTone(value: number) {
  const x = [0, .12, .25, .5, .75, 1], y = [0, .085, .225, .515, .775, .97], v = clamp(value);
  const index = v < .12 ? 0 : v < .25 ? 1 : v < .5 ? 2 : v < .75 ? 3 : 4;
  return y[index] + (y[index + 1] - y[index]) * (v - x[index]) / (x[index + 1] - x[index]);
}

/** Reduced-mask geometry is normalized to the oriented original, before any crop/flip/transform. */
export function studioSignatureFaceKey(u: number, v: number, face?: { x: number; y: number; width: number; height: number } | null) {
  if (!face || face.width <= 0 || face.height <= 0) return 0;
  const x = (u - face.x) / (face.width * .6), y = (v - face.y) / (face.height * .7);
  const radius = Math.hypot(x, y), t = clamp((radius - .55) / .57), feather = 1 - t * t * (3 - 2 * t);
  const direction = clamp(.6 - .22 * x - .16 * y, .18, 1);
  return feather * (.7 + .3 * direction);
}

/** BackgroundRGB is a normalized blur excluding subject pixels, not a full-frame blur. */
export function studioSignaturePixel(rgb: readonly number[], person: number, faceKey: number, signature: StudioSignature, backgroundRGB: readonly number[] = rgb): number[] {
  if (signature.strength === 0) return [...rgb];
  const mask = clamp(person), key = clamp(faceKey) * mask;
  const foreground = rgb.map((value, channel) => studioSignatureTone(value * 2 ** (signature.subjectExposure * (.18 + .82 * key))
    * (channel === 0 ? 1 + signature.temperature * .05 * key : channel === 2 ? 1 - signature.temperature * .04 * key : 1)));
  const background = backgroundRGB.map((value, channel) => studioSignatureTone(value * 2 ** signature.backgroundExposure * (channel === 0 ? .99 : channel === 2 ? 1.015 : 1)));
  const color = (values: number[], saturation: number) => { const luma = values[0] * .2126 + values[1] * .7152 + values[2] * .0722; return values.map(value => luma + (value - luma) * saturation); };
  const fg = color(foreground, .97), bg = color(background, .88);
  return rgb.map((value, channel) => clamp(value + ((bg[channel] * (1 - mask) + fg[channel] * mask) - value) * signature.strength));
}
