import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from './model.ts';
import { createJourneyRuntime, createJourneyEditor, plain } from './editorJourneyHarness.mjs';

// This is an integrated JS/domain journey, not a UIKit/Metal/encoder E2E.
// Canvas, Timeline and composition preview callbacks/worklets are production
// code. The route/panels and physical recognizer arbitration remain separate
// acceptance work. Native events, file metadata and encoding are OS boundaries.
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const item = (project, id) => project.editing.layers.flatMap(layer => layer.items).find(value => value.id === id);
const clip = (editor, id) => editor.recipe().clips.find(value => value.id === id);
const sources = project => plain(project.editing.assets);
const pose = project => plain(project.editing);

async function importMontage(runtime, kind, manyLayers = false) {
  const project = await runtime.store.createStudioProject(runtime.owner(), kind, { transient: true });
  runtime.cancelPicker();
  assert.deepEqual(await runtime.media.importStudioMedia(project), []);
  assert.equal(runtime.store.studioSnapshot(runtime.owner()).projects.length, 0);
  assert.equal(runtime.data.size, 0, 'Opening/cancelling a picker does not create a draft');
  const first = runtime.fixture('lesson-main.mov', { duration: 8 });
  const second = runtime.fixture('lesson-followup.mov', { duration: 6 });
  runtime.queuePicker(first, second);
  assert.equal((await runtime.media.importStudioMedia(project)).length, 2);
  let saved = runtime.store.getStudioProject(runtime.owner(), project.id);
  assert.equal(saved.id, project.id); assert.equal(saved.pendingTakes.length, 0);
  assert.equal(model.timelineDuration(saved.takes), 14);
  const picture = runtime.fixture('lesson-slide.jpg', { duration: 0, width: 1600, height: 900, hasVideo: false, hasAudio: false });
  runtime.queuePicker(picture);
  saved = await runtime.media.importStudioLayer(saved, 'image', { id: 'slide', kind: 'image', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(4),
    rect: { x: .58, y: .08, width: .3, height: .28 }, opacity: .8 });
  const inset = runtime.fixture('lesson-pip.mov', { duration: 8 }); runtime.queuePicker(inset);
  saved = await runtime.media.importStudioLayer(saved, 'video', { id: 'pip', kind: 'video', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(4),
    rect: { x: .08, y: .08, width: .28, height: .28 }, gain: .7 });
  const audio = runtime.fixture('lesson-music.m4a', { duration: 16, width: 0, height: 0, hasVideo: false }); runtime.queuePicker(audio);
  saved = await runtime.media.importStudioLayer(saved, 'audio', { id: 'music', kind: 'audio', atTicks: 0, durationTicks: model.studioTicks(10), gain: .25,
    fadeInTicks: model.studioTicks(.5), fadeOutTicks: model.studioTicks(.5) });
  let editing = model.addStudioLayerItem(saved.editing, {
    ...model.createStudioTextItem({ id: 'title', content: 'Uma ideia para aprender', atTicks: model.studioTicks(1), durationTicks: model.studioTicks(4), clipId: saved.takes[0].id }),
    anchor: { clipId: saved.takes[0].id, offsetTicks: model.studioTicks(1) },
    rect: { x: .3, y: .3, width: .4, height: .2 },
  }, 'title-track');
  editing = model.patchStudioClipGrade(editing, 'pip', { ...model.studioGrade('cinematic'), intensity: .4 });
  if (manyLayers) for (let index = 0; index < 8; index++) {
    editing = model.addStudioLayerItem(editing, model.createStudioTextItem({ id: `note-${index}`, content: `Resumo ${index + 1}`,
      atTicks: model.studioTicks(10), durationTicks: model.studioTicks(2) }), `note-track-${index}`);
  }
  saved = await runtime.store.updateStudioProject(runtime.owner(), saved.id, { editing, title: 'Aula local de validação', description: 'Somente fixtures locais.' });
  assert.equal(saved.editing.assets.length, 5);
  assert.equal(saved.editing.layers.length, manyLayers ? 12 : 4);
  assert.deepEqual(model.validateStudioRecipe(model.compileStudioRecipe(saved)), []);
  return saved;
}

async function panCanvas(editor, id, dx, dy, { cancel = false } = {}) {
  editor.selectLayer(id); await editor.pump();
  const pan = editor.canvas.getGesture('pan', id);
  assert.ok(pan, 'Real selected canvas layer exposes its pan recognizer');
  pan.handlers.onStart({ translationX: 0, translationY: 0 }); editor.canvas.flush();
  pan.handlers.onUpdate({ translationX: dx / 2, translationY: dy / 2 }); editor.canvas.flush();
  if (cancel) { pan.handlers.onEnd({ translationX: dx, translationY: dy }, false); pan.handlers.onFinalize({}, false); }
  else { pan.handlers.onEnd({ translationX: dx, translationY: dy }, true); pan.handlers.onFinalize({}, true); }
  await editor.pump(); await editor.drain();
}
async function pinchCanvas(editor, id, scale, main = false) {
  main ? editor.selectMain(id) : editor.selectLayer(id); await editor.pump();
  const pinch = editor.canvas.getGesture('pinch', id);
  pinch.handlers.onStart({ focalX: 128, focalY: 110, numberOfPointers: 2 }); editor.canvas.flush();
  pinch.handlers.onUpdate({ scale, focalX: 135, focalY: 114, numberOfPointers: 2 }); editor.canvas.flush();
  pinch.handlers.onEnd({ scale, focalX: 135, focalY: 114, numberOfPointers: 2 }, true); pinch.handlers.onFinalize({}, true);
  await editor.pump(); await editor.drain();
}
async function trimLayer(editor, id, edge, pixels) {
  editor.selectLayer(id); await editor.pump();
  const tree = editor.timeline.childLayer(id);
  const node = editor.timeline.nodes('TimelineLayer').find(value => value.props.item.id === id);
  assert.equal(node.props.disabled, false, `Ready to trim ${id}; phase=${editor.timeline.m().phase.value}`);
  const handle = tree.props.children[1][edge === 'start' ? 0 : 1].props.gesture.handlers;
  editor.timeline.flushUI(); editor.timeline.flushJS();
  handle.onStart({ absoluteX: 220 }); editor.timeline.flushJS();
  handle.onUpdate({ absoluteX: 220 + pixels, translationX: pixels }); editor.timeline.animate(); editor.timeline.flushJS();
  handle.onEnd({}, true); handle.onFinalize({}, true); await editor.pump(); await editor.drain();
}
async function moveLayer(editor, id, dx, dy) {
  editor.selectLayer(id); await editor.pump();
  const body = editor.timeline.childLayer(id).props.children[0].props.gesture.gestures[0].handlers;
  editor.timeline.flushUI(); editor.timeline.flushJS();
  body.onStart({ absoluteX: 220, absoluteY: 72 }); editor.timeline.flushJS();
  body.onUpdate({ absoluteX: 220 + dx, absoluteY: 72 + dy, translationX: dx, translationY: dy });
  body.onEnd({ translationX: dx, translationY: dy }, true); body.onFinalize({}, true);
  await editor.pump(); await editor.drain();
}

for (const kind of ['aula', 'short']) test(`jornada integrada ${kind}: importar → gestos → corte/faixa → Play → undo/redo → reabrir → contrato de export`, async () => {
  const runtime = createJourneyRuntime();
  const initial = await importMontage(runtime, kind, kind === 'short');
  const originals = sources(initial);
  const editor = await createJourneyEditor(runtime, initial.id);
  try {
    await editor.setPosition(1.5);
    const cursor = editor.position(), nativeCommands = editor.preview.calls.length;
    editor.canvas.getGesture('tap', 'title').handlers.onEnd({}, true); editor.canvas.flush(); await editor.pump();
    assert.equal(editor.selected().selectedLayerId, 'title'); assert.equal(editor.position(), cursor);
    editor.timeline.childLayer('pip').props.children[0].props.children.props.onPress(); await editor.pump();
    assert.equal(editor.selected().selectedLayerId, 'pip'); assert.equal(editor.position(), cursor);
    assert.equal(editor.preview.calls.length, nativeCommands, 'Selection must not send seek/source commands');
    assert.deepEqual(editor.seeks, []);
    if (kind === 'short') {
      editor.selectLayer('note-7'); await editor.pump();
      assert.ok(editor.timeline.nodes('TimelineLayer').some(node => node.props.item.id === 'note-7'));
      editor.timeline.childLayer('note-7');
      assert.equal(editor.current().editing.layers.length, 12);
      assert.equal(editor.canvas.visibleIds().includes('note-7'), false, 'Off-time text has no fake canvas hitbox');
      assert.equal(editor.position(), cursor); assert.equal(editor.preview.calls.length, nativeCommands);
      const beforeScroll = editor.history.state().undoCount;
      editor.timeline.laneScroll().onScroll({ contentOffset: { y: 44 * 9 } }); editor.timeline.frame(16); editor.timeline.flushJS();
      assert.equal(editor.history.state().undoCount, beforeScroll); assert.equal(editor.position(), cursor);
      assert.equal(editor.current().editing.layers.length, 12, 'Scrolling changes a viewport, not canonical tracks');
    }

    await editor.save(value => model.patchStudioLayerItem(value, 'title', { text: { content: 'Conteúdo digitado e preservado' } }));
    const beforeMain = editor.saves.length;
    await pinchCanvas(editor, initial.takes[0].id, 1.2, true);
    assert.equal(editor.saves.length, beforeMain + 1); close(editor.current().editing.main[0].rect.width, 1.2);
    const titleBefore = plain(item(editor.current(), 'title'));
    await panCanvas(editor, 'title', 32, 18);
    assert.equal(item(editor.current(), 'title').text.content, 'Conteúdo digitado e preservado');
    assert.notDeepEqual(item(editor.current(), 'title').rect, titleBefore.rect);
    const beforePinch = plain(item(editor.current(), 'title')), historyBefore = editor.history.state().undoCount;
    await pinchCanvas(editor, 'title', 1.25);
    close(item(editor.current(), 'title').text.fontSize, beforePinch.text.fontSize * 1.25);
    close(item(editor.current(), 'title').rect.width, beforePinch.rect.width * 1.25);
    assert.equal(editor.history.state().undoCount, historyBefore + 1, 'A multi-update pinch is a single durable history operation');
    await panCanvas(editor, 'slide', -24, 12);
    const videoBefore = plain(item(editor.current(), 'pip'));
    editor.selectLayer('pip'); await editor.pump();
    const corner = editor.canvas.handle(3, 'pip');
    corner.handlers.onStart({ translationX: 0, translationY: 0 }); editor.canvas.flush();
    corner.handlers.onEnd({ translationX: 24, translationY: 24 }, true); corner.handlers.onFinalize({}, true);
    await editor.pump(); await editor.drain();
    assert.ok(item(editor.current(), 'pip').rect.width > videoBefore.rect.width);
    assert.deepEqual(item(editor.current(), 'pip').grade, videoBefore.grade);

    const beforeCancel = pose(editor.current()), writesBeforeCancel = runtime.writes.length, historyBeforeCancel = editor.history.state();
    await panCanvas(editor, 'title', 96, 60, { cancel: true });
    assert.deepEqual(pose(editor.current()), beforeCancel); assert.equal(runtime.writes.length, writesBeforeCancel);
    assert.deepEqual(editor.history.state(), historyBeforeCancel);
    const unchangedCorner = editor.canvas.handle(3, 'title');
    unchangedCorner.handlers.onStart({ translationX: 0, translationY: 0 }); editor.canvas.flush();
    unchangedCorner.handlers.onEnd({ translationX: 0, translationY: 0 }, true); unchangedCorner.handlers.onFinalize({}, true);
    await editor.pump(); await editor.drain();
    assert.equal(runtime.writes.length, writesBeforeCancel, 'No-op gestures never reach storage/history');
    assert.deepEqual(editor.history.state(), historyBeforeCancel);

    const textDuration = item(editor.current(), 'title').durationTicks;
    await trimLayer(editor, 'title', 'end', 60);
    assert.equal(item(editor.current(), 'title').durationTicks, textDuration + model.studioTicks(1));
    assert.equal(editor.position(), cursor);
    const originalVideoBounds = [item(editor.current(), 'pip').sourceStartTicks, item(editor.current(), 'pip').sourceEndTicks];
    await trimLayer(editor, 'pip', 'start', 30);
    assert.equal(item(editor.current(), 'pip').sourceStartTicks, originalVideoBounds[0] + model.studioTicks(.5), JSON.stringify({ events: editor.events.slice(-10), phase: editor.timeline.m().phase.value, failures: editor.failures.map(value => value.message) }));
    assert.equal(item(editor.current(), 'pip').sourceEndTicks, originalVideoBounds[1]);
    const textTime = item(editor.current(), 'title').atTicks, textTrack = editor.current().editing.layers.findIndex(layer => layer.items.some(value => value.id === 'title'));
    await moveLayer(editor, 'title', 30, -44);
    assert.equal(item(editor.current(), 'title').atTicks, textTime + model.studioTicks(.5));
    assert.equal(editor.current().editing.layers.findIndex(layer => layer.items.some(value => value.id === 'title')), textTrack - 1);
    assert.equal(item(editor.current(), 'title').text.content, 'Conteúdo digitado e preservado');
    assert.equal(editor.position(), cursor); assert.deepEqual(editor.seeks, []);

    await editor.setPosition(8.5); editor.selectMain(initial.takes[0].id); await editor.pump();
    const beforeCut = pose(editor.current()), cutHistory = editor.history.state().undoCount;
    const mainEdge = editor.timeline.pan('end');
    mainEdge.onStart({ absoluteX: 250 }); editor.timeline.flushJS();
    mainEdge.onUpdate({ absoluteX: 130, translationX: -120 }); editor.timeline.animate(); editor.timeline.flushJS();
    mainEdge.onEnd({}, true); mainEdge.onFinalize({}, true); await editor.pump(); await editor.drain(); await editor.confirmSeek();
    close(editor.current().takes[0].end, 6); close(editor.position(), 6.5);
    close(model.studioSeconds(editor.recipe().durationTicks), 12);
    assert.equal(editor.playbackState().takeId, initial.takes[1].id);
    close(editor.playbackState().sourcePosition, .5);
    assert.equal(editor.history.state().undoCount, cutHistory + 1);
    const afterCut = pose(editor.current());
    await editor.undo(); await editor.confirmSeek(); assert.deepEqual(pose(editor.current()), beforeCut); close(editor.position(), 8.5);
    await editor.redo(); await editor.confirmSeek(); assert.deepEqual(pose(editor.current()), afterCut); close(editor.position(), 6.5);

    const savesBeforePlay = editor.saves.length, writesBeforePlay = runtime.writes.length;
    editor.preview.ref.current.togglePlayback(); await editor.pump();
    for (let index = 1; index <= 6; index++) {
      await editor.sample(6.5 + index / 15, true);
      for (let frame = 0; frame < 4; frame++) editor.timeline.frame(1000 / 60);
    }
    assert.equal(editor.preview.channel.value.playing, true);
    assert.ok(editor.timeline.playerPosition() >= 6.9 && editor.timeline.playerPosition() <= 7.02);
    editor.preview.ref.current.pause(); await editor.pump();
    assert.equal(editor.preview.channel.value.playing, false);
    assert.equal(editor.saves.length, savesBeforePlay); assert.equal(runtime.writes.length, writesBeforePlay, 'Playback samples are session state, not project saves');

    const imageLane = editor.current().editing.layers.findIndex(layer => layer.items.some(value => value.id === 'slide')) + 1;
    editor.timeline.control(`Ocultar faixa ${imageLane}`).onPress(); await editor.pump(); await editor.drain();
    assert.equal(clip(editor, 'slide').opacity, 0); assert.equal(item(editor.current(), 'slide').opacity, .8);
    assert.equal(editor.canvas.visibleIds().includes('slide'), false);
    editor.timeline.control(`Mostrar faixa ${imageLane}`).onPress(); await editor.pump(); await editor.drain();
    assert.equal(clip(editor, 'slide').opacity, .8);
    editor.timeline.control(`Ocultar faixa ${imageLane}`).onPress(); await editor.pump(); await editor.drain();
    const videoLane = editor.current().editing.layers.findIndex(layer => layer.items.some(value => value.id === 'pip')) + 1;
    editor.timeline.control(`Silenciar áudio da faixa ${videoLane}`).onPress(); await editor.pump(); await editor.drain();
    assert.equal(clip(editor, 'pip').gain, 0); assert.equal(item(editor.current(), 'pip').gain, .7);
    const audioLane = editor.current().editing.layers.findIndex(layer => layer.items.some(value => value.id === 'music')) + 1;
    editor.timeline.control(`Silenciar áudio da faixa ${audioLane}`).onPress(); await editor.pump(); await editor.drain();
    assert.equal(clip(editor, 'music').gain, 0); assert.equal(item(editor.current(), 'music').gain, .25);
    editor.timeline.control(`Ativar áudio da faixa ${audioLane}`).onPress(); await editor.pump(); await editor.drain();
    assert.equal(clip(editor, 'music').gain, .25);
    editor.timeline.control('Silenciar áudio principal').onPress(); await editor.pump(); await editor.drain();
    assert.equal(editor.recipe().clips.filter(value => value.zIndex === 0).every(value => value.gain === 0), true);
    assert.equal(clip(editor, 'music').gain, .25);
    assert.deepEqual(sources(editor.current()), originals, 'All gestures, trims, flags and history retain immutable originals');
    assert.equal(editor.failures.length, 0);
    const durable = { ...plain(editor.current()), takes: plain(editor.current().takes) }, expectedRecipe = plain(editor.recipe()), expectedSignature = model.timelineSignature(editor.current());
    assert.equal(editor.events.filter(event => event.kind === 'canvas-start').length, editor.events.filter(event => event.kind === 'canvas-end').length);
    assert.equal(editor.events.filter(event => event.kind === 'layer-start').length, editor.events.filter(event => event.kind === 'layer-end').length);
    editor.dispose();

    const reopened = createJourneyRuntime({ data: runtime.data, disk: runtime.disk });
    assert.equal(reopened.store.getStudioProject(reopened.owner(), durable.id), undefined, 'Fresh runtime has no borrowed in-memory project');
    await reopened.store.loadStudioProjects(reopened.owner());
    const restored = reopened.store.getStudioProject(reopened.owner(), durable.id);
    assert.deepEqual(plain(restored.editing), durable.editing); assert.deepEqual(plain(restored.takes), durable.takes);
    assert.equal(model.timelineSignature(restored), expectedSignature);
    assert.deepEqual(plain(model.compileStudioRecipe(restored)), expectedRecipe);
    assert.equal(restored.pendingTakes.length, 0);
    reopened.history.sync(restored);
    assert.equal(reopened.history.state().undoCount, 0, 'Undo is session state; reopening only promises durable editing');
    const reopenedEditor = await createJourneyEditor(reopened, restored.id);
    try {
      const previewRecipe = JSON.parse(reopenedEditor.preview.canvas().recipeJSON);
      const { output: presentationOutput, ...presentationContent } = previewRecipe;
      const { output: exportOutput, ...exportContent } = expectedRecipe;
      assert.deepEqual(presentationContent, exportContent, 'Presentation preserves every durable clip, source, effect, geometry and mix; only its rendering profile differs');
      assert.deepEqual(presentationOutput, { profile:'standard',width:kind === 'short' ? 1080 : 1920,height:kind === 'short' ? 1920 : 1080,frameRateNumerator:30,frameRateDenominator:1,colorSpace:'rec709' }, 'The bounded preview profile is explicit and never certifies the export profile');
      assert.deepEqual(exportOutput, model.compileStudioRecipe(restored).output, 'The export retains the durable user selection and effective output');
      await reopenedEditor.setPosition(2);
      assert.equal(reopenedEditor.canvas.visibleIds().includes('title'), true);
      assert.equal(reopenedEditor.canvas.visibleIds().includes('slide'), false, 'The reopened canvas respects the durable hidden track');
      assert.equal(item(reopenedEditor.current(), 'title').text.content, 'Conteúdo digitado e preservado');
      assert.equal(reopenedEditor.history.state().undoCount, 0);
    } finally { reopenedEditor.dispose(); }
    const serialized = JSON.parse(reopened.data.get(`classfy:studio:v2:${reopened.owner()}`));
    assert.equal(Object.hasOwn(serialized[0], 'takes'), false, 'The takes adapter is never a second canonical serialized timeline');
    assert.deepEqual(model.validateStudioRecipe(expectedRecipe), []);
    const progress = [], result = await reopened.media.exportStudioProject(restored, value => progress.push(value));
    assert.deepEqual(reopened.exports[0].recipe, expectedRecipe, 'Real media export dispatch receives the exact reopened render recipe');
    assert.equal(reopened.exports[0].requestId, restored.id); assert.equal(reopened.exports.length, 1);
    close(result.duration, model.studioSeconds(expectedRecipe.durationTicks)); assert.deepEqual(progress, [0, .5, 1]);
    const exported = reopened.store.getStudioProject(reopened.owner(), restored.id);
    assert.equal(exported.exportedSignature, expectedSignature); assert.equal(exported.exportedUri, result.uri);
    await reopened.media.exportStudioProject(exported); assert.equal(reopened.exports.length, 1, 'Unchanged durable recipe reuses only the verified cached output');
  } finally { editor.dispose(); }
});

test('jornada interrompida: journal raw/grade e overlay recuperam em runtime novo sem duplicar ou misturar contas', async () => {
  const runtime = createJourneyRuntime();
  const project = await runtime.store.createStudioProject(runtime.owner(), 'aula', { transient: true });
  const source = runtime.fixture('captured-original.mov');
  const grade = { ...model.studioGrade('studio'), intensity: .65, exposure: .2 };
  runtime.failMetadata();
  await assert.rejects(runtime.media.persistStudioTake(project, { uri: source, grade, sourceStage: 'standard' }), /temporarily unavailable/);
  const pending = plain(runtime.store.getStudioProject(runtime.owner(), project.id).pendingTakes[0]);
  assert.deepEqual(pending.grade, grade); assert.ok(runtime.disk.has(pending.uri));
  const reopened = createJourneyRuntime({ data: runtime.data, disk: runtime.disk });
  await reopened.store.loadStudioProjects(reopened.owner());
  let saved = reopened.store.getStudioProject(reopened.owner(), project.id);
  assert.deepEqual(await reopened.media.recoverPendingStudioTakes(saved), { recovered: 1, errors: [] });
  saved = reopened.store.getStudioProject(reopened.owner(), project.id);
  assert.equal(saved.takes[0].id, pending.id); assert.equal(saved.takes[0].uri, pending.uri);
  assert.deepEqual(saved.editing.main[0].grade, grade); assert.equal(saved.editing.assets[0].grade, undefined, 'Capture treatment remains a reversible clip recipe, never baked onto the original asset');
  assert.deepEqual(await reopened.media.recoverPendingStudioTakes(saved), { recovered: 0, errors: [] });
  const overlay = reopened.fixture('recover-pip.mov'); reopened.queuePicker(overlay); reopened.failMetadata();
  await assert.rejects(reopened.media.importStudioLayer(saved, 'video', { id: 'pending-pip', kind: 'video', atTicks: model.studioTicks(2), durationTicks: model.studioTicks(2),
    rect: { x: .62, y: .08, width: .3, height: .3 }, gain: .4 }), /temporarily unavailable/);
  const withJournal = reopened.store.getStudioProject(reopened.owner(), project.id);
  assert.equal(withJournal.pendingTakes[0].layerItem.id, 'pending-pip');
  const resumed = createJourneyRuntime({ data: reopened.data, disk: reopened.disk });
  await resumed.store.loadStudioProjects(resumed.owner());
  const beforeRecovery = resumed.store.getStudioProject(resumed.owner(), project.id);
  resumed.setOwner('another-owner');
  await assert.rejects(resumed.media.recoverPendingStudioTakes(beforeRecovery), /sessão mudou/);
  assert.equal(resumed.store.getStudioProject('another-owner', project.id), undefined);
  assert.equal(resumed.store.getStudioProject(beforeRecovery.ownerId, project.id).pendingTakes.length, 1);
  resumed.setOwner(beforeRecovery.ownerId);
  assert.deepEqual(await resumed.media.recoverPendingStudioTakes(beforeRecovery), { recovered: 1, errors: [] });
  const final = resumed.store.getStudioProject(resumed.owner(), project.id);
  assert.equal(final.takes.length, 1, 'Recovery restores a journalled overlay to its track, not the main sequence');
  assert.equal(item(final, 'pending-pip').gain, .4); assert.equal(item(final, 'pending-pip').atTicks, model.studioTicks(2));
  assert.equal(final.pendingTakes.length, 0); assert.deepEqual(model.validateStudioRecipe(model.compileStudioRecipe(final)), []);
  assert.deepEqual(await resumed.media.recoverPendingStudioTakes(final), { recovered: 0, errors: [] });
});

test('gesto → escrita assíncrona → background/falha/retry: publicação e histórico seguem o resultado durável', async () => {
  const runtime = createJourneyRuntime(); const initial = await importMontage(runtime, 'aula');
  const editor = await createJourneyEditor(runtime, initial.id);
  try {
    await editor.setPosition(1.5); editor.selectLayer('title'); await editor.pump();
    const baseline = pose(editor.current()), historyBefore = editor.history.state(), writesBefore = runtime.writes.length;
    const gate = runtime.deferWrite(), pan = editor.canvas.getGesture('pan', 'title');
    pan.handlers.onStart({ translationX: 0, translationY: 0 }); editor.canvas.flush();
    pan.handlers.onUpdate({ translationX: 32, translationY: 18 }); editor.canvas.flush();
    pan.handlers.onEnd({ translationX: 48, translationY: 24 }, true); pan.handlers.onFinalize({}, true); editor.canvas.flush();
    await gate.entered;
    assert.deepEqual(pose(editor.current()), baseline); assert.equal(runtime.writes.length, writesBefore);
    assert.equal(editor.history.state().undoCount, historyBefore.undoCount);
    assert.equal(editor.preview.transformChannel.value.phase, 'committing');
    const operation = editor.preview.transformChannel.value.operationId;
    editor.canvas.changeAppState('background'); await editor.pump();
    assert.equal(editor.preview.transformChannel.value.operationId, operation, 'A cancellation during disk IO cannot rename the receipt reservation');
    gate.reject(new Error('Disk full during journey')); await editor.pump(); await editor.drain();
    assert.deepEqual(pose(editor.current()), baseline); assert.deepEqual(editor.history.state(), historyBefore);
    assert.equal(editor.failures.length, 1); assert.match(editor.failures[0].message, /Disk full/);
    assert.equal(editor.preview.transformChannel.value.finish, 'cancel');
    assert.equal(editor.preview.transformChannel.value.active, false);
    editor.canvas.changeAppState('active'); await editor.pump();
    await panCanvas(editor, 'title', 48, 24);
    assert.notDeepEqual(pose(editor.current()), baseline); assert.equal(editor.history.state().undoCount, historyBefore.undoCount + 1);
    assert.equal(editor.preview.transformChannel.value.finish, 'commit');
    const afterRetry = pose(editor.current());
    const durableGate = runtime.deferWrite(), second = editor.canvas.getGesture('pan', 'title');
    second.handlers.onStart({ translationX: 0, translationY: 0 }); editor.canvas.flush();
    second.handlers.onEnd({ translationX: -16, translationY: 0 }, true); second.handlers.onFinalize({}, true); editor.canvas.flush();
    await durableGate.entered; editor.canvas.changeAppState('background'); await editor.pump();
    assert.deepEqual(pose(editor.current()), afterRetry);
    durableGate.resolve(); await editor.pump(); await editor.drain();
    assert.notDeepEqual(pose(editor.current()), afterRetry);
    assert.equal(editor.history.state().undoCount, historyBefore.undoCount + 2);
    assert.equal(editor.preview.transformChannel.value.finish, 'commit', 'An already-started write may succeed after background; cancellation must report that actual result');
    const saved = plain(editor.current()); editor.dispose();
    const reopened = createJourneyRuntime({ data: runtime.data, disk: runtime.disk }); await reopened.store.loadStudioProjects(reopened.owner());
    assert.deepEqual(pose(reopened.store.getStudioProject(reopened.owner(), initial.id)), saved.editing);
    assert.deepEqual(sources(reopened.store.getStudioProject(reopened.owner(), initial.id)), sources(initial));
    assert.equal(reopened.store.getStudioProject('another-owner', initial.id), undefined);
  } finally { editor.dispose(); }
});
