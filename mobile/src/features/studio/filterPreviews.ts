import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { isStudioFilterPreviewAvailable, renderStudioRecipeThumbnailAsync } from '../../../modules/classfy-studio-media';
import { studioFilterPresets } from './filterCatalog';
import { compileStudioRecipe, patchStudioClipGrade, studioGrade, studioSeconds, type StudioEditing } from './model';

// Sheets can be reopened before cancelled decoders finish. Share leases across
// generations so rapid target changes never multiply the native decoder budget.
let rendering = 0;
const waiting: Array<() => void> = [];
function acquirePreviewLease(): Promise<() => void> {
  return new Promise(resolve => {
    const grant = () => {
      rendering++;
      resolve(() => { rendering--; waiting.shift()?.(); });
    };
    if (rendering < 3) grant(); else waiting.push(grant);
  });
}

/** A short-lived sheet cache; late frames never replace a different target. */
export function prepareStudioFilterPreviews(editing: StudioEditing, targetId: string, position: number, receive: (id: string, uri: string) => void) {
  let cancelled = false;
  const directory = FileSystem.cacheDirectory ? `${FileSystem.cacheDirectory}classfy-studio-filters/${randomUUID()}/` : undefined;
  const work = async () => {
    if (!directory || !isStudioFilterPreviewAvailable()) return;
    await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const base = compileStudioRecipe({ kind: editing.canvas.aspectRatio === 'portrait' ? 'short' : 'aula', takes: [], editing });
    const clip = base.clips.find(item => item.id === targetId);
    if (!clip) return;
    const currentGrade = { ...studioGrade(clip.effect), ...clip.grade };
    const start = studioSeconds(clip.startTicks), end = studioSeconds(clip.startTicks + clip.durationTicks);
    const seconds = Math.max(start, Math.min(end - Math.min(0.04, (end - start) / 2), Number.isFinite(position) ? position : start));
    // At most three workers per sheet; native leases are shared by every sheet.
    let cursor = 0;
    await Promise.allSettled(Array.from({ length: 3 }, async () => {
      while (!cancelled && cursor < studioFilterPresets.length) {
        const preset = studioFilterPresets[cursor++];
        const release = await acquirePreviewLease();
        try {
          if (cancelled) continue;
          const grade = preset.preserveAdjustments ? { ...currentGrade, preset: preset.grade.preset } : { ...preset.grade, intensity: currentGrade.intensity };
          const recipe = compileStudioRecipe({ kind: editing.canvas.aspectRatio === 'portrait' ? 'short' : 'aula', takes: [], editing: patchStudioClipGrade(editing, targetId, grade) });
          const result = await renderStudioRecipeThumbnailAsync(JSON.stringify(recipe), `${directory}${preset.id}.jpg`, seconds);
          if (!cancelled) receive(preset.id, result.uri);
        } catch { /* The sheet retains a usable labeled preset if its preview fails. */ }
        finally { release(); }
      }
    }));
  };
  const pending = work().catch(() => undefined);
  return () => { cancelled = true; void pending.then(() => directory ? FileSystem.deleteAsync(directory, { idempotent: true }) : undefined).catch(() => undefined); };
}
