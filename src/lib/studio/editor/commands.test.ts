import { describe, expect, it } from 'vitest';
import {
  addStudioLayerItem, compileStudioRecipe, emptyStudioEditing, studioTicks, validateStudioEditing, withStudioTakes,
  captureStudioPlaybackAnchor, restoreStudioPlaybackAnchor, type StudioAsset, type StudioProject,
} from '../../../../shared/studio';
import {
  addMainAsset, addLayerAsset, addText, createStudioEditingHistory, duplicateClip, moveMainClip, moveLayerClip,
  patchClip, persistHistoryEdit, redoProject, removeClip, setMainMuted, setLayerHidden, setLayerMuted,
  splitMainClip, trimMainClip, trimLayerClip, undoProject,
} from './commands';
import { studioAssetUri } from './storage';

function project(): StudioProject {
  return withStudioTakes({ version: 2, id: 'project', ownerId: 'owner', kind: 'aula', title: 'Aula', description: '', objective: '', audience: '', script: '', tags: [],
    visibility: 'free', price: '0', editing: emptyStudioEditing('aula'), createdAt: '2026-10-11T00:00:00.000Z', updatedAt: '2026-10-11T00:00:00.000Z', revision: 0, state: 'draft', progress: 0 });
}
function asset(id = 'source', duration = 24, kind: StudioAsset['kind'] = 'video'): StudioAsset {
  return { id, name: `${id}.${kind === 'image' ? 'jpg' : kind === 'audio' ? 'm4a' : 'mp4'}`, kind,
    uri: studioAssetUri('owner', 'project', id, `${id}.${kind === 'image' ? 'jpg' : kind === 'audio' ? 'm4a' : 'mp4'}`), durationTicks: kind === 'image' ? 0 : studioTicks(duration),
    ...(kind !== 'audio' ? { width: 1920, height: 1080 } : {}), ...(kind === 'video' ? { frameRate: 30, hasAudio: true } : {}) };
}
const clip = (value: StudioProject, id: string) => compileStudioRecipe(value).clips.find(item => item.id === id)!;

describe('comandos sobre o domínio extraído, com receita e originais reais', () => {
  it('velocidade e corte mantêm âncora na fonte, ripple e schema canônico', () => {
    const imported = addMainAsset(project(), asset(), 'main');
    const anchored = withStudioTakes({ ...imported, editing: addStudioLayerItem(imported.editing!, {
      id: 'title', kind: 'text', atTicks: 0, durationTicks: studioTicks(4), anchor: { clipId: 'main', sourceStartTicks: studioTicks(6), sourceEndTicks: studioTicks(10) },
      text: { content: 'Ideia', fontFamily: 'System', fontSize: .06, color: '#FFFFFF', backgroundColor: '#00000000', alignment: 'center' },
    }, 'titles') });
    const fast = patchClip(anchored, 'main', { playbackRate: 2 });
    expect(compileStudioRecipe(fast).durationTicks).toBe(studioTicks(12));
    expect(clip(fast, 'title')).toMatchObject({ startTicks: studioTicks(3), durationTicks: studioTicks(2) });
    const trimmed = trimMainClip(fast, 'main', 4, 20);
    expect(clip(trimmed, 'title')).toMatchObject({ startTicks: studioTicks(1), durationTicks: studioTicks(2) });
    expect(trimmed.editing!.assets).toEqual(imported.editing!.assets);
    expect(compileStudioRecipe(trimmed).durationTicks).toBe(studioTicks(8));
    expect(trimmed.revision).toBe(0);
    expect(JSON.parse(JSON.stringify(trimmed))).not.toHaveProperty('takes');
    expect(validateStudioEditing(trimmed.editing!, 'aula')).toEqual([]);
  });
  it('split em velocidade 2× usa cursor global e reaproveita o original/âncoras', () => {
    let value = patchClip(addMainAsset(project(), asset(), 'main'), 'main', { playbackRate: 2, gain: .4, fadeInTicks: studioTicks(.5), fadeOutTicks: studioTicks(.5) });
    value = withStudioTakes({ ...value, editing: addStudioLayerItem(value.editing!, { id: 'caption', kind: 'caption', atTicks: 0, durationTicks: studioTicks(4),
      anchor: { clipId: 'main', sourceStartTicks: studioTicks(10), sourceEndTicks: studioTicks(14) },
      text: { content: 'Continuidade', fontFamily: 'System', fontSize: .04, color: '#FFFFFF', backgroundColor: '#00000000', alignment: 'center' } }, 'captions') });
    const before = JSON.stringify(value), next = splitMainClip(value, 'main', 6, { leftId: 'left', rightId: 'right' });
    expect(JSON.stringify(value)).toBe(before);
    expect(next.takes.map(take => [take.id, take.start, take.end, take.playbackRate])).toEqual([['left', 0, 12, 2], ['right', 12, 24, 2]]);
    expect(next.editing!.assets).toHaveLength(1);
    expect(compileStudioRecipe(next).durationTicks).toBe(studioTicks(12));
    const captions = compileStudioRecipe(next).clips.filter(item => item.kind === 'caption');
    expect(captions.map(item => [item.startTicks, item.durationTicks])).toEqual([[studioTicks(5), studioTicks(1)], [studioTicks(6), studioTicks(1)]]);
    expect(next.editing!.main.map(item => [item.gain, item.fadeInTicks, item.fadeOutTicks])).toEqual([[.4, studioTicks(.5), 0], [.4, 0, studioTicks(.5)]]);
    expect(() => splitMainClip(value, 'main', .25)).toThrow(/suave/);
  });
  it('reordena sem perder posição na fonte e duplicar/remover conserva biblioteca', () => {
    let value = addMainAsset(addMainAsset(project(), asset('a', 4), 'a'), asset('b', 6), 'b');
    const anchor = captureStudioPlaybackAnchor(value.takes, { takeId: 'b', sourcePosition: 2, position: 6 });
    value = moveMainClip(value, 'b', 0);
    expect(value.takes.map(take => take.id)).toEqual(['b', 'a']);
    expect(restoreStudioPlaybackAnchor(value.takes, anchor)).toMatchObject({ position: 2, source: { takeId: 'b', seconds: 2 } });
    value = duplicateClip(value, 'b', 'copy'); value = removeClip(value, 'b');
    expect(value.takes.map(take => take.id)).toEqual(['copy', 'a']); expect(value.editing!.assets).toHaveLength(2);
    expect(clip(value, 'copy').assetId).toBe('b');
    expect(() => splitMainClip(value, 'a', 1)).toThrow(/selecionado/);
  });
  it('trim/movimento de camada são rate-aware e preservar fonte não depende da faixa', () => {
    let value = addMainAsset(project(), asset('main-source', 12), 'main');
    value = addLayerAsset(value, asset('overlay', 6), 0, { itemId: 'pip', layerId: 'video' });
    value = patchClip(value, 'pip', { playbackRate: 2 });
    value = trimLayerClip(value, 'pip', 1, 2.5);
    const before = clip(value, 'pip');
    expect([before.sourceStartTicks, before.sourceEndTicks]).toEqual([studioTicks(2), studioTicks(5)]);
    value = addText(value, 'Título', 0, 3, { itemId: 'title', layerId: 'titles' });
    value = moveLayerClip(value, 'pip', 5, 2);
    const after = clip(value, 'pip');
    expect([after.sourceStartTicks, after.sourceEndTicks]).toEqual([studioTicks(2), studioTicks(5)]);
    expect(after.startTicks).toBe(studioTicks(5)); expect(after.zIndex).toBe(2);
    expect(after.durationTicks).toBe(studioTicks(1.5));
  });
  it('mute/hide mantêm valores originais e comandos no-op não geram outra edição', () => {
    let value = addText(addMainAsset(project(), asset(), 'main'), 'Texto', 0, 3, { itemId: 'title', layerId: 'titles' });
    value = patchClip(value, 'main', { gain: .3 }); value = patchClip(value, 'title', { opacity: .7, gain: .4 });
    const original = value;
    value = setMainMuted(setLayerMuted(setLayerHidden(value, 'titles', true), 'titles', true), true);
    expect(clip(value, 'main').gain).toBe(0); expect(clip(value, 'title')).toMatchObject({ opacity: 0, gain: 0 });
    expect(value.editing!.main[0].gain).toBe(.3); expect(value.editing!.layers[0].items[0].opacity).toBe(.7);
    expect(setMainMuted(value, true)).toBe(value);
    value = setMainMuted(setLayerMuted(setLayerHidden(value, 'titles', false), 'titles', false), false);
    expect(compileStudioRecipe(value)).toEqual(compileStudioRecipe(original));
    expect(() => patchClip(value, 'main', { assetId: 'other' } as never)).toThrow(/intervalo/);
  });
  it('12 camadas continuam em receita e seleção fora do tempo não muda cursor ou estado', () => {
    let value = addMainAsset(project(), asset(), 'main');
    for (let index = 0; index < 12; index++) value = addText(value, `Texto ${index}`, index, 1, { itemId: `text-${index}`, layerId: `lane-${index}` });
    expect(value.editing!.layers).toHaveLength(12); expect(compileStudioRecipe(value).clips).toHaveLength(13);
    expect(clip(value, 'text-11').startTicks).toBe(studioTicks(11));
    const anchor = captureStudioPlaybackAnchor(value.takes, { takeId: 'main', sourcePosition: 2, position: 2 });
    const changed = patchClip(value, 'text-11', { rect: { x: .2 }, text: { content: 'Futuro' } });
    expect(restoreStudioPlaybackAnchor(changed.takes, anchor)?.position).toBe(2);
  });
});

describe('histórico vinculado à confirmação durável', () => {
  it('erro/no-op não avança; sucesso, undo e redo conservam originais', async () => {
    const before = addMainAsset(project(), asset(), 'main'), history = createStudioEditingHistory(); history.sync(before);
    const changed = patchClip(before, 'main', { playbackRate: 2, rect: { x: -.1, width: 1.2 } });
    await expect(persistHistoryEdit(history, before, changed, async () => { throw Error('QuotaExceededError'); })).rejects.toThrow('Quota');
    expect(history.state().canUndo).toBe(false);
    let writes = 0;
    const persist = async (value: StudioProject) => { writes++; return withStudioTakes({ ...value, editing: value.editing!, revision: value.revision + 1 }); };
    await persistHistoryEdit(history, before, before, persist); expect(writes).toBe(0);
    const saved = await persistHistoryEdit(history, before, changed, persist); expect(history.state().undoCount).toBe(1);
    const undone = await undoProject(saved, history, persist); expect(compileStudioRecipe(undone)).toEqual(compileStudioRecipe(before));
    const redone = await redoProject(undone, history, persist); expect(compileStudioRecipe(redone)).toEqual(compileStudioRecipe(changed));
    expect(redone.editing!.assets).toEqual(before.editing!.assets); expect(writes).toBe(3);
  });
  it('late save não reata histórico depois de trocar a sessão', async () => {
    const before = addMainAsset(project(), asset(), 'main'), history = createStudioEditingHistory(); history.sync(before);
    let resolve!: (value: StudioProject) => void;
    const pending = persistHistoryEdit(history, before, patchClip(before, 'main', { gain: .5 }), () => new Promise(done => { resolve = done; }));
    history.clear(); resolve(patchClip(before, 'main', { gain: .5 })); await pending;
    expect(history.state().canUndo).toBe(false); expect(history.state().canRedo).toBe(false);
  });
});
