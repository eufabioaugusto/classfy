import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationIssues, rebaseStudioProject, timelineDuration, timelineSignature } from './model.ts';
import { compileStudioRecipe, createStudioTextItem, emptyStudioEditing, migrateStudioProject, moveStudioLayerItemToLane,
  reconcileStudioTakes, setStudioLayerHidden, setStudioLayerMuted, setStudioMainMuted, studioTicks, validateStudioEditing, withStudioTakes } from './model.ts';
import { studioVisibleCanvasLayers } from './canvasGeometry.ts';
import { createStudioEditingHistory } from './editingHistory.ts';
const take = (id, duration, start = 0, end = duration) => ({ id, uri: `file:///${id}.mp4`, duration, start, end, name: id });
const project = (patch = {}) => ({ kind: 'short', title: 'Uma ideia', description: '', takes: [take('a', 180)], coverUri: 'file:///cover.jpg', visibility: 'free', price: '', ...patch });
test('limite de Short considera duração final e frações, sem arredondar para baixo', () => {
  assert.deepEqual(publicationIssues(project()), []);
  assert.ok(publicationIssues(project({ takes: [take('a', 180.01)] })).some(i => i.includes('3 minutos')));
  assert.deepEqual(publicationIssues(project({ takes: [take('a', 240, 20, 100), take('b', 200, 0, 100)] })), []);
});
test('exportação reutilizada é invalidada por corte, ordem, take ou formato, mas não por título', () => {
  const p = project({ takes: [take('a', 50), take('b', 20)] });
  const signature = timelineSignature(p);
  assert.equal(signature, timelineSignature({ ...p, title: 'Outro título' }));
  assert.notEqual(signature, timelineSignature({ ...p, takes: [...p.takes].reverse() }));
  assert.notEqual(signature, timelineSignature({ ...p, takes: [take('a', 50, 1), take('b', 20)] }));
  assert.notEqual(signature, timelineSignature({ ...p, kind: 'aula' }));
  assert.equal(timelineDuration(p.takes), 70);
});
test('publicação rejeita corte vazio, fora da origem ou não finito', () => {
  for (const t of [take('a', 10, 0, 11), take('a', 10, -1, 9), take('a', 10, 5, 5), take('a', 10, NaN, 9), take('a', Infinity)]) {
    assert.ok(publicationIssues(project({ takes: [t] })).some(i => i.includes('cortes')));
  }
});
test('corte mínimo de 0,1 segundo tolera precisão decimal sem aceitar corte menor', () => {
  assert.deepEqual(publicationIssues(project({ takes: [take('a', 2, 1.1, 1.2)] })), []);
  assert.ok(publicationIssues(project({ takes: [take('a', 2, 1.1, 1.199)] })).some(i => i.includes('cortes')));
});
test('arquivo copiado mas ainda fora da montagem exige recuperação ou retirada explícita', () => {
  assert.ok(publicationIssues(project({ pendingTakes: [{ id: 'pending', uri: 'file:///pending.mp4', name: 'Take interrompido' }] })).some(i => i.includes('pendentes')));
});
test('aula/podcast exigem descrição e conteúdo pago exige preço positivo', () => {
  assert.ok(publicationIssues(project({ kind: 'aula' })).some(i => i.includes('aprender')));
  assert.ok(publicationIssues(project({ visibility: 'paid', price: '0' })).some(i => i.includes('preço')));
  assert.deepEqual(publicationIssues(project({ visibility: 'paid', price: '19,90' })), []);
});
test('atualização do iPhone recupera arquivos após mudança do container, preservando a assinatura de edição', () => {
  const p = project({ ownerId: 'owner', id: 'project', takes: [{ ...take('a', 10), uri: 'file:///old/Documents/classfy-studio/owner/project/take.mp4' }],
    coverUri: 'file:///old/Documents/classfy-studio/owner/project/cover.jpg', exportedUri: 'file:///old/Documents/classfy-studio/owner/project/export.mp4' });
  p.exportedSignature = timelineSignature(p);
  p.uploadSignature = p.exportedSignature;
  const rebased = rebaseStudioProject(p, 'file:///new/Documents/');
  assert.equal(rebased.takes[0].uri, 'file:///new/Documents/classfy-studio/owner/project/take.mp4');
  assert.equal(rebased.exportedSignature, timelineSignature(rebased));
  assert.equal(rebased.uploadSignature, timelineSignature(rebased));
  assert.equal(rebaseStudioProject(project(), 'file:///new/Documents/').takes[0].uri, 'file:///a.mp4');
});

test('original remoto referenciado conserva identidade, receita e exportação após mudança do container', () => {
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  for(const name of [`${id}.mov`,`${id}-2k.mov`,`${id}-grade-12345678.mp4`]){
    const uri=`file:///old/Documents/classfy-studio-remote/${owner}/${session}/${name}`;
    const raw=project({version:1,id:'project',ownerId:owner,kind:'aula',takes:[{...take(id,777),uri,width:3840,height:2160,frameRate:30,grade:{preset:'cinematic',intensity:0.5,exposure:0,contrast:0,saturation:0,temperature:0}}]});
    const migrated=migrateStudioProject(raw),signature=timelineSignature(migrated);
    migrated.exportedSignature=signature;migrated.uploadSignature=signature;
    const relocated=rebaseStudioProject(migrated,'file:///new/Documents/');
    assert.equal(relocated.takes[0].uri,uri.replace('/old/','/new/'));
    assert.equal(timelineSignature(relocated),signature);assert.equal(relocated.exportedSignature,signature);assert.equal(relocated.uploadSignature,signature);
    assert.equal(migrateStudioProject({...raw,takes:[{...raw.takes[0],uri:relocated.takes[0].uri}]}).editing.assets[0].id,migrated.editing.assets[0].id);
    assert.equal(compileStudioRecipe(relocated).durationTicks,studioTicks(777));
  }
});

test('rebase remoto rejeita outro dono, arquivo externo, sessão inválida e traversal',()=>{
  const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',id='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const root=`file:///old/Documents/classfy-studio-remote/${owner}/${session}/`;
  for(const uri of [`${root}${id}.mov`.replace(owner,session),`${root}../${id}.mov`,`${root}${id}.mov?token=private`,`${root}${id}-grade-private.mp4`,`${root}${id}.mov`.replace(session,'external'),'file:///external.mov','https://host.invalid/Documents/classfy-studio-remote/'+owner+'/'+session+'/'+id+'.mov']){
    const p=project({ownerId:owner,id:'project',takes:[{...take(id,10),uri}]});
    assert.equal(rebaseStudioProject(p,'file:///new/Documents/').takes[0].uri,uri);
  }
});

function trackFixture() {
  const t = studioTicks;
  const editing = emptyStudioEditing('aula');
  editing.assets = [{ id: 'video', kind: 'video', uri: 'file:///original.mp4', name: 'Original', durationTicks: t(10), width: 1920, height: 1080 },
    { id: 'audio', kind: 'audio', uri: 'file:///music.m4a', name: 'Música', durationTicks: t(8) }];
  editing.main = [{ id: 'main1', assetId: 'video', sourceStartTicks: 0, sourceEndTicks: t(5), gain: 0.7 },
    { id: 'main2', assetId: 'video', sourceStartTicks: t(5), sourceEndTicks: t(10), gain: 1.4 }];
  editing.layers = [{ id: 'videos', kind: 'video', items: [
    { id: 'pip1', kind: 'video', assetId: 'video', atTicks: t(1), durationTicks: t(2), sourceStartTicks: t(2), sourceEndTicks: t(4), opacity: 0.6, gain: 0.35 },
    { id: 'pip2', kind: 'video', assetId: 'video', atTicks: t(3), durationTicks: t(2), sourceStartTicks: t(4), sourceEndTicks: t(6), opacity: 0.8, gain: 0.55 } ] },
    { id: 'titles', kind: 'text', items: [{ ...createStudioTextItem({ id: 'title', content: 'Aula', atTicks: t(1), durationTicks: t(5) }), opacity: 0.42 }] },
    { id: 'music', kind: 'audio', items: [{ id: 'music1', kind: 'audio', assetId: 'audio', atTicks: t(7), durationTicks: t(8), sourceStartTicks: 0, sourceEndTicks: t(8), gain: 0.25, fadeInTicks: t(0.5), fadeOutTicks: t(1) }] }];
  assert.deepEqual(validateStudioEditing(editing, 'aula'), []);
  return editing;
}
const trackProject = editing => withStudioTakes({ id: 'project', ownerId: 'owner', version: 2, kind: 'aula', editing });
const trackRecipe = editing => compileStudioRecipe(trackProject(editing));

test('esconder uma faixa mantém todos os elementos, duração e áudio; restaura as opacidades originais', () => {
  const base = trackFixture(), before = trackRecipe(base), snapshot = JSON.stringify(base);
  let hidden = setStudioLayerHidden(base, 'videos', true);
  hidden = setStudioLayerHidden(hidden, 'titles', true);
  const recipe = trackRecipe(hidden);
  assert.equal(recipe.durationTicks, before.durationTicks);
  assert.deepEqual(recipe.assets, before.assets);
  assert.deepEqual(recipe.clips.map(clip => [clip.id, clip.startTicks, clip.durationTicks, clip.sourceStartTicks, clip.sourceEndTicks]),
    before.clips.map(clip => [clip.id, clip.startTicks, clip.durationTicks, clip.sourceStartTicks, clip.sourceEndTicks]));
  for (const id of ['pip1', 'pip2', 'title']) assert.equal(recipe.clips.find(clip => clip.id === id).opacity, 0);
  assert.equal(recipe.clips.find(clip => clip.id === 'pip1').gain, 0.35, 'hiding a video does not mute its audio');
  assert.deepEqual(studioVisibleCanvasLayers(hidden, recipe, 2, true).map(clip => clip.id), ['main1'], 'hidden visuals have no canvas hit target');
  assert.equal(JSON.stringify(base), snapshot, 'source metadata and item opacity were never edited');
  const restored = setStudioLayerHidden(setStudioLayerHidden(hidden, 'videos', false), 'titles', false);
  assert.deepEqual(restored, base); assert.deepEqual(trackRecipe(restored), before);
});

test('mute de faixa e principal conserva volume, fades e quadro e restaura ganho exato', () => {
  const base = trackFixture(), before = trackRecipe(base);
  const muted = setStudioMainMuted(setStudioLayerMuted(setStudioLayerMuted(base, 'videos', true), 'music', true), true);
  const recipe = trackRecipe(muted);
  assert.equal(recipe.durationTicks, studioTicks(15), 'muted music still extends the montage');
  assert.ok(recipe.clips.filter(clip => ['video', 'audio'].includes(clip.kind)).every(clip => clip.gain === 0));
  for (const clip of recipe.clips) {
    const original = before.clips.find(value => value.id === clip.id);
    assert.equal(clip.opacity, original.opacity); assert.equal(clip.fadeInTicks, original.fadeInTicks); assert.equal(clip.fadeOutTicks, original.fadeOutTicks);
  }
  assert.equal(muted.main[0].gain, 0.7); assert.equal(muted.main[1].gain, 1.4); assert.equal(muted.layers[2].items[0].gain, 0.25);
  const restored = setStudioMainMuted(setStudioLayerMuted(setStudioLayerMuted(muted, 'videos', false), 'music', false), false);
  assert.deepEqual(restored, base); assert.deepEqual(trackRecipe(restored), before);
});

test('controles opcionais persistem no schema2 e invalidam somente a edição efetiva da exportação', () => {
  const base = trackFixture(), original = trackProject(base);
  const next = trackProject(setStudioMainMuted(setStudioLayerMuted(setStudioLayerHidden(base, 'videos', true), 'music', true), true));
  const readback = migrateStudioProject(JSON.parse(JSON.stringify(next)));
  assert.equal(readback.editing.mainMuted, true); assert.equal(readback.editing.layers[0].hidden, true); assert.equal(readback.editing.layers[2].muted, true);
  assert.deepEqual(validateStudioEditing(readback.editing, 'aula'), []);
  assert.deepEqual(trackRecipe(readback.editing), trackRecipe(next.editing));
  assert.notEqual(timelineSignature(next), timelineSignature(original));
  for (const change of [setStudioMainMuted(base, true), setStudioLayerMuted(base, 'music', true), setStudioLayerHidden(base, 'titles', true)]) {
    assert.notEqual(timelineSignature(trackProject(change)), timelineSignature(original));
  }
  assert.equal(setStudioMainMuted(base, false), base); assert.equal(setStudioLayerMuted(base, 'music', false), base); assert.equal(setStudioLayerHidden(base, 'titles', false), base);
  assert.deepEqual(trackRecipe({ ...base, mainMuted: false, layers: base.layers.map(layer => ({ ...layer, hidden: false, muted: false })) }), trackRecipe(base));
});

test('reordenação, extração de grupo e adapter de takes preservam os controles da faixa', () => {
  const base = setStudioMainMuted(setStudioLayerMuted(setStudioLayerHidden(trackFixture(), 'videos', true), 'videos', true), true);
  const moved = moveStudioLayerItemToLane(base, 'pip1', 4);
  const lane = moved.layers.find(layer => layer.items.some(item => item.id === 'pip1'));
  assert.equal(lane.hidden, true); assert.equal(lane.muted, true);
  assert.equal(moved.layers.find(layer => layer.id === 'videos').hidden, true);
  const recipe = trackRecipe(moved), pip = recipe.clips.find(clip => clip.id === 'pip1');
  assert.equal(pip.opacity, 0); assert.equal(pip.gain, 0); assert.equal(pip.sourceStartTicks, studioTicks(2));
  const project = trackProject(moved), reversed = reconcileStudioTakes(project, [...project.takes].reverse());
  assert.equal(reversed.mainMuted, true); assert.deepEqual(reversed.layers, moved.layers);
  assert.ok(trackRecipe(reversed).clips.filter(clip => clip.zIndex === 0).every(clip => clip.gain === 0));
});

test('validação rejeita controles não booleanos e não mascara ganho ou opacidade corrompidos', () => {
  for (const value of [null, 0, 1, 'false', 'true', {}]) {
    const base = trackFixture();
    for (const invalid of [{ ...base, mainMuted: value }, { ...base, layers: [{ ...base.layers[0], hidden: value }, ...base.layers.slice(1)] },
      { ...base, layers: [{ ...base.layers[0], muted: value }, ...base.layers.slice(1)] }]) {
      assert.ok(validateStudioEditing(invalid, 'aula').some(issue => issue.includes('controles')));
    }
  }
  const base = trackFixture();
  assert.ok(validateStudioEditing({ ...setStudioMainMuted(base, true), main: base.main.map((clip, i) => i ? clip : { ...clip, gain: NaN }) }, 'aula').some(issue => issue.includes('volume')));
  const broken = setStudioLayerHidden(setStudioLayerMuted(base, 'videos', true), 'videos', true);
  broken.layers[0] = { ...broken.layers[0], items: broken.layers[0].items.map(item => ({ ...item, opacity: -1, gain: 99 })) };
  assert.ok(validateStudioEditing(broken, 'aula').some(issue => issue.includes('volume')));
  assert.throws(() => setStudioLayerHidden(base, 'missing', true), /faixa/);
  assert.throws(() => setStudioMainMuted(base, 'true'), /verdadeiro/);
});

test('save falho não avança undo; hide e mute salvos são desfeitos e refeitos sem tocar originais', () => {
  const initial = trackProject(trackFixture()), history = createStudioEditingHistory();
  history.sync(initial, 'owner');
  const editing = setStudioMainMuted(setStudioLayerMuted(setStudioLayerHidden(initial.editing, 'videos', true), 'music', true), true);
  const failed = history.beginEditing(initial, editing); history.abort(failed);
  assert.equal(history.state().undoCount, 0);
  const ticket = history.beginEditing(initial, editing), saved = trackProject(ticket.editing);
  history.sync(saved, 'owner'); assert.equal(history.commit(ticket, saved), true); assert.equal(history.state().undoCount, 1);
  const undo = history.beginUndo(saved), undone = trackProject(undo.editing);
  assert.equal(history.commit(undo, undone), true); assert.deepEqual(trackRecipe(undone.editing), trackRecipe(initial.editing));
  const redo = history.beginRedo(undone), redone = trackProject(redo.editing);
  assert.equal(history.commit(redo, redone), true); assert.deepEqual(trackRecipe(redone.editing), trackRecipe(editing));
  assert.deepEqual(redone.editing.assets, initial.editing.assets); assert.deepEqual(redone.takes, initial.takes);
});
