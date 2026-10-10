import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = ts.transpileModule(readFileSync(new URL('./voiceoverRecording.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness() {
  let current = true, granted = true, statusCallback, permissionPause, startPause, preparePause, stopFailure = false;
  const calls = [], removed = [], statuses = [];
  const state = { canRecord: false, isRecording: false, isDoneRecording: false, durationMillis: 0 };
  class Recording {
    setProgressUpdateInterval(interval) { calls.push(['interval', interval]); }
    setOnRecordingStatusUpdate(callback) { statusCallback = callback; }
    async prepareToRecordAsync(options) { calls.push(['prepare', options]); state.canRecord = true; if (preparePause) await preparePause; return { ...state }; }
    async startAsync() { calls.push(['start']); if (startPause) await startPause; state.isRecording = true; return { ...state }; }
    async stopAndUnloadAsync() { calls.push(['stop']); if (stopFailure) { stopFailure = false; throw new Error('Unload failed'); } state.canRecord = false; state.isRecording = false; state.isDoneRecording = true; return { ...state }; }
    async getStatusAsync() { return { ...state }; }
    getURI() { return 'file:///cache/voice.m4a'; }
  }
  const deps = { 'expo-av': { Audio: { Recording, RecordingOptionsPresets: { HIGH_QUALITY: { ios: { extension: '.m4a' }, sampleRate: 44100 } },
    requestPermissionsAsync: async () => { calls.push(['permission']); if (permissionPause) await permissionPause; return { granted }; }, setAudioModeAsync: async mode => { calls.push(['mode', mode]); } }, InterruptionModeIOS: { DoNotMix: 1 }, InterruptionModeAndroid: { DoNotMix: 1 } },
    'expo-file-system/legacy': { deleteAsync: async uri => removed.push(uri) } };
  const module = { exports: {} }; new Function('require', 'module', 'exports', source)(name => deps[name], module, module.exports);
  const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  return { ...module.exports, calls, removed, state, statuses, scope: { isCurrent: () => current, onStatus: value => statuses.push(value) },
    cancelScope: () => { current = false; }, restoreScope: () => { current = true; }, deny: () => { granted = false; }, allow: () => { granted = true; },
    pausePrepare: () => { const wait = defer(); preparePause = wait.promise; return wait.resolve; },
    pausePermission: () => { const wait = defer(); permissionPause = wait.promise; return wait.resolve; }, pauseStart: () => { const wait = defer(); startPause = wait.promise; return wait.resolve; },
    failStop: () => { stopFailure = true; }, emit: duration => { state.durationMillis = duration * 1000; statusCallback?.({ ...state, metering: -24 }); } };
}
test('gravação usa permissão explícita, status real, start único e libera microfone antes de devolver arquivo', async () => {
  const h = harness(), recording = await h.prepareStudioVoiceoverRecording(h.scope);
  assert.equal(h.calls.some(([name]) => name === 'start'), false);
  await Promise.all([recording.start(), recording.start()]); h.emit(1.4);
  assert.deepEqual(h.statuses.at(-1), { duration: 1.4, recording: true, metering: -24 });
  const audio = await recording.finish(); assert.equal(audio.duration, 1.4); assert.equal(audio.uri, 'file:///cache/voice.m4a');
  assert.equal(h.calls.filter(([name]) => name === 'start').length, 1); assert.equal(h.calls.filter(([name]) => name === 'stop').length, 1);
  assert.equal(h.calls.at(-1)[1].allowsRecordingIOS, false); assert.deepEqual(h.removed, []);
  assert.deepEqual(await recording.finish(), audio); await recording.cancel(); assert.deepEqual(h.removed, ['file:///cache/voice.m4a']);
});
test('permissão negada não prepara nem ativa gravação e pode ser pedida novamente', async () => {
  const h = harness(); h.deny(); await assert.rejects(h.prepareStudioVoiceoverRecording(h.scope), /Permita/);
  assert.equal(h.calls.some(([name]) => name === 'prepare' || name === 'mode'), false);
  h.allow(); const session = await h.prepareStudioVoiceoverRecording(h.scope); await session.cancel();
});
test('trocar de conta durante permissão não ativa áudio nem inicia gravação', async () => {
  const h = harness(), release = h.pausePermission(), prepare = h.prepareStudioVoiceoverRecording(h.scope);
  h.cancelScope(); release(); await assert.rejects(prepare, /cancelada/);
  assert.equal(h.calls.some(([name]) => name === 'mode' || name === 'prepare' || name === 'start'), false);
  h.restoreScope(); await (await h.prepareStudioVoiceoverRecording(h.scope)).cancel();
});
test('cancelar contagem descarrega recorder preparado sem nenhum start', async () => {
  const h = harness(), session = await h.prepareStudioVoiceoverRecording(h.scope); await session.cancel();
  assert.equal(h.calls.filter(([name]) => name === 'start').length, 0); assert.equal(h.state.canRecord, false);
  assert.equal(h.calls.at(-1)[1].allowsRecordingIOS, false); assert.deepEqual(h.removed, ['file:///cache/voice.m4a']);
});
test('background durante start pendente serializa cancelamento e não deixa recorder ativo', async () => {
  const h = harness(), session = await h.prepareStudioVoiceoverRecording(h.scope), release = h.pauseStart();
  const start = session.start(); await new Promise(resolve => setImmediate(resolve)); h.cancelScope(); const cancel = session.cancel(); release();
  await assert.rejects(start, /cancelada/); await cancel; assert.equal(h.state.isRecording, false); assert.equal(h.state.canRecord, false);
  assert.equal(h.calls.filter(([name]) => name === 'stop').length, 1); assert.equal(h.calls.at(-1)[1].allowsRecordingIOS, false);
});
test('falha real ao descarregar mantém lease e exige retry antes de outra gravação', async () => {
  const h = harness(), session = await h.prepareStudioVoiceoverRecording(h.scope); await session.start(); h.failStop();
  await assert.rejects(session.cancel(), /encerrar o microfone/); await assert.rejects(h.prepareStudioVoiceoverRecording(h.scope), /Aguarde/);
  await session.cancel(); assert.equal(h.state.isRecording, false); await (await h.prepareStudioVoiceoverRecording(h.scope)).cancel();
});
test('gravação curta inválida não oferece arquivo pronto e não mantém microfone ligado', async () => {
  const h = harness(), session = await h.prepareStudioVoiceoverRecording(h.scope); await session.start();
  await assert.rejects(session.finish(), /ao menos/); assert.equal(h.state.canRecord, false); assert.equal(h.calls.at(-1)[1].allowsRecordingIOS, false);
  assert.deepEqual(h.removed, ['file:///cache/voice.m4a']);
});

test('status recebido após perder autorização descarrega recorder sem publicar duração tardia', async () => {
  const h = harness(), session = await h.prepareStudioVoiceoverRecording(h.scope); await session.start(); h.cancelScope(); h.emit(.7);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.state.isRecording, false); assert.equal(h.state.canRecord, false); assert.deepEqual(h.statuses, []);
  await session.cancel(); h.restoreScope(); await (await h.prepareStudioVoiceoverRecording(h.scope)).cancel();
});

test('preparação sem sessão retornada retoma unload pendente antes de conceder outro microfone', async () => {
  const h = harness(), release = h.pausePrepare(), prepare = h.prepareStudioVoiceoverRecording(h.scope);
  await new Promise(resolve => setImmediate(resolve)); h.cancelScope(); h.failStop(); release();
  await assert.rejects(prepare, /encerrar o microfone/); assert.equal(h.state.canRecord, true);
  h.restoreScope(); const second = await h.prepareStudioVoiceoverRecording(h.scope);
  assert.equal(h.calls.filter(([name]) => name === 'stop').length, 2, 'cleanup antigo conclui antes do novo prepare');
  assert.equal(h.calls.filter(([name]) => name === 'prepare').length, 2); await second.cancel(); assert.equal(h.state.canRecord, false);
});
