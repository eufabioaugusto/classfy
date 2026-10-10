import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as timeline from './timeline.ts';
import { createStudioEditingHistory } from './editingHistory.ts';
import * as layout from './timelineLayout.ts';
import * as motion from './timelineMotion.ts';
const compile = (file, dependencies) => {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, module, module.exports);
  return module.exports;
};
const ranges = compile('./layerTimelineInteraction.ts', { './model': model });
const actions = compile('./layerActions.ts', { './model': model, './layerTimelineInteraction': ranges });
const interaction = compile('./editorInteraction.ts', { './timeline': timeline });
const t = model.studioTicks;
const project = editing => model.withStudioTakes({ id: 'project', ownerId: 'owner', version: 2, kind: 'aula', editing });
const recipe = editing => model.compileStudioRecipe(project(editing));
const fixture = () => ({ ...model.emptyStudioEditing('aula'), assets: [
  { id: 'v', kind: 'video', uri: 'file:///original.mp4', name: 'Original', durationTicks: t(20), width: 1920, height: 1080, frameRate: 30, hasAudio: true },
  { id: 'music', kind: 'audio', uri: 'file:///music.m4a', name: 'Music', durationTicks: t(20) },
], main: [
  { id: 'a', assetId: 'v', sourceStartTicks: t(2), sourceEndTicks: t(10) },
  { id: 'b', assetId: 'v', sourceStartTicks: t(10), sourceEndTicks: t(14) },
], layers: [{ id: 'titles', kind: 'text', items: [model.createStudioTextItem({ id: 'title', atTicks: t(1), durationTicks: t(2), clipId: 'a' })] }] });
const almost = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1 / 120000 + 1e-9, `${actual} != ${expected}`);

test('documento sem campos novos preserva receita e assinatura; novos recursos não certificam export legado', () => {
  const editing = fixture(), before = JSON.stringify(recipe(editing));
  assert.equal(model.requiresStudioEditorTools(editing), false);
  const reopened = project(JSON.parse(JSON.stringify(editing)));
  assert.equal(JSON.stringify(model.compileStudioRecipe(reopened)), before);
  assert.equal(model.timelineSignature(project(editing)), model.timelineSignature({ ...reopened, title: 'Só metadados' }));
  const takes = project(editing).takes;
  const legacy = { version: 1, kind: 'aula', takes, exportedSignature: model.legacyTimelineSignature({ kind: 'aula', takes }) };
  assert.equal(model.migrateStudioProject(legacy).exportedSignature, model.timelineSignature(model.migrateStudioProject(legacy)));
  for (const patch of [{ playbackRate: 2 }, { flipHorizontal: true }, { gain: .6 }, { fadeInTicks: t(.2) }, { motion: 'pulse' }]) {
    const updated = { ...legacy, takes: takes.map((take, index) => index ? take : { ...take, ...patch }) };
    assert.notEqual(model.timelineSignature(updated), legacy.exportedSignature);
    assert.notEqual(model.migrateStudioProject(updated).exportedSignature, model.timelineSignature(model.migrateStudioProject(updated)));
  }
});

for (const rate of [.25, .5, 1, 2, 4]) test(`principal ${rate}x: origem imutável, ripple/anchors/posição/timeline coerentes`, () => {
  const base = fixture(), snapshot = structuredClone(base);
  base.layers[0].items[0].anchor.offsetTicks = t(1);
  const current = project(base), anchor = interaction.captureStudioPlaybackAnchor(current.takes, { position: 6, takeId: 'a', sourcePosition: 8 });
  const changed = model.setStudioClipPlaybackRate(base, 'a', rate), next = project(changed), rendered = recipe(changed);
  assert.deepEqual(base.assets, snapshot.assets);
  assert.equal(changed.main[0].sourceStartTicks, t(2)); assert.equal(changed.main[0].sourceEndTicks, t(10));
  assert.equal(rendered.clips.find(c => c.id === 'a').durationTicks, t(8 / rate));
  assert.equal(rendered.clips.find(c => c.id === 'b').startTicks, t(8 / rate));
  const title = rendered.clips.find(c => c.id === 'title');
  assert.equal(title.startTicks, t(1 / rate)); assert.equal(title.durationTicks, t(2 / rate));
  almost(interaction.restoreStudioPlaybackAnchor(next.takes, anchor).position, 6 / rate);
  const at = timeline.locateStudioTime(next.takes, 3 / rate);
  almost(at.sourceSeconds, 5); almost(at.localSeconds, 3 / rate);
  const visible = layout.studioTimelineLayout(next.takes, 60);
  almost(visible.segments[0].width, 8 / rate * 60); almost(visible.segments[1].start, 8 / rate);
  assert.deepEqual(model.validateStudioEditing(changed, 'aula'), []);
});

test('camada temporal mantém fonte e velocidade própria quando principal muda; velocidade da camada ajusta duração', () => {
  let editing = fixture();
  editing = model.addStudioLayerItem(editing, { id: 'music', kind: 'audio', assetId: 'music', atTicks: t(1), durationTicks: t(4),
    sourceStartTicks: t(4), sourceEndTicks: t(8), anchor: { clipId: 'a', sourceStartTicks: t(3), sourceEndTicks: t(7) } }, 'sound');
  const fast = model.setStudioClipPlaybackRate(editing, 'music', 2);
  let clip = recipe(fast).clips.find(c => c.id === 'music');
  assert.equal(clip.durationTicks, t(2)); assert.equal(clip.sourceStartTicks, t(4)); assert.equal(clip.sourceEndTicks, t(8));
  assert.equal(fast.layers[1].items[0].anchor.sourceEndTicks, t(5));
  const hostSlow = model.setStudioClipPlaybackRate(fast, 'a', .5);
  clip = recipe(hostSlow).clips.find(c => c.id === 'music');
  assert.equal(clip.startTicks, t(2)); assert.equal(clip.durationTicks, t(2)); assert.equal(clip.playbackRate, 2);
  assert.deepEqual(model.validateStudioEditing(hostSlow, 'aula'), []);
});

test('corte em velocidade alterada mapeia pixels para fonte, conserva min100ms e autoscroll/ripple', () => {
  const takes = project(model.setStudioClipPlaybackRate(fixture(), 'a', 2)).takes;
  const frozen = layout.freezeStudioTrim(takes, 'a');
  const js = layout.studioTrimRange(frozen, 'start', .5);
  const ui = motion.studioTrimDragValues('start', 2, 10, 20, 30, 0, 60, 2);
  assert.equal(js.start, 3); assert.equal(ui.start, 3); assert.equal(ui.leadingSeconds, .5);
  const changed = motion.studioLiveSegment(0, 4, 0, 0, 2, 10, 3, 10, 60, .5, 2);
  assert.deepEqual(changed, { x: 30, width: 210 });
  assert.deepEqual(motion.studioLiveSegment(4, 8, 1, 0, 2, 10, 3, 10, 60, .5, 2), { x: 240, width: 240 });
  const minimum = motion.studioTrimDragValues('end', 2, 10, 20, -9999, 0, 60, 2);
  almost((minimum.end - minimum.start) / 2, .1);
  const auto = motion.studioTrimAutoscrollStep('start', 2, 10, 20, 0, 0, 0, 0, 60, -30, 240, 2);
  assert.equal(auto.start, 1); assert.equal(auto.leadingSeconds, -.5); assert.equal(auto.virtualOffset, -30);
  assert.equal(layout.canContinueStudioTrim(frozen, takes.map(take => take.id === 'a' ? { ...take, playbackRate: 4 } : take), 'a'), false);
});

test('split principal conserva velocidade, envelopes permitidos, fonte, motion e vínculos em receita', () => {
  let editing = model.patchStudioClipProperties(fixture(), 'a', { playbackRate: 2, gain: .7, opacity: .5, flipHorizontal: true, fadeInTicks: t(.2), fadeOutTicks: t(.4), motion: 'pulse' });
  const original = project(editing), before = recipe(editing), takes = timeline.splitStudioTake(original.takes, 'a', 6, 'left', 'right');
  const next = model.withStudioTakes({ ...original, editing: model.reconcileStudioTakes(original, takes) });
  assert.deepEqual(model.validateStudioEditing(next.editing, 'aula'), []);
  const after = model.compileStudioRecipe(next), sides = after.clips.filter(c => c.zIndex === 0).slice(0, 2);
  assert.deepEqual(sides.map(c => [c.sourceStartTicks, c.sourceEndTicks, c.durationTicks, c.playbackRate]), [[t(2), t(6), t(2), 2], [t(6), t(10), t(2), 2]]);
  assert.equal(sides[0].fadeInTicks, t(.2)); assert.equal(sides[0].fadeOutTicks, 0);
  assert.equal(sides[1].fadeInTicks, 0); assert.equal(sides[1].fadeOutTicks, t(.4));
  assert.equal(sides[1].motionOffsetTicks, t(2)); assert.equal(sides[1].motionDurationTicks, t(4));
  assert.equal(after.durationTicks, before.durationTicks);
  assert.throws(() => timeline.splitStudioTake(original.takes, 'a', 2.2, 'left', 'right'), /entrada ou saída/);
});

for (const kind of ['audio', 'video']) test(`split/trim ${kind}2x preservam fonte e fases, inclusive âncora já recortada`, () => {
  let editing = fixture();
  editing.main[0].sourceStartTicks = t(4);
  editing = model.addStudioLayerItem(editing, { id: 'item', kind, assetId: kind === 'audio' ? 'music' : 'v', atTicks: 0, durationTicks: t(4), playbackRate: 2,
    sourceStartTicks: t(2), sourceEndTicks: t(10), anchor: { clipId: 'a', sourceStartTicks: t(2), sourceEndTicks: t(6) },
    motion: 'pulse', motionDurationTicks: t(4), motionOffsetTicks: t(.1) }, 'overlay');
  const before = recipe(editing).clips.find(c => c.id === 'item');
  assert.equal(before.sourceStartTicks, t(6)); assert.equal(before.motionOffsetTicks, t(2.1));
  const next = actions.splitStudioLayer(editing, 'item', 1, 'right');
  assert.deepEqual(model.validateStudioEditing(next, 'aula'), []);
  const sides = recipe(next).clips.filter(c => ['item', 'right'].includes(c.id));
  assert.deepEqual(sides.map(c => [c.sourceStartTicks, c.sourceEndTicks, c.durationTicks]), [[t(6), t(8), t(1)], [t(8), t(10), t(1)]]);
  assert.deepEqual(sides.map(c => c.motionOffsetTicks), [t(2.1), t(3.1)]);
  const trimmed = ranges.applyStudioLayerTimelineRange(editing, 'item', { startSeconds: .5, endSeconds: 2 });
  const clip = recipe(trimmed).clips.find(c => c.id === 'item');
  assert.equal(clip.sourceStartTicks, t(7)); assert.equal(clip.motionOffsetTicks, t(2.6));
});

test('texto conserva estilos/gradiente/animação após split e duplicação sem compartilhamento mutável', () => {
  const editing = fixture(), item = editing.layers[0].items[0];
  item.text = { ...item.text, fontFamily: 'Georgia-Bold', decoration: 'outline-inverse', visualEffect: 'neon', secondaryColor: '#102030',
    gradientColors: ['#FF0000', '#00FF00'], animation: 'typewriter', animationDurationTicks: t(2) };
  const rendered = recipe(editing).clips.find(c => c.id === 'title');
  assert.deepEqual(rendered.text, item.text); assert.equal(model.requiresStudioEditorTools(editing), true);
  const next = actions.splitStudioLayer(editing, 'title', 1, 'right');
  assert.equal(recipe(next).clips.find(c => c.id === 'right').animationOffsetTicks, t(1));
  const duplicated = actions.duplicateStudioLayer(next, 'right', 'copy');
  duplicated.layers.at(-1).items[0].text.gradientColors[0] = '#123456';
  assert.equal(next.layers[0].items[1].text.gradientColors[0], '#FF0000');
  const signature = model.timelineSignature(project(editing));
  assert.notEqual(signature, model.timelineSignature(project(duplicated)));
  assert.deepEqual(model.validateStudioEditing(JSON.parse(JSON.stringify(next)), 'aula'), []);
});

test('extrair áudio reaproveita original confirmado sem duplicar mix ou stream de vídeo', () => {
  const editing = model.patchStudioClipProperties(fixture(), 'a', { playbackRate: 2, gain: .8, fadeInTicks: t(.2), fadeOutTicks: t(.3) }), snapshot = structuredClone(editing);
  const next = actions.extractStudioClipAudio(editing, 'a', 'detached');
  assert.deepEqual(editing, snapshot); assert.deepEqual(next.assets, editing.assets);
  const rendered = recipe(next), main = rendered.clips.find(c => c.id === 'a'), audio = rendered.clips.find(c => c.id === 'detached');
  assert.equal(main.gain, 0); assert.equal(audio.gain, .8); assert.equal(audio.kind, 'audio'); assert.equal(audio.assetId, 'v');
  assert.equal(audio.playbackRate, 2); assert.equal(audio.durationTicks, main.durationTicks);
  assert.equal(audio.sourceStartTicks, main.sourceStartTicks); assert.equal(audio.sourceEndTicks, main.sourceEndTicks);
  assert.equal(audio.fadeInTicks, main.fadeInTicks); assert.equal(audio.fadeOutTicks, main.fadeOutTicks);
  assert.equal(model.requiresStudioEditorTools(next), true); assert.deepEqual(model.validateStudioEditing(next, 'aula'), []);
  for (const hasAudio of [undefined, false]) assert.throws(() => actions.extractStudioClipAudio({ ...editing, assets: editing.assets.map(a => a.id === 'v' ? { ...a, hasAudio } : a) }, 'a', 'detached'), /confirmado áudio/);
});

test('validação não mascara recursos inválidos em faixa oculta, original ou elementos fora do tempo', () => {
  const base = fixture();
  for (const patch of [{ playbackRate: 0 }, { playbackRate: NaN }, { playbackRate: 4.1 }, { flipHorizontal: 'true' }, { motion: 'fake' }, { opacity: 2 }, { fadeInTicks: t(9) }]) {
    assert.throws(() => model.patchStudioClipProperties(base, 'a', patch));
    assert.ok(model.validateStudioEditing({ ...base, main: base.main.map(c => c.id === 'a' ? { ...c, ...patch } : c) }, 'aula').length);
  }
  for (const style of [{ decoration: 'fake' }, { visualEffect: 'fake' }, { animation: 'fake' }, { secondaryColor: 'red' }, { gradientColors: ['#FFFFFF'] }, { animationDurationTicks: -1 }]) {
    const editing = structuredClone(base); editing.layers[0].hidden = true;
    editing.layers[0].items[0].anchor.sourceStartTicks = t(15); editing.layers[0].items[0].anchor.sourceEndTicks = t(17); delete editing.layers[0].items[0].anchor.offsetTicks;
    editing.layers[0].items[0].text = { ...editing.layers[0].items[0].text, ...style };
    assert.ok(model.validateStudioEditing(editing, 'aula').length, JSON.stringify(style));
  }
  assert.equal(model.patchStudioClipProperties(base, 'a', {}), base);
  assert.equal(model.setStudioClipPlaybackRate(base, 'a', 1), base);
});


test('botão dividir usa a mesma margem timeline e envelope da ação em .25x e4x', () => {
  for (const rate of [.25, 4]) {
    const take = { id: 'a', uri: 'file:///a.mp4', name: 'Original', duration: 10, start: 1, end: 9, playbackRate: rate };
    assert.equal(timeline.canSplitStudioTake([take], 'a', 1 + .1 * rate), true);
    assert.equal(timeline.canSplitStudioTake([take], 'a', 1 + .099 * rate), false);
    assert.equal(timeline.canSplitStudioTake([{ ...take, fadeInTicks: t(.5) }], 'a', 1 + .3 * rate), false);
    assert.equal(timeline.canSplitStudioTake([{ ...take, fadeOutTicks: t(.5) }], 'a', 9 - .3 * rate), false);
  }
});


test('áudio legado confirmado recebe novo asset dos mesmos bytes em uma transação e undo conserva originais', () => {
  const editing = fixture(); delete editing.assets[0].hasAudio;
  const original = project(editing), snapshot = structuredClone(editing), history = createStudioEditingHistory();
  const confirmed = { ...editing.assets[0], id: 'verified:v', hasAudio: true };
  const next = actions.extractStudioClipAudio(editing, 'a', 'detached', undefined, confirmed);
  assert.deepEqual(editing, snapshot); assert.deepEqual(next.assets[0], snapshot.assets[0]);
  assert.equal(next.assets.length, editing.assets.length + 1);
  assert.equal(next.assets.at(-1).uri, snapshot.assets[0].uri);
  assert.equal(recipe(next).clips.find(c => c.id === 'detached').assetId, 'verified:v');
  const failed = history.beginEditing(original, next); history.abort(failed);
  assert.equal(history.state().undoCount, 0);
  const op = history.beginEditing(original, next), saved = model.withStudioTakes({ ...original, editing: op.editing });
  assert.equal(history.commit(op, saved), true); assert.equal(history.state().undoCount, 1);
  const undo = history.beginUndo(saved), restored = model.withStudioTakes({ ...saved, editing: undo.editing });
  assert.equal(history.commit(undo, restored), true); assert.equal(restored.editing.main[0].gain, undefined);
  assert.equal(recipe(restored.editing).clips.some(c => c.id === 'detached'), false);
  assert.deepEqual(restored.editing.assets[0], snapshot.assets[0]);
  const redo = history.beginRedo(restored), redone = model.withStudioTakes({ ...restored, editing: redo.editing });
  assert.equal(history.commit(redo, redone), true);
  assert.equal(recipe(redone.editing).clips.find(c => c.id === 'detached').assetId, 'verified:v');
  assert.equal(recipe(redone.editing).clips.find(c => c.id === 'a').gain, 0);
  for (const patch of [{ id: 'v' }, { hasAudio: false }, { uri: 'file:///another.mp4' }, { durationTicks: t(10) }, { kind: 'audio' }]) {
    assert.throws(() => actions.extractStudioClipAudio(editing, 'a', 'detached', undefined, { ...confirmed, ...patch }), /mesmo arquivo original/);
  }
});
