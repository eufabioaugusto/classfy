import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { compileStudioRecipe, emptyStudioEditing, reconcileStudioTakes, withStudioTakes } from './model.ts';
import { mayRunStudioPreviewDiagnostic, studioPreviewDiagnosticRecipe, studioPreviewDiagnosticEvent,
  createStudioPreviewDiagnosticReport, createStudioPreviewPlaybackProbe } from './previewDiagnostic.ts';

function fixture() {
  const take = { id: 'clip-private', uri: 'file:///private/original.mov', name: 'private-title', duration: 12.665, start: 0, end: 12.665,
    width: 2160, height: 3840, frameRate: 30, sourceKind: 'standard', sourceStage: 'standard',
    grade: { preset: 'cinematic', intensity: 0.8, exposure: -0.5, contrast: 0.4, saturation: 0.1, temperature: 0.2 } };
  const editing = reconcileStudioTakes({ kind: 'short', editing: emptyStudioEditing('short') }, [take]);
  return withStudioTakes({ id: 'project-private', ownerId: 'owner-private', kind: 'short', revision: 1, version: 2,
    state: 'draft', title: 'private-title', objective: '', audience: '', script: 'private-text-content', editing });
}
test('diagnóstico exige DEV, conta proprietária e projeto ativo com take; não abre fora do foreground', () => {
  const project = fixture();
  assert.equal(mayRunStudioPreviewDiagnostic(true, project.ownerId, project, true, true), true);
  for (const args of [[false, project.ownerId, project, true, true], [true, undefined, project, true, true],
    [true, 'other-owner', project, true, true], [true, project.ownerId, undefined, true, true],
    [true, project.ownerId, { ...project, takes: [] }, true, true], [true, project.ownerId, project, false, true],
    [true, project.ownerId, project, true, false]]) assert.equal(mayRunStudioPreviewDiagnostic(...args), false);
});
test('receita diagnóstica conserva geometria, tratamento e tempos reais sem fontes ou conteúdo privado', () => {
  const project = fixture(), recipe = compileStudioRecipe(project), before = structuredClone(recipe);
  const report = studioPreviewDiagnosticRecipe(recipe), json = JSON.stringify(report), clip = report.clips[0];
  assert.equal(report.version, recipe.version); assert.equal(report.durationTicks / report.timebase, 12.665);
  assert.equal(report.canvas.aspectRatio, 'portrait'); assert.equal(report.output.width, recipe.output.width); assert.equal(report.output.height, recipe.output.height);
  assert.equal(report.output.frameRateNumerator, 30); assert.equal(clip.sourceWidth, 2160); assert.equal(clip.sourceHeight, 3840);
  assert.equal(clip.sourceStartTicks, 0); assert.equal(clip.durationTicks, recipe.durationTicks);
  assert.equal(clip.sourceKind, 'standard'); assert.equal(clip.sourceStage, 'standard'); assert.deepEqual(clip.grade, recipe.clips[0].grade);
  assert.doesNotMatch(json, /private|file:\/\/|uri|ownerId|assetId|clip-private/); assert.deepEqual(recipe, before);
  assert.doesNotMatch(JSON.stringify(studioPreviewDiagnosticEvent({ type: 'error', revision: 'r', token: 2,
    code: 'E_FRAME', message: 'Erro file:///private/source.mov Bearer secret eyJtest.test.test' })), /private\/|Bearer|eyJ|secret|"token"/);
});
test('relatório serializa escritas, retém diagnóstico final e impede sessão antiga sobrescrever a atual', async () => {
  const writes = []; let unblock;
  const old = createStudioPreviewDiagnosticReport({ runId: 'old', metadata: {}, write: async value => {
    await new Promise(resolve => { unblock = resolve; }); writes.push(JSON.parse(value));
  } });
  void old.event('priming'); await new Promise(resolve => setImmediate(resolve));
  const fresh = createStudioPreviewDiagnosticReport({ runId: 'fresh', metadata: {}, write: async value => { writes.push(JSON.parse(value)); } });
  void old.event('late-old-error', { message: 'old error' });
  void fresh.event('native-diagnostics', { frameNoBuffer: 800, primeStage: 'first-frame' });
  void fresh.event('native-error', { message: 'quadros ausentes' });
  unblock(); await fresh.flush();
  assert.equal(writes.at(-1).runId, 'fresh'); assert.equal(writes.some(value => value.lastStage === 'late-old-error'), false);
  assert.equal(writes.at(-1).error, 'quadros ausentes'); assert.deepEqual(writes.at(-1).lastNativeDiagnostics, { frameNoBuffer: 800, primeStage: 'first-frame' });
  for (let i = 0; i < 205; i++) void fresh.event('playback', { positionSeconds: i });
  await fresh.flush(); assert.equal(fresh.snapshot().events.length, 200); assert.equal(fresh.snapshot().lastPlayback.positionSeconds, 204);
});
test('probe auto aguarda player real preparado, confirma Play e pausa após 1s sem comandos de captura', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let plays = 0, pauses = 0; const stages = [];
  const probe = createStudioPreviewPlaybackProbe({ automatic: true, current: () => true, play: () => plays++, pause: () => pauses++, report: stage => stages.push(stage) });
  probe.playback({ position: 0, sourcePosition: 0, playing: false, loading: true });
  probe.playback({ position: 0, sourcePosition: 0, playing: false, loading: false }); assert.equal(plays, 0);
  probe.playback({ takeId: 'clip', position: 0, sourcePosition: 0, playing: false, loading: false }); assert.equal(plays, 1);
  t.mock.timers.tick(1000); assert.equal(pauses, 0, '1 second starts at confirmed playing, not requested Play');
  probe.playback({ takeId: 'clip', position: 0.1, sourcePosition: 0.1, playing: true, loading: false });
  t.mock.timers.tick(999); assert.equal(pauses, 0); t.mock.timers.tick(1); assert.equal(pauses, 1);
  assert.equal(probe.stage(), 'finished'); assert.deepEqual(stages, ['priming', 'ready', 'play-requested', 'playing-confirmed', 'paused-after-one-second']);
  probe.dispose();
});
test('probe limita prime/Play e cancelamento de owner não produz reprodução tardia', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let plays = 0, pauses = 0; const stages = []; let current = true;
  const options = { automatic: true, current: () => current, play: () => plays++, pause: () => pauses++, report: stage => stages.push(stage) };
  let probe = createStudioPreviewPlaybackProbe(options); t.mock.timers.tick(20_000); assert.equal(probe.stage(), 'failed'); assert.equal(plays, 0); assert.equal(pauses, 1);
  probe.dispose(); probe = createStudioPreviewPlaybackProbe(options);
  probe.playback({ takeId: 'clip', position: 0, playing: false, loading: false }); t.mock.timers.tick(8000);
  assert.equal(probe.stage(), 'failed'); assert.equal(plays, 1); assert.equal(stages.filter(stage => stage === 'timeout').length, 2);
  probe.dispose(); probe = createStudioPreviewPlaybackProbe(options); current = false;
  probe.playback({ takeId: 'clip', position: 0, playing: false, loading: false }); t.mock.timers.tick(20_000);
  assert.equal(plays, 1); probe.dispose();
});
test('rota de release retorna Redirect antes de consultar conta/store/câmera', () => {
  let reads = 0;
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(readFileSync(new URL('../../../app/dev/studio-preview-diagnostic.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', '__DEV__', code)(name => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name === 'react-native') return { StyleSheet: { create: value => value } };
    if (name === 'expo-router') return { Redirect: 'redirect' };
    return new Proxy({}, { get: () => () => { reads++; throw new Error('Release cannot touch diagnostic runtime'); } });
  }, module, module.exports, false);
  assert.deepEqual(module.exports.default(), { type: 'redirect', props: { href: '/' } }); assert.equal(reads, 0);
});
