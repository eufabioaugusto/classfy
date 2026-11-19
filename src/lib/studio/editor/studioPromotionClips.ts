import { studioRequiredFeatures, studioSeconds, studioTicks, type StudioRenderRecipe } from '../../../../shared/studio';
import type { StudioCaptionCue } from './studioCaptions';
import { StudioRenderKernel } from './renderer';
import type { StudioPortraitDetector } from './portraitClient';
import { assertStudioActive, type StudioAssetResolver } from './media';

export const studioPromotionLimit = 3;
export type StudioPromotionCut = { start: number; end: number; title: string };

export function suggestStudioPromotionCuts(cues: readonly StudioCaptionCue[]): StudioPromotionCut[] {
  const endsThought = (index: number) => /[.!?…]["'”’)]*\s*$/.test(cues[index].text) ||
    !cues[index + 1] || cues[index + 1].start - cues[index].end >= .65;
  const candidates: (StudioPromotionCut & { score: number })[] = [];
  for (let i = 0; i < cues.length; i++) {
    if (i > 0 && !endsThought(i - 1)) continue;
    let text = '';
    for (let j = i; j < cues.length; j++) {
      const duration = cues[j].end - cues[i].start;
      if (duration > 60 || j > i && cues[j].start - cues[j - 1].end > 5) break;
      text += (text ? ' ' : '') + cues[j].text;
      if (duration < 12 || !endsThought(j)) continue;
      const terms = text.toLocaleLowerCase('pt-BR').match(/\p{L}+/gu) ?? [];
      if (terms.length < 20) continue;
      const opening = cues[i].text.trim();
      const dependent = /^(e |então[, ]|isso |ele |ela |porque |mas )/i.test(opening);
      const hook = /[?]|\b(como|por que|dica|exemplo|importante|primeiro|segredo|erro|aprendi)\b/i.test(opening);
      const score = (hook ? 3 : 0) - (dependent ? 3 : 0) +
        new Set(terms).size / terms.length * 4 - Math.abs(duration - 35) / 12;
      const firstSentence = text.match(/^.{12,90}?[.!?](?=\s|$)/u)?.[0] ?? text;
      const title = firstSentence.length > 68 ? firstSentence.slice(0, 67).replace(/\s+\S*$/, '') + '…' : firstSentence;
      candidates.push({ start: cues[i].start, end: cues[j].end, title, score });
    }
  }
  candidates.sort((a, b) => a.end - b.end);
  const best: { score: number; cuts: StudioPromotionCut[] }[][] =
    [[{ score: 0, cuts: [] }]];
  for (const [index, candidate] of candidates.entries()) {
    let low = 0, high = index;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (candidates[middle].end <= candidate.start) low = middle + 1;
      else high = middle;
    }
    const previous = best[index];
    const compatible = best[low];
    best.push([previous[0]]);
    for (let count = 1; count <= studioPromotionLimit; count++) {
      const skip = previous[count];
      const base = compatible[count - 1];
      if (!base || skip && skip.score >= base.score + candidate.score) {
        best[index + 1][count] = skip;
      } else {
        const { start, end, title } = candidate;
        best[index + 1][count] = { cuts: [...base.cuts, { start, end, title }], score: base.score + candidate.score };
      }
    }
  }
  return best.at(-1)!.filter(Boolean).at(-1)!.cuts;
}

export function studioPromotionRecipe(source: StudioRenderRecipe, cut: StudioPromotionCut, subjectX = .5): StudioRenderRecipe {
  const start = studioTicks(cut.start), end = Math.min(source.durationTicks, studioTicks(cut.end));
  // The vertical viewport retains the source composition's full height.
  const cropWidth = Math.min(1, (9 / 16) / (source.output.width / source.output.height));
  const left = Math.max(0, Math.min(1 - cropWidth, subjectX - cropWidth / 2));
  const clips = source.clips.flatMap(clip => {
    const from = Math.max(start, clip.startTicks), to = Math.min(end, clip.startTicks + clip.durationTicks);
    if (to <= from) return [];
    const elapsed = from - clip.startTicks, span = to - from, rate = clip.playbackRate ?? 1;
    const sourceStartTicks = clip.sourceStartTicks + Math.round(elapsed * rate);
    const temporal = clip.kind === 'video' || clip.kind === 'audio';
    const sourceLength = Math.min(clip.sourceEndTicks - sourceStartTicks, Math.floor(span * rate + rate / 2 - 1e-8));
    const durationTicks = temporal ? Math.round(sourceLength / rate) : span;
    if (durationTicks < 1) return [];
    const fadeInTicks = Math.min(durationTicks, Math.max(0, clip.fadeInTicks - elapsed));
    const fadeOutTicks = Math.min(durationTicks - fadeInTicks, Math.max(0, clip.fadeOutTicks - (clip.startTicks + clip.durationTicks - to)));
    const rect = clip.kind === 'caption'
      ? { x: .09, y: .68, width: .82, height: .19 }
      : { ...clip.rect, x: Math.max(-10, Math.min(10, (clip.rect.x - left) / cropWidth)), width: Math.min(10, clip.rect.width / cropWidth) };
    return [{ ...clip, rect, startTicks: from - start, durationTicks, fadeInTicks, fadeOutTicks,
      ...(temporal ? { sourceStartTicks, sourceEndTicks: sourceStartTicks + sourceLength } : {}),
      ...(clip.motion ? { motionOffsetTicks: (clip.motionOffsetTicks ?? 0) + elapsed,
        motionDurationTicks: clip.motionDurationTicks ?? clip.durationTicks } : {}),
      ...(clip.text?.animation ? { animationOffsetTicks: (clip.animationOffsetTicks ?? 0) + elapsed } : {}),
      ...(clip.kind === 'caption' && clip.text ? { text: { ...clip.text, alignment: 'center' as const, fontSize: .041,
        animation: 'none' as const, lineHeight: 1.18 } } : {}),
    }];
  });
  const requiredFeatures = studioRequiredFeatures({ clips });
  return {
    ...source, clips, durationTicks: end - start, version: requiredFeatures.length ? 3 : 2,
    requiredFeatures: requiredFeatures.length ? requiredFeatures : undefined,
    canvas: { ...source.canvas, aspectRatio: 'portrait' },
    output: { profile: 'standard', width: 1080, height: 1920, frameRateNumerator: 30, frameRateDenominator: 1, colorSpace: 'rec709' },
  };
}

export async function studioPromotionSubject(source: StudioRenderRecipe, cut: StudioPromotionCut, resolve: StudioAssetResolver,
  detector: StudioPortraitDetector, signal: AbortSignal) {
  const clips = source.clips.filter(clip => clip.kind === 'video' || clip.kind === 'image').map(clip => ({
    ...clip, enhancement: undefined, signature: undefined, portrait: undefined,
  }));
  const requiredFeatures = studioRequiredFeatures({ clips });
  let kernel: StudioRenderKernel | undefined;
  const canvas = document.createElement('canvas');
  const ratio = Math.min(1, 480 / Math.max(source.output.width, source.output.height));
  canvas.width = Math.round(source.output.width * ratio); canvas.height = Math.round(source.output.height * ratio);
  try {
    kernel = new StudioRenderKernel({
      ...source, clips, version: requiredFeatures.length ? 3 : 2,
      requiredFeatures: requiredFeatures.length ? requiredFeatures : undefined,
    }, resolve, signal);
    const points: number[] = [];
    for (const fraction of [.23, .5, .77]) {
      await kernel.draw(canvas, cut.start + (cut.end - cut.start) * fraction, { mediaMaxDimension: 480 });
      const bitmap = await createImageBitmap(canvas);
      const face = await detector.detect(bitmap, signal);
      const x = face[1]?.x;
      if (typeof x === 'number' && Number.isFinite(x)) points.push(x);
    }
    return points.sort((a, b) => a - b)[Math.floor(points.length / 2)] ?? .5;
  } catch {
    assertStudioActive(signal);
    return .5;
  } finally {
    kernel?.dispose(); canvas.width = 1; canvas.height = 1;
  }
}

export function studioPromotionCues(recipe: StudioRenderRecipe): StudioCaptionCue[] {
  return recipe.clips.flatMap(clip => clip.kind === 'caption' && clip.opacity > 0 && clip.text
    ? [{ start: studioSeconds(clip.startTicks), end: studioSeconds(clip.startTicks + clip.durationTicks), text: clip.text.content }]
    : []).sort((a, b) => a.start - b.start);
}
