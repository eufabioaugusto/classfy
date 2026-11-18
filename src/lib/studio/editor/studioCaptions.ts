import { compileStudioRecipe, studioSeconds, type StudioProject } from '../../../../shared/studio';
import { assertStudioActive, type StudioAssetResolver } from './media';
import { StudioRenderKernel } from './renderer';

export type StudioCaptionCue = { text: string; start: number; end: number };
type Word = { text: string; timestamp: [number, number | null] };
type WorkerResult = { stage?: string; progress?: number; error?: string; chunks?: Word[] };

function groupCaptionWords(words: Word[], duration: number): StudioCaptionCue[] {
  const cues: StudioCaptionCue[] = [];
  let cue: StudioCaptionCue | undefined;
  for (const { text, timestamp: [from, to] } of words) {
    const word = text.trim();
    const start = Math.max(0, from);
    const end = Math.min(duration, to ?? start + .5);
    if (!word || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const separator = /^[-'’.,!?;:]/.test(word) ? '' : ' ';
    if (!cue || cue.text.length + separator.length + word.length > 55 || end - cue.start > 3.5 || start - cue.end > .5 || /[.!?]$/.test(cue.text)) {
      cue = { text: word, start, end };
      cues.push(cue);
    } else {
      cue.text += separator + word;
      cue.end = end;
    }
  }
  return cues.flatMap((cue, index) => {
    const end = Math.min(duration, cues[index + 1]?.start ?? duration, Math.max(cue.end, cue.start + .6));
    return end - cue.start < .1 ? [] : [{ ...cue, end }];
  });
}


export async function transcribeStudioCaptions(
  project: StudioProject, resolveAsset: StudioAssetResolver, language: string,
  signal: AbortSignal, onStage: (stage: string, progress?: number) => void,
): Promise<StudioCaptionCue[]> {
  assertStudioActive(signal);
  const recipe = compileStudioRecipe(project);
  const duration = studioSeconds(recipe.durationTicks);
  if (duration > 20 * 60) throw new Error('A geração local aceita montagens de até 20 minutos. Você pode importar um SRT para vídeos maiores.');
  const sampleRate = 16000;
  const audio = new Float32Array(Math.round(duration * sampleRate));
  const kernel = new StudioRenderKernel(recipe, resolveAsset, signal);
  let peak = 0;
  try {
    for (let offset = 0; offset < audio.length; offset += 15 * sampleRate) {
      const count = Math.min(15 * sampleRate, audio.length - offset);
      const [left, right] = await kernel.mixAudio(offset / sampleRate, count / sampleRate, sampleRate);
      for (let i = 0; i < count; i++) {
        const sample = (left[i] + right[i]) / 2;
        audio[offset + i] = sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
  } finally {
    kernel.dispose();
  }
  assertStudioActive(signal);
  if (peak < .0001) return [];

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./studioCaptions.worker.ts', import.meta.url), { type: 'module' });
    function finish() { worker.terminate(); signal.removeEventListener('abort', abort); }
    function abort() { finish(); reject(new DOMException('Operação cancelada', 'AbortError')); }
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { finish(); reject(new Error('O navegador não conseguiu iniciar a transcrição local.')); };
    worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
      if (data.stage) { onStage(data.stage, data.progress); return; }
      finish();
      if (data.error) { reject(new Error(data.error)); return; }
      resolve(groupCaptionWords(data.chunks ?? [], duration));
    };
    worker.postMessage({ audio, language }, [audio.buffer]);
  });
}
