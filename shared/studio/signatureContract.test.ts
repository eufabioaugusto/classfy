import { describe, expect, it } from 'vitest';
import {
  STUDIO_RENDER_VERSION, assertStudioRenderFeatures, compileStudioRecipe, createStudioTextItem, deriveStudioTakes,
  emptyStudioEditing, migrateStudioProject, patchStudioClipEnhancement, patchStudioClipPortrait, patchStudioClipSignature,
  reconcileStudioTakes, requiresStudioEditorTools, studioGrade, studioRequiredFeatures, studioTicks, timelineSignature,
  validateStudioEditing, validateStudioPendingTakes, validateStudioRecipe, validateStudioSignature, withStudioTakes,
  type StudioEditing, type StudioProject, type StudioSignature,
} from './model';
import { duplicateStudioTake, splitStudioTake } from './timeline';
import { duplicateStudioLayer, splitStudioLayer } from './layerActions';
import { createStudioEditingHistory } from './editingHistory';

const signature = (strength = .8): StudioSignature => ({ version: 1, strength, subjectExposure: .3,
  backgroundExposure: -.7, backgroundBlur: .25, temperature: .15 });
function editing(): StudioEditing {
  return { ...emptyStudioEditing('aula'), assets: [
    { id: 'video', kind: 'video', name: 'Original', uri: 'file:///owner/project/original.mp4', durationTicks: studioTicks(8), width: 1920, height: 1080, hasAudio: true },
    { id: 'image', kind: 'image', name: 'Retrato', uri: 'file:///owner/project/image.jpg', durationTicks: 0, width: 600, height: 600 },
  ], main: [{ id: 'main', assetId: 'video', sourceStartTicks: 0, sourceEndTicks: studioTicks(8), grade: studioGrade('studio') }],
  layers: [{ id: 'images', kind: 'image', items: [{ id: 'image-item', kind: 'image', assetId: 'image', atTicks: 0, durationTicks: studioTicks(3) }] }] };
}
function project(value = editing()): StudioProject {
  return withStudioTakes({ version: 2, id: 'project', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [],
    visibility: 'free', price: '0', revision: 0, state: 'draft', progress: 0, createdAt: '', updatedAt: '', editing: value });
}

describe('assinatura cinematográfica persistida e versionada', () => {
  it('mantém recipe2 com ausência/zero e exige suporte explícito para recipe3, sem ignorar os recursos anteriores', () => {
    const base = editing(), disabled = patchStudioClipSignature(base, 'main', signature(0));
    expect(compileStudioRecipe(project(base)).version).toBe(2);
    expect(compileStudioRecipe(project(disabled)).version).toBe(2); expect(studioRequiredFeatures(disabled)).toEqual([]);
    const active = patchStudioClipSignature(disabled, 'main', signature());
    const recipe = compileStudioRecipe(project(active));
    expect(recipe.version).toBe(3); expect(recipe.requiredFeatures).toEqual(['cinematic-signature-v1']);
    expect(validateStudioRecipe(recipe)).toEqual([]); expect(requiresStudioEditorTools(active)).toBe(true);
    expect(() => assertStudioRenderFeatures(recipe, ['enhancement-v1', 'portrait-v1'])).toThrow('renderizador');
    expect(() => assertStudioRenderFeatures(recipe, ['cinematic-signature-v1'])).not.toThrow();
    const combined = patchStudioClipPortrait(patchStudioClipEnhancement(active, 'image-item', {
      version: 1, strength: .5, exposure: .2, contrast: 0, saturation: 0, temperature: 0, tint: 0, shadows: 0, highlights: 0, analyzedFrames: 2,
    }), 'main', { version: 1, strength: .3 });
    expect(compileStudioRecipe(project(combined)).requiredFeatures).toEqual(['enhancement-v1', 'portrait-v1', 'cinematic-signature-v1']);
    for (const malformed of [{ ...recipe, version: 2 as const }, { ...recipe, requiredFeatures: [] },
      { ...recipe, requiredFeatures: ['portrait-v1'] }, { ...recipe, requiredFeatures: ['cinematic-signature-v1', 'cinematic-signature-v1'] }]) {
      expect(validateStudioRecipe(malformed as typeof recipe)).not.toEqual([]);
    }
  });

  it('valida campos completos, limites inclusivos e não persiste máscaras, landmarks ou versões desconhecidas', () => {
    expect(validateStudioSignature(signature())).toEqual([]);
    expect(validateStudioSignature({ version: 1, strength: 0, subjectExposure: -.5, backgroundExposure: -2, backgroundBlur: 0, temperature: -1 })).toEqual([]);
    expect(validateStudioSignature({ version: 1, strength: 1, subjectExposure: 1, backgroundExposure: 0, backgroundBlur: 1, temperature: 1 })).toEqual([]);
    for (const invalid of [null, [], { ...signature(), version: 2 }, { ...signature(), strength: -.01 }, { ...signature(), strength: 1.01 },
      { ...signature(), subjectExposure: -.51 }, { ...signature(), subjectExposure: 1.01 }, { ...signature(), backgroundExposure: -2.01 },
      { ...signature(), backgroundExposure: .01 }, { ...signature(), backgroundBlur: -.01 }, { ...signature(), backgroundBlur: 1.01 },
      { ...signature(), temperature: -1.01 }, { ...signature(), temperature: 1.01 }, { ...signature(), strength: NaN },
      { ...signature(), temperature: Infinity }, { ...signature(), mask: [] }, { ...signature(), landmarks: [] }, { ...signature(), backgroundBlur: undefined }]) {
      expect(validateStudioSignature(invalid)).not.toEqual([]);
    }
  });

  it('patch e remoção miram somente o clip, são no-op sem diferenças e preservam grau/originais/tratamentos independentes', () => {
    const base = patchStudioClipPortrait(editing(), 'main', { version: 1, strength: .4 });
    const main = patchStudioClipSignature(base, 'main', signature()), next = patchStudioClipSignature(main, 'image-item', signature(.5));
    expect(base.main[0]).not.toHaveProperty('signature'); expect(next.assets).toBe(base.assets); expect(next.main[0].grade).toBe(base.main[0].grade);
    expect(next.main[0].portrait).toEqual(base.main[0].portrait);
    expect(patchStudioClipSignature(next, 'main', signature())).toBe(next);
    expect(patchStudioClipSignature(next, 'main', Object.fromEntries(Object.entries(signature()).reverse()) as StudioSignature)).toBe(next);
    const clean = patchStudioClipSignature(next, 'main', null);
    expect(clean.main[0]).not.toHaveProperty('signature'); expect(clean.layers[0].items[0].signature).toEqual(signature(.5));
    expect(patchStudioClipSignature(clean, 'main', null)).toBe(clean);
    expect(() => patchStudioClipSignature(clean, 'missing', signature())).toThrow('montagem');
    const withText = { ...base, layers: [...base.layers, { id: 'text', kind: 'text' as const, items: [createStudioTextItem({ id: 'title' })] }] };
    expect(() => patchStudioClipSignature(withText, 'title', signature())).toThrow('imagem ou vídeo');
    const corrupted = structuredClone(next); corrupted.layers[0].items[0].signature!.backgroundBlur = 2;
    corrupted.layers[0].items[0].anchor = { clipId: 'main', offsetTicks: studioTicks(30) };
    expect(validateStudioEditing(corrupted, 'aula')).toContain('Revise a assinatura cinematográfica do clip.');
  });

  it('derive, split, duplicate e reconciliação preservam ranges/fonte e possuem receitas de tratamento independentes', () => {
    const base = patchStudioClipSignature(patchStudioClipSignature(editing(), 'main', signature()), 'image-item', signature(.4));
    const takes = deriveStudioTakes(base); expect(takes[0].signature).toEqual(signature()); expect(takes[0].signature).not.toBe(base.main[0].signature);
    const split = splitStudioTake(takes, 'main', 3, 'left', 'right'); expect(split[0].signature).not.toBe(split[1].signature);
    const reconciled = reconcileStudioTakes(project(base), split);
    expect(reconciled.main.map(clip => [clip.sourceStartTicks, clip.sourceEndTicks])).toEqual([[0, studioTicks(3)], [studioTicks(3), studioTicks(8)]]);
    expect(reconciled.main.every(clip => JSON.stringify(clip.signature) === JSON.stringify(signature()))).toBe(true);
    expect(reconciled.assets).toEqual(base.assets);
    const duplicated = duplicateStudioTake(takes, 'main', 'copy'); expect(duplicated[0].signature).not.toBe(duplicated[1].signature);
    const layers = duplicateStudioLayer(base, 'image-item', 'image-copy');
    expect(layers.layers[1].items[0].signature).toEqual(signature(.4)); expect(layers.layers[1].items[0].signature).not.toBe(base.layers[0].items[0].signature);
    const cut = splitStudioLayer(base, 'image-item', 1, 'image-right');
    expect(cut.layers[0].items.map(item => item.signature)).toEqual([signature(.4), signature(.4)]);
    expect(cut.layers[0].items[0].signature).not.toBe(cut.layers[0].items[1].signature);
    expect(validateStudioEditing(cut, 'aula')).toEqual([]);
  });

  it('velocidade/corte do principal projetam âncoras sem alterar a assinatura ou aplicar offset visual duplicado', () => {
    const base = patchStudioClipSignature(patchStudioClipSignature(editing(), 'main', signature()), 'image-item', signature(.4));
    base.main[0].playbackRate = 2;
    base.layers[0].items[0] = { ...base.layers[0].items[0], durationTicks: studioTicks(2), anchor: { clipId: 'main', sourceStartTicks: studioTicks(2), sourceEndTicks: studioTicks(6) } };
    const trimmed = reconcileStudioTakes(project(base), deriveStudioTakes(base).map(take => ({ ...take, start: 1, end: 7 })));
    expect(compileStudioRecipe(project(trimmed)).clips.find(clip => clip.id === 'image-item')).toMatchObject({ startTicks: studioTicks(.5), durationTicks: studioTicks(2), signature: signature(.4) });
    const split = reconcileStudioTakes(project(trimmed), splitStudioTake(deriveStudioTakes(trimmed), 'main', 4, 'left', 'right'));
    const projected = compileStudioRecipe(project(split)).clips.filter(clip => clip.zIndex > 0);
    expect(projected.map(clip => [clip.startTicks, clip.durationTicks])).toEqual([[studioTicks(.5), studioTicks(1)], [studioTicks(1.5), studioTicks(1)]]);
    expect(projected.every(clip => JSON.stringify(clip.signature) === JSON.stringify(signature(.4)))).toBe(true);
    expect(split.layers[0].items[0].signature).not.toBe(split.layers[0].items[1].signature);
    expect(split.assets).toEqual(base.assets);
  });

  it('render6 muda fingerprint de todo parâmetro, preserva caminhos lógicos e não adota export legado sem tratamento', () => {
    expect(STUDIO_RENDER_VERSION).toBe(6);
    const base = project(), treated = project(patchStudioClipSignature(base.editing!, 'main', signature()));
    expect(timelineSignature(treated)).not.toBe(timelineSignature(base));
    for (const field of ['strength', 'subjectExposure', 'backgroundExposure', 'backgroundBlur', 'temperature'] as const) {
      const next = structuredClone(treated.editing!); next.main[0].signature![field] += .01;
      expect(timelineSignature(project(next))).not.toBe(timelineSignature(treated));
    }
    const rebase = { ...treated.editing!, assets: treated.editing!.assets.map(asset => ({ ...asset, uri: asset.uri.replace('file:///', 'file:///new-container/') })) };
    expect(timelineSignature(project(rebase))).toBe(timelineSignature(treated));
    const take = treated.takes[0], oldSignature = JSON.stringify([2, 'aula', [[take.id, take.uri, take.start, take.end]]]);
    const migrated = migrateStudioProject({ ...base, version: 1, editing: undefined, takes: [take], exportedSignature: oldSignature, uploadSignature: oldSignature });
    expect(migrated.editing!.main[0].signature).toEqual(signature());
    expect(migrated.exportedSignature).not.toBe(timelineSignature(migrated)); expect(migrated.uploadSignature).not.toBe(timelineSignature(migrated));
  });

  it('snapshots independentes e congelados de histórico permitem undo/redo somente da assinatura editada', () => {
    const base = project(), next = project(patchStudioClipSignature(base.editing!, 'main', signature())), history = createStudioEditingHistory();
    history.sync(base, 'owner');
    const failed = history.beginEditing(base, next.editing!)!; history.abort(failed); expect(history.state().undoCount).toBe(0);
    const operation = history.beginEditing(base, next.editing!)!;
    expect(Object.isFrozen(operation.takes[0].signature)).toBe(true); expect(operation.takes[0].signature).not.toBe(next.takes[0].signature);
    expect(history.commit(operation, next)).toBe(true);
    const undo = history.beginUndo(next)!; const restored = project(undo.editing!); expect(compileStudioRecipe(restored).version).toBe(2); history.commit(undo, restored);
    const redo = history.beginRedo(restored)!; expect(redo.editing!.main[0].signature).toEqual(signature()); expect(compileStudioRecipe(project(redo.editing!)).version).toBe(3);
    history.abort(redo); history.sync(withStudioTakes({ ...next, editing: next.editing!, ownerId: 'other-owner' }), 'other-owner'); expect(history.state().canUndo).toBe(false);
  });

  it('recuperação do journal conserva campos válidos e rejeita assinatura inválida/áudio antes de promover layer', () => {
    const pending = { id: 'image', kind: 'image' as const, uri: 'file:///image.jpg', name: 'Retrato',
      layerItem: { id: 'image-item', assetId: 'image', kind: 'image' as const, atTicks: 0, durationTicks: studioTicks(2), signature: signature() } };
    expect(validateStudioPendingTakes([pending])).toEqual([]);
    expect(validateStudioPendingTakes([{ ...pending, layerItem: { ...pending.layerItem, signature: { ...signature(), backgroundExposure: 1 } } }])).not.toEqual([]);
    expect(validateStudioPendingTakes([{ ...pending, layerItem: { ...pending.layerItem, kind: 'audio' } }])).not.toEqual([]);
  });
});
