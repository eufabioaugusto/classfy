import test from 'node:test';
import assert from 'node:assert/strict';
import { addStudioLayerItem, compileStudioRecipe, createStudioTextItem, deriveStudioTakes, emptyStudioEditing,
  legacyTimelineSignature, migrateStudioProject, patchStudioClipGrade, patchStudioLayerItem, rebaseStudioProject,
  normalizeStudioCaptureGrade, reconcileStudioTakes, removeStudioLayerItem, studioGrade, studioSeconds, studioTicks, timelineSignature,
  validateStudioEditing, validateStudioRecipe, withStudioStandardOutput, withStudioTakes } from './model.ts';
const take = (id, start = 0, end = 10, patch = {}) => ({ id, uri: `file:///old/Documents/classfy-studio/owner/project/${id}.mp4`,
  name: id, duration: 10, start, end, width: 1920, height: 1080, ...patch });
const legacy = (patch = {}) => ({ version: 1, id: 'project', ownerId: 'owner', kind: 'aula', state: 'draft', revision: 3,
  title: 'Aula', description: 'Aprenda', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '',
  progress: 0, createdAt: 'date', updatedAt: 'date', takes: [take('a'), take('b')], ...patch });
function standard() { const p = migrateStudioProject(legacy()); return withStudioTakes({ ...p, editing: withStudioStandardOutput(p.editing) }); }
const frame = editing => withStudioTakes({ ...legacy(), version: 2, editing });
const ticks = studioTicks;

test('tratamento de captura pertence ao novo clip, não ao asset, e corte não reverte tratamento editado', () => {
  const captured = { ...studioGrade('studio'), intensity: 0.45, temperature: 0.1 };
  const input = take('new', 0, 10, { grade: captured });
  const initial = reconcileStudioTakes({ kind: 'aula', editing: emptyStudioEditing('aula') }, [input]);
  const p = frame(initial);
  assert.deepEqual(p.takes[0].grade, captured); assert.equal(Object.hasOwn(p.editing.assets[0], 'grade'), false);
  const grade = { ...captured, preset: 'cinematic', intensity: 0.8, exposure: 0.2 };
  const edited = frame(patchStudioClipGrade(p.editing, 'new', grade));
  const cut = reconcileStudioTakes(edited, [{ ...input, start: 1, end: 9 }]);
  assert.deepEqual(cut.main[0].grade, grade, 'a stale capture adapter cannot revert a canonical edit of the same clip');
  assert.equal(cut.main[0].sourceStartTicks, ticks(1)); assert.equal(cut.main[0].sourceEndTicks, ticks(9));
  const recipe = compileStudioRecipe(frame(cut));
  assert.deepEqual(recipe.clips[0].grade, grade); assert.equal(recipe.clips.length, 1);
  assert.deepEqual(cut.assets, initial.assets);
});

test('Natural identidade não cria receita; Natural ajustado e presets em intensidade zero permanecem reversíveis', () => {
  assert.equal(normalizeStudioCaptureGrade({ ...studioGrade(), intensity: 0.4 }), undefined);
  const natural = { ...studioGrade(), exposure: 0.2 };
  assert.deepEqual(normalizeStudioCaptureGrade(natural), natural);
  for (const preset of ['studio', 'cinematic']) {
    const original = { ...studioGrade(preset), intensity: 0 };
    const snapshot = normalizeStudioCaptureGrade(original);
    assert.deepEqual(snapshot, original); original.intensity = 0.75; assert.equal(snapshot.intensity, 0);
  }
  for (const patch of [{ preset: 'outro' }, { intensity: NaN }, { intensity: -0.1 }, { exposure: 2.01 }, { contrast: -1.01 }, { saturation: 1.01 }, { temperature: Infinity }]) {
    assert.throws(() => normalizeStudioCaptureGrade({ ...studioGrade(), ...patch }), /ajustes de cor/);
  }
});

test('migração não certifica export legado sem tratamento como render de captura tratada', () => {
  const original = legacy({ takes: [take('a', 0, 10, { grade: { ...studioGrade('studio'), intensity: 0.5 } })] });
  original.exportedSignature = original.uploadSignature = legacyTimelineSignature(original);
  const p = migrateStudioProject(original);
  assert.notEqual(p.exportedSignature, timelineSignature(p)); assert.notEqual(p.uploadSignature, timelineSignature(p));
  assert.equal(p.editing.output.profile, 'legacy-source'); assert.equal(p.takes[0].grade.preset, 'studio');
  assert.notEqual(timelineSignature(original), timelineSignature({ ...original, takes: [take('a')] }));
});

test('schema2 tem takes derivados estáveis e JSON com uma única fonte canônica', () => {
  const p = standard();
  assert.equal(p.takes, p.takes);
  assert.ok(Object.isFrozen(p.editing.assets[0]));
  assert.throws(() => { p.editing.assets[0].uri = 'file:///tampered.mp4'; }, TypeError);
  const encoded = JSON.parse(JSON.stringify(p));
  assert.equal(encoded.version, 2);
  assert.equal('takes' in encoded, false);
  assert.equal(encoded.editing.assets.length, 2);
  assert.deepEqual(deriveStudioTakes(encoded.editing), p.takes);
});
test('migração conserva IDs, cortes, visibilidade, referências de upload e artefatos legados comprovados', () => {
  const original = legacy({ state: 'submitted', mediaAssetId: 'remote', submissionId: 'submission', contentId: 'content',
    uploadUrl: 'signed-destination', takes: [take('a', 2, 8, { width: 3840, height: 2160, frameRate: 60 })] });
  original.exportedSignature = original.uploadSignature = legacyTimelineSignature(original);
  const p = migrateStudioProject(original);
  assert.equal(p.state, 'submitted');
  assert.equal(p.mediaAssetId, 'remote');
  assert.equal(p.submissionId, 'submission');
  assert.equal(p.uploadUrl, original.uploadUrl);
  assert.equal(p.editing.output.profile, 'legacy-source');
  assert.equal(p.editing.assets[0].frameRate, 60);
  assert.equal(p.takes[0].id, 'a');
  assert.deepEqual([p.takes[0].start, p.takes[0].end], [2, 8]);
  assert.equal(p.exportedSignature, timelineSignature(p));
  assert.equal(p.uploadSignature, timelineSignature(p));
  assert.equal(original.version, 1);
});
test('migração não concede validade a um export de outra montagem', () => {
  const p = migrateStudioProject(legacy({ exportedSignature: 'old-unproven' }));
  assert.equal(p.exportedSignature, 'old-unproven');
  assert.notEqual(p.exportedSignature, timelineSignature(p));
});
test('source único suporta split/duplicação sem copiar nem adicionar original', () => {
  const p = standard();
  const editing = reconcileStudioTakes(p, [{ ...p.takes[0], id: 'left', end: 4 }, { ...p.takes[0], id: 'right', start: 4 }, p.takes[1], { ...p.takes[0], id: 'copy' }]);
  assert.equal(editing.assets.length, 2);
  assert.equal(new Set(editing.main.slice(0, 2).map(clip => clip.assetId)).size, 1);
  assert.equal(compileStudioRecipe(frame(editing)).durationTicks, ticks(30));
  assert.throws(() => reconcileStudioTakes(p, [{ ...p.takes[0], uri: 'file:///new.mp4' }]), /preservar/);
});
test('120000 ticks representam cadências fracionárias e tempos de edição sem deriva', () => {
  assert.equal(ticks(1001 / 24000), 5005);
  assert.equal(ticks(1001 / 60000), 2002);
  assert.equal(studioSeconds(ticks(1.1)), 1.1);
  assert.throws(() => ticks(Infinity), /tempo/);
});
test('títulos ligados acompanham reorder; música absoluta permanece e participa da duração final', () => {
  let p = standard();
  let editing = addStudioLayerItem(p.editing, createStudioTextItem({ id: 'title', clipId: 'b', content: 'Parte B', durationTicks: ticks(2) }));
  editing = { ...editing, assets: [...editing.assets, { id: 'music', kind: 'audio', uri: 'file:///music.m4a', name: 'Música', durationTicks: ticks(30) }] };
  editing = addStudioLayerItem(editing, { id: 'bed', kind: 'audio', assetId: 'music', atTicks: ticks(3), durationTicks: ticks(20), sourceStartTicks: 0, sourceEndTicks: ticks(20), gain: 0.2 });
  p = frame(editing);
  const before = compileStudioRecipe(p);
  assert.equal(before.clips.find(clip => clip.id === 'title').startTicks, ticks(10));
  editing = reconcileStudioTakes(p, [...p.takes].reverse());
  const after = compileStudioRecipe(frame(editing));
  assert.equal(after.clips.find(clip => clip.id === 'title').startTicks, 0);
  assert.equal(after.clips.find(clip => clip.id === 'bed').startTicks, ticks(3));
  assert.equal(after.durationTicks, ticks(23));
});
test('legenda usa tempo da fonte e intersecta corte sem apagar cue original', () => {
  const p = standard();
  const editing = addStudioLayerItem(p.editing, { ...createStudioTextItem({ id: 'cue', kind: 'caption', content: 'Uma ideia', durationTicks: ticks(3) }),
    anchor: { clipId: 'a', sourceStartTicks: ticks(2), sourceEndTicks: ticks(5) } });
  const cut = reconcileStudioTakes(frame(editing), [{ ...p.takes[0], start: 3, end: 8 }, p.takes[1]]);
  const cue = compileStudioRecipe(frame(cut)).clips.find(clip => clip.id === 'cue');
  assert.equal(cue.startTicks, 0);
  assert.equal(cue.durationTicks, ticks(2));
  assert.deepEqual(cut.layers[0].items[0].anchor, { clipId: 'a', sourceStartTicks: ticks(2), sourceEndTicks: ticks(5) });
});
test('split distribui vínculos atravessando borda e duplicação replica título com IDs novos', () => {
  let p = standard();
  const editing = addStudioLayerItem(p.editing, { ...createStudioTextItem({ id: 'title', content: 'Sobreposição', durationTicks: ticks(6) }), anchor: { clipId: 'a', offsetTicks: ticks(2) } });
  p = frame(editing);
  const split = reconcileStudioTakes(p, [{ ...p.takes[0], id: 'left', end: 5 }, { ...p.takes[0], id: 'right', start: 5 }, p.takes[1]]);
  const items = split.layers[0].items;
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => [item.anchor.clipId, item.anchor.offsetTicks, item.durationTicks]), [['left', ticks(2), ticks(3)], ['right', 0, ticks(3)]]);
  assert.equal(new Set(items.map(item => item.id)).size, 2);
  const duplicated = reconcileStudioTakes(p, [p.takes[0], { ...p.takes[0], id: 'copy' }, p.takes[1]]);
  assert.equal(duplicated.layers[0].items.length, 2);
  assert.equal(duplicated.layers[0].items[1].anchor.clipId, 'copy');
  const deleted = reconcileStudioTakes(p, [p.takes[1]]);
  assert.equal(deleted.layers[0].items.length, 0);
  assert.equal(deleted.assets.length, 2);
});
test('duas fontes simultâneas são válidas; terceira sobreposta falha mas fronteira adjacente não conta duas vezes', () => {
  const p = standard(); const assetId = p.editing.main[0].assetId;
  const overlay = id => ({ id, kind: 'video', assetId, atTicks: 0, durationTicks: ticks(5), sourceStartTicks: 0, sourceEndTicks: ticks(5) });
  let editing = addStudioLayerItem(p.editing, overlay('pip'));
  assert.deepEqual(validateStudioRecipe(compileStudioRecipe(frame(editing))), []);
  editing = addStudioLayerItem(editing, overlay('extra'));
  assert.ok(validateStudioRecipe(compileStudioRecipe(frame(editing))).some(issue => issue.includes('dois vídeos')));
  editing = patchStudioLayerItem(editing, 'extra', { atTicks: ticks(5) });
  assert.deepEqual(validateStudioRecipe(compileStudioRecipe(frame(editing))), []);
});
test('imagem não possui duração artificial de original e hold participa da sequência', () => {
  let editing = emptyStudioEditing('short');
  const source = { id: 'still', kind: 'image', name: 'Slide', uri: 'file:///slide.jpg', durationTicks: 0, width: 3024, height: 4032 };
  editing = { ...editing, assets: [source], main: [{ id: 'slide', assetId: 'still', sourceStartTicks: 0, sourceEndTicks: 0, durationTicks: ticks(4) }] };
  const p = frame(editing), recipe = compileStudioRecipe(p);
  assert.equal(recipe.durationTicks, ticks(4));
  assert.equal(recipe.clips[0].sourceEndTicks, 0);
  assert.equal(p.takes[0].end, 4);
  assert.deepEqual(validateStudioEditing(editing, 'short'), []);
});
test('grade reversível, texto, recorte e áudio invalidam render; metadados e container não invalidam', () => {
  let p = standard();
  const base = timelineSignature(p);
  const graded = frame(patchStudioClipGrade(p.editing, 'a', { preset: 'studio', exposure: 0.3 }));
  assert.notEqual(timelineSignature(graded), base);
  const natural = frame({ ...p.editing, main: p.editing.main.map(clip => ({ ...clip, grade: undefined })) });
  assert.equal(timelineSignature(natural), base);
  let editing = addStudioLayerItem(p.editing, createStudioTextItem({ id: 'title' }));
  p = frame(editing);
  const title = timelineSignature(p);
  editing = patchStudioLayerItem(editing, 'title', { text: { content: 'Novo texto' }, rect: { width: 0.5 } });
  assert.notEqual(timelineSignature(frame(editing)), title);
  assert.equal(timelineSignature({ ...p, title: 'Outro título pedagógico' }), title);
  const rebased = rebaseStudioProject(p, 'file:///new/Documents/');
  assert.equal(rebased.editing.assets[0].uri.includes('/new/Documents/'), true);
  assert.equal(timelineSignature(rebased), title);
  assert.notEqual(rebased.takes, p.takes);
  assert.equal(timelineSignature(frame(removeStudioLayerItem(p.editing, 'title'))), base);
});
test('dados de cor/tempo não finitos e perfil não aprovado são rejeitados; fonte cinematicRaw não é fingida', () => {
  const p = standard();
  for (const grade of [{ ...studioGrade(), exposure: NaN }, { ...studioGrade(), intensity: 2 }]) {
    const editing = { ...p.editing, main: p.editing.main.map(clip => ({ ...clip, grade })) };
    assert.ok(validateStudioEditing(editing, 'aula').some(issue => issue.includes('cor')));
  }
  const unsafe = { ...p.editing, assets: p.editing.assets.map(asset => ({ ...asset, sourceStage: 'cinematicRaw' })) };
  assert.ok(validateStudioEditing(unsafe, 'aula').some(issue => issue.includes('renderizado')));
  const output = { ...p.editing.output, width: 3840, height: 2160 };
  assert.ok(validateStudioEditing({ ...p.editing, output }, 'aula').some(issue => issue.includes('1080p')));
});
test('dados inválidos de camada oculta e original sem uso continuam bloqueando o save', () => {
  const p = standard();
  let editing = addStudioLayerItem(p.editing, { ...createStudioTextItem({ id: 'hidden', durationTicks: ticks(2) }), anchor: { clipId: 'a', offsetTicks: ticks(30) } });
  assert.equal(compileStudioRecipe(frame(editing)).clips.some(clip => clip.id === 'hidden'), false);
  assert.deepEqual(validateStudioEditing(editing, 'aula'), []);
  for (const patch of [{ grade: { ...studioGrade(), exposure: NaN } }, { rect: { x: 0, y: 0, width: -1, height: 1 } }, { fadeInTicks: ticks(3) }, { text: { color: 'invalid' } }]) {
    const bad = patchStudioLayerItem(editing, 'hidden', patch);
    assert.ok(validateStudioEditing(bad, 'aula').length > 0);
  }
  editing = { ...editing, assets: [...editing.assets, { id: 'unused', kind: 'video', uri: 'file:///unused.mp4', name: 'Unused', durationTicks: ticks(2), frameRate: NaN }] };
  assert.ok(validateStudioEditing(editing, 'aula').some(issue => issue.includes('originais')));
});
test('split de vídeo ligado preserva o frame original do overlay em cada metade', () => {
  let p = standard();
  const assetId = p.editing.main[1].assetId;
  const editing = addStudioLayerItem(p.editing, { id: 'overlay', kind: 'video', assetId, atTicks: 0,
    durationTicks: ticks(6), sourceStartTicks: ticks(1), sourceEndTicks: ticks(7), anchor: { clipId: 'a', offsetTicks: ticks(2) } });
  p = frame(editing);
  const split = reconcileStudioTakes(p, [{ ...p.takes[0], id: 'left', end: 5 }, { ...p.takes[0], id: 'right', start: 5 }, p.takes[1]]);
  const clips = compileStudioRecipe(frame(split)).clips.filter(clip => clip.id.startsWith('overlay~'));
  assert.deepEqual(clips.map(clip => [clip.startTicks, clip.durationTicks, clip.sourceStartTicks, clip.sourceEndTicks]),
    [[ticks(2), ticks(3), ticks(1), ticks(4)], [ticks(5), ticks(3), ticks(4), ticks(7)]]);
  assert.deepEqual(validateStudioEditing(split, 'aula'), []);
});
