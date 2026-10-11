// Ported from the mobile pure-core regressions; domain imports execute the extracted production TypeScript.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as model from './model.ts';
import { freezeStudioLayerTimeline as freeze, studioLayerDragRange as drag, applyStudioLayerTimelineRange as apply,
  canContinueStudioLayerTimeline as continues, studioLayerDragDestination as destination } from './layerTimelineInteraction.ts';
const ticks = model.studioTicks;
function fixture(item, neighbors = []) {
  return { ...model.emptyStudioEditing('aula'), assets: [
    { id: 'main', kind: 'video', uri: 'file:///main.mov', name: 'Main', durationTicks: ticks(20) },
    { id: 'overlay', kind: item.kind === 'audio' ? 'audio' : item.kind === 'image' ? 'image' : 'video', uri: 'file:///overlay.mov', name: 'Original', durationTicks: item.kind === 'image' ? 0 : ticks(7) },
  ], main: [
    { id: 'a', assetId: 'main', sourceStartTicks: ticks(2), sourceEndTicks: ticks(8) },
    { id: 'b', assetId: 'main', sourceStartTicks: ticks(10), sourceEndTicks: ticks(16) },
  ], layers: [{ id: 'track', kind: item.kind, items: [item, ...neighbors] }] };
}
const video = { id: 'layer', kind: 'video', assetId: 'overlay', atTicks: ticks(2), durationTicks: ticks(3), sourceStartTicks: ticks(1), sourceEndTicks: ticks(4) };
const interval = editing => {
  const clip = model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.find(clip => clip.id === 'layer');
  return { start: model.studioSeconds(clip.startTicks), end: model.studioSeconds(clip.startTicks + clip.durationTicks),
    sourceStart: model.studioSeconds(clip.sourceStartTicks), sourceEnd: model.studioSeconds(clip.sourceEndTicks) };
};

test('destino vertical usa posições canônicas, limiar simétrico e clamp sem fundir faixas', () => {
  assert.equal(destination(3, [1, 3, 8], 13), 3);
  assert.equal(destination(3, [1, 3, 8], 14), 8);
  assert.equal(destination(3, [1, 3, 8], -14), 1);
  assert.equal(destination(3, [1, 3, 8], 10000), 8);
  assert.equal(destination(3, [1, 3, 8], -10000), 1);
  assert.equal(destination(3, [1, 3, 8], NaN), 3);
  assert.equal(destination(9, [1, 3, 8], 28), 9);
  assert.equal(destination(3, [1, 3, 8], 28, 0), 3);
});

test('diagonal extraído de grupo usa limites da aula, mantendo vizinhos e trecho original', () => {
  const audio = { ...video, kind: 'audio' };
  const neighbor = { ...audio, id: 'neighbor', atTicks: ticks(6) };
  const editing = fixture(audio, [neighbor]);
  const frozen = freeze(editing, 'layer');
  assert.deepEqual(drag(frozen, 'move', 4), { startSeconds: 3, endSeconds: 6 });
  const range = drag(frozen, 'move', 4, true);
  assert.deepEqual(range, { startSeconds: 6, endSeconds: 9 });
  const reordered = model.moveStudioLayerItemToLane(editing, 'layer', 2);
  const saved = apply(reordered, 'layer', range, 'move');
  assert.deepEqual(interval(saved), { start: 6, end: 9, sourceStart: 1, sourceEnd: 4 });
  assert.deepEqual(saved.layers[0].items, [neighbor]);
  assert.deepEqual(model.validateStudioEditing(saved, 'aula'), []);
  assert.deepEqual(drag(frozen, 'move', 100, true), { startSeconds: 9, endSeconds: 12 });
});

for (const kind of ['video', 'audio']) test(`${kind}: bordas respeitam o original e mantêm duração 1:1, sem esticar velocidade`, () => {
  const editing = fixture({ ...video, kind }); const snapshot = freeze(editing, 'layer');
  assert.deepEqual(drag(snapshot, 'start', -100), { startSeconds: 1, endSeconds: 5 });
  assert.deepEqual(drag(snapshot, 'end', 100), { startSeconds: 2, endSeconds: 8 });
  const left = apply(editing, 'layer', drag(snapshot, 'start', -100));
  assert.deepEqual(interval(left), { start: 1, end: 5, sourceStart: 0, sourceEnd: 4 });
  const right = apply(editing, 'layer', drag(snapshot, 'end', 100));
  assert.deepEqual(interval(right), { start: 2, end: 8, sourceStart: 1, sourceEnd: 7 });
  assert.deepEqual(model.validateStudioEditing(left, 'aula'), []);
  assert.deepEqual(model.validateStudioEditing(right, 'aula'), []);
  assert.equal(editing.assets, right.assets, 'immutable originals are reused');
  assert.equal(editing.layers[0].items[0].durationTicks, ticks(3));
});

test('mover preserva o trecho original e permite atravessar takes sem deslocar a faixa principal', () => {
  const editing = fixture({ ...video, atTicks: 0, anchor: { clipId: 'a', offsetTicks: ticks(2) } });
  const snapshot = freeze(editing, 'layer'); const moved = apply(editing, 'layer', drag(snapshot, 'move', 5), 'move');
  assert.deepEqual(interval(moved), { start: 7, end: 10, sourceStart: 1, sourceEnd: 4 });
  assert.equal(moved.layers[0].items[0].anchor, undefined);
  assert.equal(moved.main, editing.main);
  assert.deepEqual(model.validateStudioEditing(moved, 'aula'), []);
});

for (const kind of ['text', 'image']) test(`${kind}: pode durar toda a aula; estender para fora do take desvincula o anchor`, () => {
  const item = kind === 'text' ? model.createStudioTextItem({ id: 'layer', clipId: 'a', durationTicks: ticks(3) })
    : { id: 'layer', kind, assetId: 'overlay', atTicks: 0, durationTicks: ticks(3), anchor: { clipId: 'a', offsetTicks: 0 } };
  const editing = fixture(item), snapshot = freeze(editing, 'layer');
  const range = drag(snapshot, 'end', 100); assert.deepEqual(range, { startSeconds: 0, endSeconds: 12 });
  const stretched = apply(editing, 'layer', range);
  assert.deepEqual(interval(stretched), { start: 0, end: 12, sourceStart: 0, sourceEnd: 0 });
  assert.equal(stretched.layers[0].items[0].anchor, undefined);
  assert.deepEqual(model.validateStudioEditing(stretched, 'aula'), []);
});

test('anchor por offset e por origem permanece correto dentro do host já cortado', () => {
  for (const anchor of [{ clipId: 'b', offsetTicks: ticks(2) }, { clipId: 'b', sourceStartTicks: ticks(12), sourceEndTicks: ticks(15) }]) {
    const editing = fixture({ ...video, atTicks: 0, anchor }); const snapshot = freeze(editing, 'layer');
    assert.equal(snapshot.startSeconds, 8); assert.equal(snapshot.endSeconds, 11);
    const cut = apply(editing, 'layer', drag(snapshot, 'start', 0.5));
    assert.deepEqual(interval(cut), { start: 8.5, end: 11, sourceStart: 1.5, sourceEnd: 4 });
    const saved = cut.layers[0].items[0].anchor;
    assert.equal(saved.clipId, 'b');
    if (anchor.offsetTicks !== undefined) assert.equal(saved.offsetTicks, ticks(2.5));
    else { assert.equal(saved.sourceStartTicks, ticks(12.5)); assert.equal(saved.sourceEndTicks, ticks(15)); }
    assert.deepEqual(model.validateStudioEditing(cut, 'aula'), []);
  }
});

test('intervalos anterior e seguinte da mesma faixa limitam alças e movimento', () => {
  const make = (id, start, end) => ({ ...model.createStudioTextItem({ id, atTicks: ticks(start), durationTicks: ticks(end - start) }) });
  const editing = fixture(make('layer', 3, 5), [make('previous', 0, 2), make('next', 7, 10)]), snapshot = freeze(editing, 'layer');
  assert.deepEqual(drag(snapshot, 'start', -100), { startSeconds: 2, endSeconds: 5 });
  assert.deepEqual(drag(snapshot, 'end', 100), { startSeconds: 3, endSeconds: 7 });
  assert.deepEqual(drag(snapshot, 'move', 100), { startSeconds: 5, endSeconds: 7 });
  assert.deepEqual(drag(snapshot, 'move', -100), { startSeconds: 2, endSeconds: 4 });
  assert.throws(() => apply(editing, 'layer', { startSeconds: 3, endSeconds: 8 }), /vizinho/);
});

test('seleção, fonte original, corte do main e mudança canônica invalidam o gesto congelado', () => {
  const editing = fixture(video), snapshot = freeze(editing, 'layer');
  assert.equal(continues(snapshot, editing, 'layer'), true);
  assert.equal(continues(snapshot, editing, 'other'), false);
  assert.equal(continues(snapshot, { ...editing, assets: editing.assets.map(asset => ({ ...asset, uri: `${asset.uri}.new` })) }, 'layer'), false);
  assert.equal(continues(snapshot, { ...editing, main: editing.main.map(clip => ({ ...clip, sourceStartTicks: clip.sourceStartTicks + ticks(0.1) })) }, 'layer'), false);
  assert.equal(continues(snapshot, model.patchStudioLayerItem(editing, 'layer', { opacity: 0.5 }), 'layer'), false);
});

test('encurtar restringe fades; valores inválidos e mudança de duração em modo move são rejeitados', () => {
  const editing = fixture({ ...video, fadeInTicks: ticks(0.5), fadeOutTicks: ticks(0.8) }), snapshot = freeze(editing, 'layer');
  const range = drag(snapshot, 'end', -2.8), short = apply(editing, 'layer', range);
  assert.equal(short.layers[0].items[0].fadeInTicks, ticks(0.2));
  assert.equal(short.layers[0].items[0].fadeOutTicks, 0);
  assert.deepEqual(model.validateStudioEditing(short, 'aula'), []);
  assert.throws(() => apply(editing, 'layer', { startSeconds: NaN, endSeconds: 5 }), /válida/);
  assert.throws(() => apply(editing, 'layer', { startSeconds: 2, endSeconds: 4 }, 'move'), /ultrapassa/);
  assert.deepEqual(drag(snapshot, 'start', NaN), { startSeconds: 2, endSeconds: 5 });
});
