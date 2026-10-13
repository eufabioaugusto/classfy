import { describe, expect, it } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, studioTicks, withStudioTakes, type StudioAsset, type StudioProject, type StudioSignature } from '../../../../shared/studio';
import { addLayerAsset, addMainAsset, addText, createStudioEditingHistory, duplicateClip, moveLayerClip, patchClip, persistHistoryEdit, redoProject, splitMainClip, trimMainClip, undoProject } from './commands';

const signature: StudioSignature = { version: 1, strength: .7, subjectExposure: .3, backgroundExposure: -.8, backgroundBlur: .3, temperature: .1 };
const asset = (id: string, kind: StudioAsset['kind'] = 'video'): StudioAsset => ({ id, kind, name: id, uri: `file:///owner/project/${id}`,
  durationTicks: kind === 'image' ? 0 : studioTicks(8), ...(kind !== 'audio' ? { width: 1920, height: 1080 } : {}), hasAudio: kind !== 'image' });
function project(): StudioProject {
  return withStudioTakes({ version: 2, id: 'project', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0',
    editing: emptyStudioEditing('aula'), revision: 0, state: 'draft', progress: 0, createdAt: '', updatedAt: '' });
}

describe('comandos de assinatura cinematográfica com fontes e histórico reais', () => {
  it('patch reversível e cortes mantêm fonte, rate, posição e assinatura de cada clip', () => {
    const before = addMainAsset(project(), asset('source'), 'main');
    let next = patchClip(before, 'main', { signature, playbackRate: 2 });
    next = trimMainClip(next, 'main', 1, 7);
    const split = splitMainClip(next, 'main', 1, { leftId: 'left', rightId: 'right' });
    expect(split.takes.map(take => [take.start, take.end])).toEqual([[1, 3], [3, 7]]);
    expect(split.takes.every(take => take.playbackRate === 2 && JSON.stringify(take.signature) === JSON.stringify(signature))).toBe(true);
    const copy = duplicateClip(split, 'right', 'copy'); expect(copy.takes[2]).toMatchObject({ assetId: 'source', signature });
    let layer = addLayerAsset(copy, asset('image', 'image'), 0, { itemId: 'image', layerId: 'images' });
    layer = moveLayerClip(patchClip(layer, 'image', { signature }), 'image', 1, 1);
    expect(compileStudioRecipe(layer).clips.find(clip => clip.id === 'image')).toMatchObject({ startTicks: studioTicks(1), signature });
    const removed = patchClip(layer, 'image', { signature: null }); expect(removed.editing!.layers[0].items[0]).not.toHaveProperty('signature');
    expect(removed.takes[2].signature).toEqual(signature); expect(removed.editing!.assets.map(item => item.id)).toEqual(['source', 'image']);
    expect(before.takes[0]).not.toHaveProperty('signature'); expect(patchClip(layer, 'image', { signature })).toBe(layer);
  });

  it('falha de persistência não avança undo; retry, reopen e undo/redo preservam a receita versionada', async () => {
    const before = addMainAsset(project(), asset('source'), 'main'), next = patchClip(before, 'main', { signature });
    const history = createStudioEditingHistory(); history.sync(before, 'owner');
    await expect(persistHistoryEdit(history, before, next, async () => { throw new Error('Sem espaço.'); })).rejects.toThrow('Sem espaço');
    expect(history.state().undoCount).toBe(0);
    const saved = await persistHistoryEdit(history, before, next, async value => withStudioTakes({ ...value, editing: value.editing!, revision: 1 }));
    const reopened = withStudioTakes(JSON.parse(JSON.stringify(saved)) as StudioProject & { editing: NonNullable<StudioProject['editing']> });
    expect(reopened.takes[0].signature).toEqual(signature); expect(compileStudioRecipe(reopened)).toEqual(compileStudioRecipe(saved));
    const undo = await undoProject(saved, history, async value => withStudioTakes({ ...value, editing: value.editing!, revision: 2 }));
    expect(compileStudioRecipe(undo).version).toBe(2);
    const redo = await redoProject(undo, history, async value => withStudioTakes({ ...value, editing: value.editing!, revision: 3 }));
    expect(compileStudioRecipe(redo).requiredFeatures).toEqual(['cinematic-signature-v1']); expect(redo.takes[0].signature).toEqual(signature);
  });

  it('patch inválido não aplica parcialmente rect/grade e rejeita tratamento em texto/áudio ou projeto enviado', () => {
    const before = addText(addLayerAsset(addMainAsset(project(), asset('source'), 'main'), asset('audio', 'audio'), 0, { itemId: 'audio' }), 'Texto', 0, 3, { itemId: 'text' });
    const snapshot = JSON.stringify(before);
    expect(() => patchClip(before, 'main', { rect: { x: .2 }, signature: { ...signature, strength: 2 } })).toThrow('assinatura');
    expect(() => patchClip(before, 'text', { signature })).toThrow('imagem ou vídeo');
    expect(() => patchClip(before, 'audio', { signature })).toThrow('imagem ou vídeo');
    expect(() => patchClip({ ...before, state: 'submitted' }, 'main', { signature })).toThrow('Aguarde');
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
