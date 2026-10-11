// Ported from the mobile pure-core regressions; domain imports execute the extracted production TypeScript.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import * as model from './model.ts';
import { createStudioEditingHistory } from './editingHistory.ts';
import { splitStudioTake, duplicateStudioTake } from './timeline.ts';
import { patchStudioCanvasTransform, mergeStudioCanvasDraft } from './canvasEditing.ts';
const project = () => model.migrateStudioProject({ version: 1, id: 'p', ownerId: 'creator', kind: 'aula', title: 'Aula', revision: 1, state: 'draft',
  takes: [{ id: 'main', uri: 'file:///original.mov', name: 'Original', duration: 8, start: 0, end: 8, width: 1920, height: 1080 }] });
const transformed = { rect: { x: -0.25, y: -0.25, width: 1.5, height: 1.5 } };

test('enquadramento do vídeo principal chega à receita, invalida exportação e preserva o original', () => {
  const p = project(), initial = structuredClone(p.editing);
  const editing = patchStudioCanvasTransform(p.editing, 'main', transformed);
  const recipe = model.compileStudioRecipe({ ...p, editing });
  assert.deepEqual(recipe.clips[0].rect, transformed.rect);
  assert.deepEqual(editing.assets, initial.assets);
  assert.deepEqual(p.editing, initial);
  assert.equal(editing.main[0].sourceStartTicks, initial.main[0].sourceStartTicks);
  assert.equal(editing.main[0].sourceEndTicks, initial.main[0].sourceEndTicks);
  assert.notEqual(model.timelineSignature(p), model.timelineSignature({ ...p, editing }));
});

test('dividir, duplicar e serializar preservam enquadramento sem criar outro original', () => {
  let p = project(); p.editing = patchStudioCanvasTransform(p.editing, 'main', transformed);
  p = model.withStudioTakes({ ...p, editing: model.reconcileStudioTakes(p, splitStudioTake(p.takes, 'main', 4, 'left', 'right')) });
  p = model.withStudioTakes({ ...p, editing: model.reconcileStudioTakes(p, duplicateStudioTake(p.takes, 'right', 'copy')) });
  const reopened = model.migrateStudioProject(JSON.parse(JSON.stringify(p)));
  assert.equal(reopened.editing.assets.length, 1);
  assert.deepEqual(reopened.editing.main.map(item => item.rect), [transformed.rect, transformed.rect, transformed.rect]);
  assert.deepEqual(model.compileStudioRecipe(reopened).clips.map(item => item.rect), [transformed.rect, transformed.rect, transformed.rect]);
});

test('pinça de texto altera letras e retângulo; merge mantém itens e origem concorrentes', () => {
  const p = project();
  const item = model.createStudioTextItem({ id: 'text', content: 'Meu texto', atTicks: 0, durationTicks: model.studioTicks(4) });
  const base = model.addStudioLayerItem(p.editing, item);
  const draft = patchStudioCanvasTransform(base, 'text', { rect: { x: 0.2, y: 0.4, width: 0.5, height: 0.15 }, textFontSize: 0.065 });
  const another = model.createStudioTextItem({ id: 'other', content: 'Outra camada', atTicks: 0, durationTicks: model.studioTicks(3) });
  const latest = model.addStudioLayerItem({ ...base, main: base.main.map(clip => ({ ...clip, gain: 0.4 })) }, another);
  const merged = mergeStudioCanvasDraft(latest, draft, 'text');
  const updated = merged.layers.flatMap(layer => layer.items).find(item => item.id === 'text');
  assert.equal(updated.text.fontSize, 0.065);
  assert.equal(updated.text.content, 'Meu texto');
  assert.equal(merged.main[0].gain, 0.4);
  assert.ok(merged.layers.flatMap(layer => layer.items).some(item => item.id === 'other'));
  assert.deepEqual(merged.assets, base.assets);
});

test('merge do main altera apenas enquadramento, rejeita alvo removido e respeita bounds nativos', () => {
  const p = project(), draft = patchStudioCanvasTransform(p.editing, 'main', transformed);
  const latest = { ...p.editing, main: p.editing.main.map(clip => ({ ...clip, sourceStartTicks: model.studioTicks(1), gain: 0.3 })) };
  const merged = mergeStudioCanvasDraft(latest, draft, 'main');
  assert.equal(merged.main[0].sourceStartTicks, model.studioTicks(1));
  assert.equal(merged.main[0].gain, 0.3);
  assert.deepEqual(merged.main[0].rect, transformed.rect);
  assert.throws(() => mergeStudioCanvasDraft({ ...latest, main: [] }, draft, 'main'), /não está/);
  for (const rect of [{ x: -2.1, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 3.1, height: 1 }, { x: NaN, y: 0, width: 1, height: 1 }]) {
    assert.throws(() => patchStudioCanvasTransform(p.editing, 'main', { rect }), /não é válida/);
  }
});

test('um enquadramento inteiro é uma entrada de undo e redo recupera o mesmo resultado', () => {
  let p = project(); const history = createStudioEditingHistory(); history.sync(p, p.ownerId);
  const persist = operation => {
    assert.ok(operation); p = { ...p, revision: p.revision + 1, editing: operation.editing, takes: operation.takes };
    assert.equal(history.commit(operation, p), true);
  };
  persist(history.beginEditing(p, patchStudioCanvasTransform(p.editing, 'main', transformed)));
  assert.equal(history.state().undoCount, 1);
  persist(history.beginUndo(p)); assert.equal(p.editing.main[0].rect, undefined);
  persist(history.beginRedo(p)); assert.deepEqual(p.editing.main[0].rect, transformed.rect);
});
