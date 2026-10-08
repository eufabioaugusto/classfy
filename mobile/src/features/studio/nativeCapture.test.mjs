import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

// Run the production native wrapper, including its hooks, command promises,
// native events and imperative handle. Only the platform boundary is stubbed.
function harness({ effectsAvailable = true, nativeAvailable = true } = {}) {
  const slots = []; let cursor = 0, effects = [], canvas, tag = 73, sequence = 0;
  const calls = [], ref = { current: null };
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const hooks = {
    forwardRef: component => component,
    useRef: value => { const i = cursor++; return slots[i] ||= { current: value }; },
    useEffect: (callback, dependencies) => {
      const i = cursor++;
      if (!slots[i] || !equals(slots[i].dependencies, dependencies)) effects.push({ i, callback, dependencies });
    },
    useImperativeHandle: (target, callback, dependencies) => {
      const i = cursor++;
      if (!slots[i] || !equals(slots[i].dependencies, dependencies)) { slots[i] = { dependencies }; target.current = callback(); }
    },
  };
  const command = (kind, args) => new Promise((resolve, reject) => calls.push({ kind, args, resolve, reject }));
  const dependencies = {
    react: hooks,
    'react/jsx-runtime': { jsx: (_type, props) => { canvas = props; props.ref.current = {}; return props; } },
    'react-native': { findNodeHandle: () => tag, Platform: { OS: 'ios' } },
    'expo-modules-core': { requireNativeViewManager: () => 'native-camera' },
    'expo-crypto': { randomUUID: () => `record-${++sequence}` },
    './model': model,
    '../../../modules/classfy-studio-media': {
      isStudioNativeCameraAvailable: () => nativeAvailable,
      isStudioNativeCameraEffectsAvailable: () => effectsAvailable,
      setStudioNativeCameraEffectAsync: (...args) => command('effect', args),
      startStudioNativeCameraRecordingAsync: (...args) => command('record', args),
      stopStudioNativeCameraRecordingAsync: (...args) => { calls.push({ kind: 'stop', args }); return Promise.resolve({}); },
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('./StudioNativeCamera.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (!Object.hasOwn(dependencies, name)) throw new Error(`Unexpected dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  function render(props = {}) {
    cursor = 0; effects = []; module.exports.StudioNativeCamera(props, ref);
    for (const effect of effects) { slots[effect.i]?.cleanup?.(); slots[effect.i] = { dependencies: effect.dependencies, cleanup: effect.callback() }; }
  }
  render();
  return { ref, calls,
    tag: next => { tag = next; },
    ack: (call, patch = {}) => ({ effectRevision: 1, generation: 1, previewProcessed: true, grade: JSON.parse(call.args[1]), ...patch }),
    event: value => canvas.onRecordingState({ nativeEvent: value }),
    state: value => canvas.onState({ nativeEvent: value }),
    interruption: () => canvas.onInterruption({ nativeEvent: { reason: 'previewFallback', generation: 1, revision: 1 } }),
    unmount: () => { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test('preset confirmado congela a receita do REC, mantendo URI original mesmo após falha da prévia', async () => {
  const h = harness(); const grade = { ...model.studioGrade('studio'), intensity: 0.62 };
  const expected = { ...grade };
  const preparing = h.ref.current.setEffectAsync(grade); const effect = h.calls.at(-1);
  grade.intensity = 0.1;
  await assert.rejects(h.ref.current.recordAsync(), /confirmar o tratamento/);
  assert.equal(h.calls.filter(call => call.kind === 'record').length, 0);
  effect.resolve(h.ack(effect)); await preparing;
  const recording = h.ref.current.recordAsync(); const owned = h.calls.at(-1);
  await assert.rejects(h.ref.current.setEffectAsync(model.studioGrade('cinematic')), /Finalize o take/);
  h.interruption(); // Preserve this operation; only the next recording is gated.
  owned.resolve({ uri: 'file:///original.mov', operationId: owned.args[1], duration: 2 });
  const take = await recording;
  assert.equal(take.uri, 'file:///original.mov');
  assert.deepEqual(take.grade, expected);
  await assert.rejects(h.ref.current.recordAsync(), /Escolha Natural/);
});

test('ack antigo não substitui o preset atual nem libera REC enquanto o ajuste novo está pendente', async () => {
  const h = harness();
  const old = h.ref.current.setEffectAsync(model.studioGrade('studio')); const oldCall = h.calls.at(-1);
  const oldRejected = assert.rejects(old, /câmera mudou/);
  const latest = h.ref.current.setEffectAsync({ ...model.studioGrade('cinematic'), intensity: 0.4 }); const latestCall = h.calls.at(-1);
  oldCall.resolve(h.ack(oldCall)); await oldRejected;
  await assert.rejects(h.ref.current.recordAsync(), /confirmar o tratamento/);
  latestCall.resolve(h.ack(latestCall)); await latest;
  const recording = h.ref.current.recordAsync(); const owned = h.calls.at(-1);
  owned.resolve({ uri: 'file:///source.mov', operationId: owned.args[1] });
  assert.equal((await recording).grade.preset, 'cinematic');
});

test('formato sem prévia não confirma Studio; Natural explícito permite original sem receita falsa', async () => {
  const h = harness();
  const selecting = h.ref.current.setEffectAsync(model.studioGrade('studio')); const request = h.calls.at(-1);
  const rejected = assert.rejects(selecting, /não oferece prévia/);
  request.resolve(h.ack(request, { previewProcessed: false })); await rejected;
  await assert.rejects(h.ref.current.recordAsync(), /Escolha Natural/);
  const natural = h.ref.current.setEffectAsync(model.studioGrade()); const clear = h.calls.at(-1);
  clear.resolve(h.ack(clear, { previewProcessed: false })); await natural;
  const recording = h.ref.current.recordAsync(); const owned = h.calls.at(-1);
  owned.resolve({ uri: 'file:///original.mov', operationId: owned.args[1] });
  assert.equal((await recording).grade, undefined);
});

test('grade divergente ou câmera trocada não confirma tratamento nem reutiliza estado de outra view', async () => {
  const h = harness();
  const wrong = h.ref.current.setEffectAsync(model.studioGrade('studio')); const wrongCall = h.calls.at(-1);
  const wrongRejected = assert.rejects(wrong, /não confirmou os ajustes/);
  wrongCall.resolve(h.ack(wrongCall, { grade: model.studioGrade('cinematic') })); await wrongRejected;
  const changing = h.ref.current.setEffectAsync(model.studioGrade('studio')); const old = h.calls.at(-1);
  const rejected = assert.rejects(changing, /câmera mudou/);
  h.tag(99); old.resolve(h.ack(old)); await rejected;
  await assert.rejects(h.ref.current.recordAsync(), /Escolha Natural/);
  const natural = h.ref.current.setEffectAsync(model.studioGrade()); const newCall = h.calls.at(-1);
  assert.equal(newCall.args[0], 99);
  newCall.resolve(h.ack(newCall)); await natural;
});

test('trocar formato no mesmo tag invalida ack; eventos novos não alteram a receita do REC já iniciado', async () => {
  const h = harness(); const grade = { ...model.studioGrade('studio'), intensity: 0.55 };
  const first = h.ref.current.setEffectAsync(grade); const effect = h.calls.at(-1);
  effect.resolve(h.ack(effect)); await first;
  h.state({ generation: 2, previewProcessed: true });
  await assert.rejects(h.ref.current.recordAsync(), /Escolha Natural/);
  const stale = h.ref.current.setEffectAsync(grade); const old = h.calls.at(-1);
  const rejected = assert.rejects(stale, /câmera mudou/);
  old.resolve(h.ack(old, { generation: 1 })); await rejected;
  const current = h.ref.current.setEffectAsync(grade); const latest = h.calls.at(-1);
  latest.resolve(h.ack(latest, { generation: 2 })); await current;
  const recording = h.ref.current.recordAsync(); const owned = h.calls.at(-1);
  h.state({ generation: 3, previewProcessed: false });
  owned.resolve({ uri: 'file:///raw.mov', operationId: owned.args[1] });
  assert.deepEqual((await recording).grade, grade);
  await assert.rejects(h.ref.current.recordAsync(), /Escolha Natural/);
});

test('binário antigo rejeita tratamentos e grava somente original; desmontagem invalida ack tardio', async () => {
  const old = harness({ effectsAvailable: false });
  await assert.rejects(old.ref.current.setEffectAsync(model.studioGrade('studio')), /Atualize/);
  assert.equal(old.calls.length, 0);
  const raw = old.ref.current.recordAsync(); const native = old.calls.at(-1);
  native.resolve({ uri: 'file:///raw.mov', operationId: native.args[1] });
  assert.equal((await raw).grade, undefined);
  const current = harness();
  const selecting = current.ref.current.setEffectAsync(model.studioGrade('studio')); const effect = current.calls.at(-1);
  const rejected = assert.rejects(selecting, /câmera mudou/);
  current.unmount(); effect.resolve(current.ack(effect)); await rejected;
});

test('erro recuperável devolve snapshot confirmado para journal; STOP continua na câmera da operação', async () => {
  const h = harness(); const grade = { ...model.studioGrade('cinematic'), intensity: 0.35 };
  const selecting = h.ref.current.setEffectAsync(grade); const effect = h.calls.at(-1);
  effect.resolve(h.ack(effect)); await selecting;
  const recording = h.ref.current.recordAsync(); const owned = h.calls.at(-1);
  const rejected = assert.rejects(recording, error => {
    assert.equal(error.recoveryUri, 'file:///recoverable.mov');
    assert.deepEqual(error.grade, grade);
    return true;
  });
  h.tag(99); h.ref.current.stopRecording();
  assert.deepEqual(h.calls.at(-1).args, [73, owned.args[1]]);
  h.event({ operationId: owned.args[1], phase: 'finished', generation: 1, revision: 1, recoveryUri: 'file:///recoverable.mov' });
  owned.reject(new Error('Gravação interrompida')); await rejected;
});
