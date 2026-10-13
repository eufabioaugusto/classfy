import { describe, expect, it } from 'vitest';
import {
  assertStudioRenderFeatures, compileStudioRecipe, createStudioTextItem, deriveStudioTakes,
  emptyStudioEditing, migrateStudioProject, patchStudioClipEnhancement, patchStudioClipPortrait, reconcileStudioTakes,
  requiresStudioEditorTools, studioGrade, studioRequiredFeatures, studioTicks, timelineSignature, validateStudioEditing,
  validateStudioEnhancement, validateStudioPendingTakes, validateStudioPortrait, validateStudioRecipe, withStudioTakes,
  type StudioEditing, type StudioEnhancement, type StudioProject,
} from './model';
import { splitStudioTake } from './timeline';
import { createStudioEditingHistory } from './editingHistory';
import { duplicateStudioLayer, splitStudioLayer } from './layerActions';

const enhancement = (strength = .7): StudioEnhancement => ({ version: 1, strength, exposure: .3, contrast: .15, saturation: -.1,
  temperature: .2, tint: -.2, shadows: .3, highlights: -.25, analyzedFrames: 8 });
function editing(): StudioEditing {
  const next = emptyStudioEditing('aula');
  next.assets = [{ id: 'video', kind: 'video', uri: 'file:///classfy-studio/owner/project/original.mp4', name: 'Original', durationTicks: studioTicks(8), width: 1920, height: 1080, frameRate: 30, hasAudio: true },
    { id: 'image', kind: 'image', uri: 'file:///classfy-studio/owner/project/image.jpg', name: 'Imagem', durationTicks: 0, width: 1000, height: 1000 }];
  next.main = [{ id: 'main', assetId: 'video', sourceStartTicks: 0, sourceEndTicks: studioTicks(8), grade: studioGrade('studio') }];
  next.layers = [{ id: 'images', kind: 'image', items: [{ id: 'image-item', kind: 'image', assetId: 'image', atTicks: 0, durationTicks: studioTicks(3) }] }];
  return next;
}
function project(value = editing()): StudioProject {
  return withStudioTakes({ id: 'project', ownerId: 'owner', version: 2, kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [],
    visibility: 'free', price: '0', revision: 0, state: 'draft', progress: 0, createdAt: '', updatedAt: '', editing: value });
}

describe('contrato reversível de melhoria e retrato', () => {
  it('ausência e força zero conservam recipe2; recursos ativos exigem recipe3 e capacidade explícita', () => {
    const identity = compileStudioRecipe(project()); expect(identity.version).toBe(2); expect(identity.requiredFeatures).toBeUndefined();
    assertStudioRenderFeatures(identity, []);
    const disabled = patchStudioClipPortrait(patchStudioClipEnhancement(editing(), 'main', enhancement(0)), 'image-item', { version: 1, strength: 0 });
    expect(compileStudioRecipe(project(disabled)).version).toBe(2); expect(studioRequiredFeatures(disabled)).toEqual([]);
    const enhanced = patchStudioClipPortrait(patchStudioClipEnhancement(disabled, 'main', enhancement()), 'image-item', { version: 1, strength: .4 });
    const recipe = compileStudioRecipe(project(enhanced)); expect(recipe.version).toBe(3); expect(recipe.requiredFeatures).toEqual(['enhancement-v1', 'portrait-v1']);
    expect(validateStudioRecipe(recipe)).toEqual([]); expect(requiresStudioEditorTools(enhanced)).toBe(true);
    expect(() => assertStudioRenderFeatures(recipe, [])).toThrow('renderizador');
    expect(() => assertStudioRenderFeatures(recipe, ['enhancement-v1'])).toThrow('renderizador');
    expect(() => assertStudioRenderFeatures(recipe, ['portrait-v1', 'enhancement-v1'])).not.toThrow();
    for (const corrupted of [{ ...recipe, version: 2 as const }, { ...recipe, requiredFeatures: [] },
      { ...recipe, requiredFeatures: ['portrait-v1', 'portrait-v1'] as const }, { ...identity, version: 3 as const },
      { ...identity, requiredFeatures: ['portrait-v1'] as const }]) expect(validateStudioRecipe(corrupted as typeof recipe)).not.toEqual([]);
  });

  it('retoque intenso exige capacidade v2, preserva v1 e deriva recursos de clips mistos', () => {
    const legacy = patchStudioClipPortrait(editing(), 'main', { version: 1, strength: .4 });
    const upgraded = patchStudioClipPortrait(legacy, 'image-item', { version: 2, strength: 1 });
    const recipe = compileStudioRecipe(project(upgraded));
    expect(recipe.requiredFeatures).toEqual(['portrait-v1', 'portrait-v2']);
    expect(validateStudioRecipe(recipe)).toEqual([]);
    expect(() => assertStudioRenderFeatures(recipe, ['portrait-v1'])).toThrow('renderizador');
    expect(() => assertStudioRenderFeatures(recipe, ['portrait-v1', 'portrait-v2'])).not.toThrow();
    expect(legacy.main[0].portrait).toEqual({ version: 1, strength: .4 });
    expect(upgraded.main[0].portrait).toEqual(legacy.main[0].portrait);
    expect(timelineSignature(project(upgraded))).not.toBe(timelineSignature(project(legacy)));
    const disabled = patchStudioClipPortrait(upgraded, 'image-item', { version: 2, strength: 0 });
    expect(studioRequiredFeatures(disabled)).toEqual(['portrait-v1']);
    const migrated = migrateStudioProject(project(legacy));
    expect(migrated.editing!.main[0].portrait).toEqual({ version: 1, strength: .4 });
  });

  it('valida versões, números finitos, intervalos e rejeita landmarks transitórios/props desconhecidas', () => {
    expect(validateStudioEnhancement(enhancement())).toEqual([]); expect(validateStudioPortrait({ version: 1, strength: 0 })).toEqual([]); expect(validateStudioPortrait({ version: 2, strength: 1 })).toEqual([]);
    for (const invalid of [null, { ...enhancement(), version: 2 }, { ...enhancement(), strength: 1.1 }, { ...enhancement(), strength: -.1 },
      { ...enhancement(), exposure: 2.1 }, { ...enhancement(), tint: NaN }, { ...enhancement(), highlights: -1.1 },
      { ...enhancement(), analyzedFrames: 0 }, { ...enhancement(), analyzedFrames: 25 }, { ...enhancement(), analyzedFrames: 2.5 },
      { ...enhancement(), landmarks: [1, 2, 3] }, { ...enhancement(), exposure: undefined }]) expect(validateStudioEnhancement(invalid)).not.toEqual([]);
    for (const invalid of [null, { version: 3, strength: .5 }, { version: 1, strength: Infinity }, { version: 1, strength: -1 },
      { version: 1, strength: 1.01 }, { version: 1, strength: .5, landmarks: [] }]) expect(validateStudioPortrait(invalid)).not.toEqual([]);
  });

  it('patch mira main/image, remove com null e mantém grade, fonte e tratamento vizinho intactos', () => {
    const before = editing(), originalAssets = JSON.stringify(before.assets), grade = before.main[0].grade;
    const next = patchStudioClipPortrait(patchStudioClipEnhancement(before, 'main', enhancement()), 'image-item', { version: 1, strength: .6 });
    expect(before.main[0]).not.toHaveProperty('enhancement'); expect(JSON.stringify(next.assets)).toBe(originalAssets); expect(next.main[0].grade).toBe(grade);
    expect(next.layers[0].items[0].portrait).toEqual({ version: 1, strength: .6 });
    expect(patchStudioClipEnhancement(next, 'main', enhancement())).toBe(next);
    expect(patchStudioClipEnhancement(next, 'main', Object.fromEntries(Object.entries(enhancement()).reverse()) as StudioEnhancement)).toBe(next);
    const removed = patchStudioClipEnhancement(next, 'main', null); expect(removed.main[0]).not.toHaveProperty('enhancement');
    expect(removed.layers[0].items[0].portrait).toEqual(next.layers[0].items[0].portrait); expect(patchStudioClipEnhancement(removed, 'main', null)).toBe(removed);
    expect(() => patchStudioClipPortrait(next, 'missing', { version: 1, strength: .5 })).toThrow('montagem');
    const text = { ...before, layers: [...before.layers, { id: 'titles', kind: 'text' as const, items: [createStudioTextItem({ id: 'title' })] }] };
    expect(() => patchStudioClipEnhancement(text, 'title', enhancement())).toThrow('imagem ou vídeo');
    const invalid = structuredClone(next); invalid.layers[0].items[0].portrait!.strength = 2;
    invalid.layers[0].items[0].anchor = { clipId: 'main', offsetTicks: studioTicks(50) };
    expect(validateStudioEditing(invalid, 'aula')).toContain('Revise o retoque facial do clip.');
  });

  it('split/reconcile e duplicação preservam parâmetros independentes, ranges e originais', () => {
    let value = patchStudioClipPortrait(patchStudioClipEnhancement(editing(), 'main', enhancement()), 'main', { version: 1, strength: .5 });
    const current = project(value), derived = deriveStudioTakes(value);
    expect(derived[0].enhancement).toEqual(enhancement()); expect(derived[0].enhancement).not.toBe(value.main[0].enhancement);
    const takes = splitStudioTake(derived, 'main', 3, 'left', 'right'); expect(takes[0].enhancement).not.toBe(takes[1].enhancement);
    const split = reconcileStudioTakes(current, takes); expect(split.main.map(item => item.enhancement)).toEqual([enhancement(), enhancement()]);
    expect(split.main.map(item => item.portrait)).toEqual([{ version: 1, strength: .5 }, { version: 1, strength: .5 }]);
    expect(split.main.map(item => [item.sourceStartTicks, item.sourceEndTicks])).toEqual([[0, studioTicks(3)], [studioTicks(3), studioTicks(8)]]);
    expect(split.assets).toEqual(value.assets);
    value = patchStudioClipEnhancement(value, 'image-item', enhancement(.4));
    const duplicated = duplicateStudioLayer(value, 'image-item', 'image-copy');
    const copy = duplicated.layers.flatMap(layer => layer.items).find(item => item.id === 'image-copy')!;
    expect(copy.enhancement).toEqual(enhancement(.4)); expect(copy.enhancement).not.toBe(value.layers[0].items[0].enhancement);
    const layerSplit = splitStudioLayer(value, 'image-item', 1, 'image-right');
    expect(layerSplit.layers.flatMap(layer => layer.items).map(item => item.enhancement)).toEqual([enhancement(.4), enhancement(.4)]);
    expect(validateStudioEditing(layerSplit, 'aula')).toEqual([]);
  });

  it('fingerprint cobre cada ajuste sem caminhos de container; migração não certifica export legado tratado', () => {
    const before = project(), applied = project(patchStudioClipEnhancement(before.editing!, 'main', enhancement()));
    expect(timelineSignature(before)).not.toBe(timelineSignature(applied));
    for (const field of ['strength', 'exposure', 'contrast', 'saturation', 'temperature', 'tint', 'shadows', 'highlights', 'analyzedFrames'] as const) {
      const next = structuredClone(applied.editing!); next.main[0].enhancement![field] += field === 'analyzedFrames' ? 1 : .01;
      expect(timelineSignature(project(next))).not.toBe(timelineSignature(applied));
    }
    const rebased = { ...applied.editing!, assets: applied.editing!.assets.map(asset => ({ ...asset, uri: asset.uri.replace('file:///', 'file:///new-container/') })) };
    expect(timelineSignature(project(rebased))).toBe(timelineSignature(applied));
    const take = deriveStudioTakes(applied.editing!)[0];
    const migrated = migrateStudioProject({ ...before, version: 1, editing: undefined, takes: [take], exportedSignature: JSON.stringify([2, 'aula', [[take.id, take.uri, take.start, take.end]]]) });
    expect(migrated.editing!.main[0].enhancement).toEqual(enhancement()); expect(migrated.exportedSignature).not.toBe(timelineSignature(migrated));
    const original = patchStudioClipPortrait(applied.editing!, 'main', { version: 1, strength: .2 });
    expect(timelineSignature(project(original))).not.toBe(timelineSignature(applied));
  });

  it('histórico só avança com persistência, restaura efeitos e zera ao trocar owner/sessão', () => {
    const before = project(), next = project(patchStudioClipPortrait(patchStudioClipEnhancement(before.editing!, 'main', enhancement()), 'image-item', { version: 1, strength: .6 }));
    const history = createStudioEditingHistory(); history.sync(before, 'owner');
    const failed = history.beginEditing(before, next.editing!)!; history.abort(failed); expect(history.state().undoCount).toBe(0);
    const operation = history.beginEditing(before, next.editing!)!; expect(history.commit(operation, next)).toBe(true);
    const undo = history.beginUndo(next)!; const restored = project(undo.editing!); expect(compileStudioRecipe(restored).version).toBe(2); history.commit(undo, restored);
    const redo = history.beginRedo(restored)!; expect(redo.editing!.main[0].enhancement).toEqual(enhancement());
    expect(redo.editing!.layers[0].items[0].portrait).toEqual({ version: 1, strength: .6 }); history.abort(redo);
    history.sync(withStudioTakes({ ...next, editing: next.editing!, ownerId: 'different-owner' }), 'different-owner'); expect(history.state().undoCount).toBe(0);
    expect(history.state().redoCount).toBe(0);
  });

  it('pending layer validation preserves valid effects and rejects malformed/unsupported recovery fields', () => {
    const pending = { id: 'image', uri: 'file:///image.jpg', name: 'Imagem', kind: 'image' as const,
      layerItem: { id: 'item', kind: 'image' as const, assetId: 'image', atTicks: 0, durationTicks: studioTicks(3), enhancement: enhancement(), portrait: { version: 1 as const, strength: .5 } } };
    expect(validateStudioPendingTakes([pending])).toEqual([]);
    expect(validateStudioPendingTakes([{ ...pending, layerItem: { ...pending.layerItem, portrait: { version: 1, strength: 2 } } }])).not.toEqual([]);
    expect(validateStudioPendingTakes([{ ...pending, kind: 'audio', layerItem: { ...pending.layerItem, kind: 'audio' } }])).not.toEqual([]);
  });
});
