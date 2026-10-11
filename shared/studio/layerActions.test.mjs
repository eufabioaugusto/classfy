// Ported from the mobile pure-core regressions; domain imports execute the extracted production TypeScript.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as model from './model.ts';
import { duplicateStudioLayer as duplicate, splitStudioLayer as split, canSplitStudioLayer as canSplit } from './layerActions.ts';
const ticks = model.studioTicks;
function fixture(kind = 'text') {
  const item = { ...model.createStudioTextItem({ id: 'title', atTicks: ticks(2), durationTicks: ticks(4) }),
    kind, anchor: { clipId: 'main', offsetTicks: ticks(2) }, fadeInTicks: ticks(.2), fadeOutTicks: ticks(.3),
    ...(kind === 'video' || kind === 'audio' ? { assetId: 'overlay', sourceStartTicks: ticks(1), sourceEndTicks: ticks(5) } : {}) };
  if (kind !== 'text') delete item.text;
  return { ...model.emptyStudioEditing('aula'), assets: [
    { id: 'original', kind: 'video', uri: 'file:///main.mp4', name: 'Main', durationTicks: ticks(20) },
    { id: 'overlay', kind: kind === 'text' ? 'video' : kind, uri: 'file:///overlay.mp4', name: 'Overlay', durationTicks: ticks(10) },
  ], main: [{ id: 'main', assetId: 'original', sourceStartTicks: ticks(5), sourceEndTicks: ticks(15) }],
  layers: [{ id: 'layer', kind, items: [item] }] };
}
test('duplicar preserva tempo e estilo em faixa independente sem alterar original', () => {
  const original = fixture(), snapshot = structuredClone(original);
  const next = duplicate(original, 'title', 'copy');
  assert.deepEqual(original, snapshot);
  assert.equal(next.layers.length, 2);
  const copy = next.layers[1].items[0];
  assert.deepEqual({ ...copy, id: 'title' }, original.layers[0].items[0]);
  copy.text.content = 'Novo'; copy.rect.x = .2;
  assert.equal(original.layers[0].items[0].text.content, 'Seu título');
  assert.equal(original.layers[0].items[0].rect.x, .08);
  assert.throws(() => duplicate(next, 'title', 'copy'), /identificação nova/);
});
for (const kind of ['text', 'video', 'audio']) test(`dividir ${kind} mantém frames, âncora e ordem da faixa`, () => {
  const original = fixture(kind), snapshot = structuredClone(original), next = split(original, 'title', 3.5, 'right');
  assert.deepEqual(original, snapshot);
  const clips = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: next }).clips.filter(clip => clip.zIndex > 0);
  assert.equal(clips.length, 2);
  assert.deepEqual(clips.map(clip => [clip.id, clip.startTicks, clip.durationTicks]), [['title', ticks(2), ticks(1.5)], ['right', ticks(3.5), ticks(2.5)]]);
  const [left, right] = next.layers[0].items;
  assert.equal(left.fadeOutTicks, 0); assert.equal(right.fadeInTicks, 0);
  assert.equal(left.fadeInTicks, ticks(.2)); assert.equal(right.fadeOutTicks, ticks(.3));
  assert.equal(right.anchor.clipId, 'main'); assert.equal(right.anchor.offsetTicks, ticks(3.5));
  if (kind !== 'text') assert.deepEqual(clips.map(clip => [clip.sourceStartTicks, clip.sourceEndTicks]), [[ticks(1), ticks(2.5)], [ticks(2.5), ticks(5)]]);
  assert.deepEqual(model.validateStudioEditing(next, 'aula'), []);
});
test('divisão exige cursor no intervalo real e mínimo de 0,1s, inclusive âncora recortada', () => {
  const editing = fixture();
  editing.layers[0].items[0].fadeInTicks = 0; editing.layers[0].items[0].fadeOutTicks = 0;
  for (const seconds of [NaN, Infinity, -1, 2, 2.099, 5.901, 6, 10]) assert.equal(canSplit(editing, 'title', seconds), false);
  assert.equal(canSplit(editing, 'title', 2.1), true);
  assert.equal(canSplit(editing, 'title', 5.9), true);
  assert.equal(canSplit(editing, 'missing', 3), false);
  assert.throws(() => split(editing, 'title', 2, 'right'), /cursor/);
  editing.layers[0].items[0].anchor = { clipId: 'main', sourceStartTicks: ticks(4), sourceEndTicks: ticks(9) };
  assert.equal(canSplit(editing, 'title', .05), false);
  const next = split(editing, 'title', 2, 'right');
  const clips = model.compileStudioRecipe({ kind: 'aula', takes: [], editing: next }).clips.filter(clip => clip.zIndex > 0);
  assert.deepEqual(clips.map(clip => [clip.startTicks, clip.durationTicks]), [[0, ticks(2)], [ticks(2), ticks(2)]]);
});

test('divisão dentro de entrada ou saída suave é bloqueada sem alterar o original', () => {
  const editing = fixture('audio');
  editing.layers[0].items[0].fadeInTicks = ticks(1); editing.layers[0].items[0].fadeOutTicks = ticks(.8);
  const original = structuredClone(editing);
  for (const seconds of [2.1, 2.2, 2.99999, 5.20001, 5.9]) {
    assert.equal(canSplit(editing, 'title', seconds), false);
    assert.throws(() => split(editing, 'title', seconds, 'right'), /entrada ou saída suave/);
    assert.deepEqual(editing, original);
  }
  for (const seconds of [3, 3.1, 5.2]) assert.equal(canSplit(editing, 'title', seconds), true);
});

// The same linear ramps drive native alpha and AVMutableAudioMix volume.
function renderedLevel(clips, atTicks, property) {
  const clip = clips.find(value => value.startTicks <= atTicks && atTicks < value.startTicks + value.durationTicks);
  if (!clip) return 0;
  const local = atTicks - clip.startTicks;
  const enter = clip.fadeInTicks ? Math.min(1, Math.max(0, local / clip.fadeInTicks)) : 1;
  const leave = clip.fadeOutTicks ? Math.min(1, Math.max(0, (clip.durationTicks - local) / clip.fadeOutTicks)) : 1;
  return clip[property] * enter * leave;
}
const layerClips = editing => model.compileStudioRecipe({ kind: 'aula', takes: [], editing }).clips.filter(clip => clip.zIndex > 0);
function assertSameEnvelope(original, parts) {
  const start = original[0].startTicks, end = start + original[0].durationTicks;
  const sampleTimes = new Set([start, end - 1, ...parts.flatMap(clip => [clip.startTicks, clip.startTicks + clip.durationTicks - 1])]);
  for (let at = start; at < end; at += ticks(.037)) sampleTimes.add(at);
  for (const at of sampleTimes) for (const property of ['opacity', 'gain']) {
    assert.ok(Math.abs(renderedLevel(original, at, property) - renderedLevel(parts, at, property)) < 1e-10,
      `${property} mudou em ${model.studioSeconds(at)}s`);
  }
}

for (const kind of ['text', 'video', 'audio']) test(`divisões permitidas de ${kind} mantêm alpha e ganho em toda a curva, inclusive bordas dos fades`, () => {
  const editing = fixture(kind);
  Object.assign(editing.layers[0].items[0], { fadeInTicks: ticks(1), fadeOutTicks: ticks(.8), opacity: .6, gain: .75 });
  const original = layerClips(editing);
  for (const seconds of [3, 3.7, 5.2]) {
    assert.equal(canSplit(editing, 'title', seconds), true);
    const next = split(editing, 'title', seconds, 'right'), parts = layerClips(next);
    assertSameEnvelope(original, parts);
    assert.equal(parts[0].fadeInTicks, ticks(1)); assert.equal(parts[0].fadeOutTicks, 0);
    assert.equal(parts[1].fadeInTicks, 0); assert.equal(parts[1].fadeOutTicks, ticks(.8));
    assert.deepEqual(model.validateStudioEditing(next, 'aula'), []);
  }
});

test('saída suave permanece inteira mesmo se o trecho direito for menor que a entrada original', () => {
  const editing = fixture('audio');
  Object.assign(editing.layers[0].items[0], { fadeInTicks: ticks(1.3), fadeOutTicks: ticks(.3), gain: .8 });
  const original = layerClips(editing), next = split(editing, 'title', 5.6, 'right'), parts = layerClips(next);
  assert.equal(parts[1].durationTicks, ticks(.4)); assert.equal(parts[1].fadeOutTicks, ticks(.3));
  assertSameEnvelope(original, parts);
});

test('divisão usa fades efetivos da âncora recortada e preserva rampa sem trecho constante', () => {
  const editing = fixture();
  Object.assign(editing.layers[0].items[0], { durationTicks: ticks(10), fadeInTicks: ticks(.2), fadeOutTicks: ticks(8),
    anchor: { clipId: 'main', sourceStartTicks: ticks(4), sourceEndTicks: ticks(9) } });
  const original = layerClips(editing);
  assert.equal(original[0].startTicks, 0); assert.equal(original[0].durationTicks, ticks(4));
  assert.equal(original[0].fadeOutTicks, ticks(3.8));
  assert.equal(canSplit(editing, 'title', .19999), false); assert.equal(canSplit(editing, 'title', .20001), false);
  assert.equal(canSplit(editing, 'title', .2), true);
  const next = split(editing, 'title', .2, 'right'), parts = layerClips(next);
  assertSameEnvelope(original, parts);
  assert.deepEqual(model.validateStudioEditing(next, 'aula'), []);
});
