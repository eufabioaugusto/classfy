import { useEffect, useRef, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import { compileStudioRecipe, studioSeconds, type StudioProject } from '../../../../shared/studio';
import { StudioRenderKernel } from '@/lib/studio/editor/renderer';
import { getAsset } from '@/lib/studio/editor/storage';

function animateFrame(canvas: HTMLCanvasElement, source: HTMLImageElement | HTMLCanvasElement, signal: AbortSignal) {
  const width = canvas.width, height = canvas.height;
  const context = canvas.getContext('2d');
  if (!context) return;
  const scale = Math.max(width / source.width, height / source.height);
  const w = source.width * scale, h = source.height * scale;
  context.drawImage(source, (width - w) / 2, (height - h) / 2, w, h);
  const original = context.getImageData(0, 0, width, height).data;
  const frame = context.createImageData(width, height);
  const grain = Float32Array.from({ length: width * height }, () => Math.random() - .5);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let animation: number;
  const draw = (time: number) => {
    const phase = time / 730;
    for (let y = 0; y < height; y++) {
      const wave = Math.sin(y * .08 - phase);
      for (let x = 0; x < width; x++) {
        const i = y * width + x, noise = grain[i];
        const crest = .55 + .45 * Math.sin(y * .05 + x * .026 - phase);
        const sx = Math.max(0, Math.min(width - 1, Math.round(x + wave * (3 + 8 * crest) + noise * 14 * crest)));
        const sy = Math.max(0, Math.min(height - 1, Math.round(y + Math.sin(x * .04 + phase) * 3 + noise * 9 * crest)));
        const from = 4 * (sy * width + sx), to = 4 * i;
        const fleck = noise * (18 + 46 * crest);
        for (let channel = 0; channel < 3; channel++) frame.data[to + channel] = original[from + channel] + fleck;
        frame.data[to + 3] = 255;
      }
    }
    context.putImageData(frame, 0, 0);
    if (!reducedMotion.matches) animation = requestAnimationFrame(draw);
  };
  signal.addEventListener('abort', () => cancelAnimationFrame(animation), { once: true });
  draw(0);
}

export function StudioPromotionArtwork({ project, artwork, generating }: {
  project: StudioProject; artwork?: string; generating: boolean;
}) {
  const target = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!generating || !target.current) return;
    const canvas = target.current, controller = new AbortController();
    const { signal } = controller;
    setReady(false);
    const start = async () => {
      let source: HTMLImageElement | HTMLCanvasElement;
      if (artwork) {
        const image = new Image();
        image.src = artwork;
        await image.decode();
        source = image;
      } else {
        const recipe = compileStudioRecipe(project);
        const frame = document.createElement('canvas');
        const scale = 480 / Math.max(recipe.output.width, recipe.output.height);
        frame.width = Math.max(1, Math.round(recipe.output.width * scale));
        frame.height = Math.max(1, Math.round(recipe.output.height * scale));
        const kernel = new StudioRenderKernel(recipe, id => getAsset(project.ownerId, project.id, id), signal);
        try { await kernel.draw(frame, Math.min(1, studioSeconds(recipe.durationTicks) / 2), { mediaMaxDimension: 480 }); }
        finally { kernel.dispose(); }
        source = frame;
      }
      if (signal.aborted) return;
      canvas.width = 384;
      canvas.height = Math.max(1, Math.round(384 * canvas.clientHeight / Math.max(1, canvas.clientWidth)));
      animateFrame(canvas, source, signal);
      setReady(true);
    };
    void start().catch(() => {});
    return () => controller.abort();
  }, [artwork, generating, project]);

  return <div className="se-promotion-art" aria-hidden="true">
    {artwork && <img src={artwork} alt="" />}
    {generating && <canvas ref={target} className={ready ? 'visible' : undefined} />}
    {(!generating || !ready) && <Clapperboard className={generating ? 'working' : undefined} size={44} />}
  </div>;
}
