import { describe, expect, it } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, studioGrade, studioTicks, withStudioTakes, type StudioAsset, type StudioEnhancement, type StudioProject } from '../../../../shared/studio';
import { addLayerAsset, addMainAsset, addText, createStudioEditingHistory, duplicateClip, moveLayerClip, patchClip, persistHistoryEdit, splitMainClip, trimMainClip, undoProject, redoProject } from './commands';

const enhancement: StudioEnhancement = { version: 1, strength: .6, exposure: .2, contrast: .1, saturation: .05, temperature: -.1, tint: .2, shadows: .3, highlights: -.2, analyzedFrames: 12 };
const portrait = { version: 1 as const, strength: .4 };
function project(): StudioProject {
  return withStudioTakes({ version: 2, id: 'project', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0',
    editing: emptyStudioEditing('aula'), revision: 0, state: 'draft', progress: 0, createdAt: '', updatedAt: '' });
}
const asset = (id: string, kind: StudioAsset['kind'] = 'video'): StudioAsset => ({ id, kind, uri: `file:///classfy-studio/owner/project/${id}`, name: id,
  durationTicks: kind === 'image' ? 0 : studioTicks(8), ...(kind !== 'audio' ? { width: 1920, height: 1080 } : {}), hasAudio: kind !== 'image' });

describe('comandos mágicos com receita e histórico reais', () => {
  it('um patch aplica ambos efeitos sem tocar grade/original e null remove só o alvo', () => {
    let before = addLayerAsset(addMainAsset(project(), asset('source'), 'main'), asset('image', 'image'), 1, { itemId: 'image', layerId: 'overlay' });
    before = patchClip(before, 'main', { grade: studioGrade('cinematic') });
    const next = patchClip(before, 'main', { enhancement, portrait });
    expect(next.takes[0]).toMatchObject({ enhancement, portrait }); expect(next.editing!.main[0].grade).toEqual(before.editing!.main[0].grade);
    expect(next.editing!.assets).toEqual(before.editing!.assets); expect(before.editing!.main[0]).not.toHaveProperty('portrait');
    expect(compileStudioRecipe(next).version).toBe(3); expect(patchClip(next, 'main', { enhancement, portrait })).toBe(next);
    const layer = patchClip(next, 'image', { portrait }); const removed = patchClip(layer, 'main', { enhancement: null, portrait: null });
    expect(removed.takes[0]).not.toHaveProperty('portrait'); expect(removed.takes[0]).not.toHaveProperty('enhancement');
    expect(compileStudioRecipe(removed).requiredFeatures).toEqual(['portrait-v1']);
    const clean = patchClip(removed, 'image', { portrait: null }); expect(compileStudioRecipe(clean).version).toBe(2);
    expect(patchClip(clean, 'image', { portrait: null })).toBe(clean);
  });

  it('corte, velocidade, split, duplicate e movimento mantêm tratamento ligado ao clip original', () => {
    let next = patchClip(addMainAsset(project(), asset('source'), 'main'), 'main', { enhancement, portrait, playbackRate: 2 });
    next = trimMainClip(next, 'main', 1, 7); expect(next.takes[0]).toMatchObject({ start: 1, end: 7, enhancement, portrait, playbackRate: 2 });
    const split = splitMainClip(next, 'main', 1, { leftId: 'left', rightId: 'right' });
    expect(split.takes.map(take => [take.start, take.end])).toEqual([[1, 3], [3, 7]]);
    expect(split.takes.every(take => JSON.stringify(take.enhancement) === JSON.stringify(enhancement) && take.portrait?.strength === .4)).toBe(true);
    const copy = duplicateClip(split, 'right', 'copy'); expect(copy.takes[2]).toMatchObject({ enhancement, portrait, assetId: 'source' });
    let layer = addLayerAsset(copy, asset('image', 'image'), 0, { itemId: 'image', layerId: 'images' });
    layer = patchClip(layer, 'image', { enhancement, portrait }); layer = moveLayerClip(layer, 'image', 1, 1);
    expect(compileStudioRecipe(layer).clips.find(clip => clip.id === 'image')).toMatchObject({ enhancement, portrait, startTicks: studioTicks(1) });
    expect(layer.editing!.assets).toHaveLength(2);
  });

  it('save rejeitado não avança undo, retry e reabertura JSON mantêm parâmetros, undo/redo reversíveis', async () => {
    const before = addMainAsset(project(), asset('source'), 'main'), next = patchClip(before, 'main', { enhancement, portrait });
    const history = createStudioEditingHistory(); history.sync(before, 'owner');
    await expect(persistHistoryEdit(history, before, next, async () => { throw new Error('Sem espaço.'); })).rejects.toThrow('Sem espaço');
    expect(history.state().undoCount).toBe(0);
    const saved = await persistHistoryEdit(history, before, next, async value => withStudioTakes({ ...value, editing: value.editing!, revision: 1 }));
    expect(history.state().undoCount).toBe(1);
    const reopened = withStudioTakes(JSON.parse(JSON.stringify(saved)) as StudioProject & { editing: NonNullable<StudioProject['editing']> });
    expect(reopened.takes[0]).toMatchObject({ enhancement, portrait }); expect(compileStudioRecipe(reopened)).toEqual(compileStudioRecipe(saved));
    const undone = await undoProject(saved, history, async value => withStudioTakes({ ...value, editing: value.editing!, revision: 2 }));
    expect(compileStudioRecipe(undone).version).toBe(2); expect(undone.editing!.assets).toEqual(saved.editing!.assets);
    const redone = await redoProject(undone, history, async value => withStudioTakes({ ...value, editing: value.editing!, revision: 3 }));
    expect(redone.takes[0]).toMatchObject({ enhancement, portrait }); expect(compileStudioRecipe(redone).version).toBe(3);
  });

  it('patch inválido é atômico e não permite tratamento em texto/áudio nem trocar a fonte', () => {
    const before = addText(addLayerAsset(addMainAsset(project(), asset('source'), 'main'), asset('audio', 'audio'), 0, { itemId: 'audio', layerId: 'audio' }), 'Texto', 0, 3, { itemId: 'text', layerId: 'text' });
    const json = JSON.stringify(before);
    expect(() => patchClip(before, 'main', { enhancement, portrait: { version: 1, strength: 2 } })).toThrow('retoque');
    expect(() => patchClip(before, 'text', { portrait })).toThrow('imagem ou vídeo');
    expect(() => patchClip(before, 'audio', { enhancement })).toThrow('imagem ou vídeo');
    expect(() => patchClip(before, 'main', { assetId: 'other' } as never)).toThrow('corte ou movimento');
    expect(JSON.stringify(before)).toBe(json);
    expect(() => patchClip({ ...before, state: 'submitted' }, 'main', { enhancement })).toThrow('Aguarde');
  });
});
