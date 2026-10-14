import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as tracking from './StudioTeleprompterTracking.ts';

function harness({ available = true, permission = { granted: true, canAskAgain: false }, deferPermission = false, generation = 7,
  script = 'Iluminação suave melhora detalhes. Aprendemos áudio com cuidado. Iluminação suave melhora detalhes.' } = {}) {
  let options = { ownerId: 'owner', projectId: 'project', script, active: false, isFocused: true, foreground: true, resetKey: 0, generation };
  let cursor = 0, effects = [], dirty = true, result, disposed = false, providerCalls = 0, resolvePermission;
  const slots = [], listeners = new Set();
  const equal = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ||= { current: value }; },
    useState(initial) { const i = cursor++; slots[i] ||= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, next => { const value = typeof next === 'function' ? next(slots[i].value) : next; if (!Object.is(value, slots[i].value)) { slots[i].value = value; dirty = true; } }]; },
    useEffect(callback, dependencies) { const i = cursor++; if (!slots[i] || !equal(slots[i].dependencies, dependencies)) effects.push({ i, callback, dependencies }); },
  };
  const appState = { currentState: 'active', addEventListener(_, callback) { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } };
  const native = { isStudioNativeCameraSpeechAvailable: () => available, requestStudioCaptureSpeechPermissionAsync: () => {
    providerCalls++; return deferPermission ? new Promise(resolve => { resolvePermission = resolve; }) : Promise.resolve(permission);
  } };
  const dependencies = { react, 'react-native': { AppState: appState }, '../../../modules/classfy-studio-media': native, './StudioTeleprompterTracking': tracking };
  const module = { exports: {} }, code = ts.transpileModule(readFileSync(new URL('./useStudioTeleprompterSpeech.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const render = () => { cursor = 0; dirty = false; effects = []; result = module.exports.useStudioTeleprompterSpeech(options); for (const { i, callback, dependencies } of effects) { slots[i]?.cleanup?.(); slots[i] = { dependencies, cleanup: callback() }; } };
  const pump = async () => { for (let pass = 0; pass < 20; pass++) { if (dirty && !disposed) render(); await new Promise(resolve => setImmediate(resolve)); if (!dirty || disposed) return; } throw new Error('speech hook did not settle'); };
  return { pump, state: () => result, calls: () => providerCalls,
    update: values => { options = { ...options, ...values }; dirty = true; },
    emit: values => result.onSpeech({ sessionId: result.speechSessionId, generation: options.generation ?? 7, sequence: 1, segmentId: 1, type: 'result', transcript: 'iluminacao suave melhora detalhes', isFinal: true, ...values }),
    appState: value => { appState.currentState = value; for (const callback of listeners) callback(value); },
    resolvePermission: value => resolvePermission(value),
    dispose: () => { disposed = true; for (const slot of slots) slot?.cleanup?.(); },
  };
}
async function start(h) { await h.pump(); assert.equal(await h.state().requestPermission(), true); await h.pump(); h.update({ active: true }); await h.pump(); }

test('abrir câmera/leitor não pede autorização e não avança texto sem fala', async () => {
  const h = harness(); try { await h.pump(); assert.equal(h.calls(), 0); assert.equal(h.state().permission, 'undetermined'); assert.equal(h.state().speechEnabled, false); await start(h); assert.equal(h.calls(), 1); assert.equal(h.state().speechEnabled, true); assert.equal(h.state().readWordCount, 0); h.emit({ transcript: '' }); await h.pump(); assert.equal(h.state().readWordCount, 0); } finally { h.dispose(); }
});
test('resultado reconhecido pinta quantidade correta; duplicata e sequência fora de ordem não avançam', async () => {
  const h = harness(); try { await start(h); h.emit(); await h.pump(); assert.equal(h.state().readWordCount, 4); h.emit({ sequence: 1, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 4); h.emit({ sequence: 2, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 8); h.emit({ sequence: 0, segmentId: 3 }); await h.pump(); assert.equal(h.state().readWordCount, 8); } finally { h.dispose(); }
});
test('pausa e retomada conservam cursor, rejeitam evento antigo e renovam identidade dos segmentos', async () => {
  const h = harness(); try { await start(h); const oldSession = h.state().speechSessionId; h.emit(); await h.pump(); h.update({ active: false }); await h.pump(); assert.equal(h.state().speechEnabled, false); assert.equal(h.state().readWordCount, 4); h.emit({ sessionId: oldSession, sequence: 2, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 4); h.update({ active: true }); await h.pump(); assert.notEqual(h.state().speechSessionId, oldSession); h.emit({ segmentId: 1, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 8); } finally { h.dispose(); }
});
test('owner, projeto, take e roteiro invalidam eventos enfileirados e reiniciam o cursor', async () => {
  for (const values of [{ ownerId: 'other' }, { projectId: 'other-project' }, { resetKey: 1 }, { script: 'Roteiro novo descreve conceitos.' }]) {
    const h = harness(); try { await start(h); h.emit(); await h.pump(); const previous = h.state().speechSessionId; h.update(values); await h.pump(); assert.equal(h.state().readWordCount, 0); h.emit({ sessionId: previous, sequence: 99, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 0); } finally { h.dispose(); }
  }
});
test('sair do foco e background cortam o reconhecimento sem apagar leitura', async () => {
  for (const values of [{ isFocused: false }, { foreground: false }]) { const h = harness(); try { await start(h); h.emit(); await h.pump(); const old = h.state().speechSessionId; h.update(values); await h.pump(); assert.equal(h.state().speechEnabled, false); h.emit({ sessionId: old, sequence: 2, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 4); } finally { h.dispose(); } }
});
test('evento de fala enfileirado depois do background é ignorado antes do rerender da rota', async () => {
  const h = harness(); try { await start(h); h.emit(); await h.pump(); h.appState('background'); h.emit({ sequence: 2, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 4); assert.equal(h.state().speechEnabled, false); } finally { h.dispose(); }
});
test('permissão sobrevive à tela inactive do iOS sem segundo clique ou nova solicitação', async () => {
  const h = harness({ deferPermission: true }); try {
    await h.pump(); const granting = h.state().requestPermission(); await h.pump(); assert.equal(h.state().permission, 'requesting');
    h.appState('inactive'); h.update({ foreground: false }); await h.pump(); h.resolvePermission({ granted: true, canAskAgain: false }); assert.equal(await granting, true); await h.pump(); assert.equal(h.state().permission, 'granted');
    h.appState('active'); h.update({ foreground: true, active: true }); await h.pump(); assert.equal(h.state().speechEnabled, true); assert.equal(h.calls(), 1);
  } finally { h.dispose(); }
});
test('resposta de permissão após troca de conta, perda de foco ou background real não ativa outra captura', async () => {
  for (const change of ['owner', 'focus', 'background']) { const h = harness({ deferPermission: true }); try { await h.pump(); const pending = h.state().requestPermission(); await h.pump(); if (change === 'owner') h.update({ ownerId: 'other' }); if (change === 'focus') h.update({ isFocused: false }); if (change === 'background') { h.appState('background'); h.update({ foreground: false }); } await h.pump(); h.resolvePermission({ granted: true, canAskAgain: false }); assert.equal(await pending, false); await h.pump(); assert.equal(h.state().permission, 'undetermined'); assert.equal(h.state().speechEnabled, false); } finally { h.dispose(); } }
});
test('clique duplo compartilha pedido pendente sem duplicar popup; negativa é explicada sem timer oculto', async () => {
  const h = harness({ deferPermission: true }); try { await h.pump(); const first = h.state().requestPermission(), second = h.state().requestPermission(); assert.equal(first, second); assert.equal(h.calls(), 1); h.resolvePermission({ granted: false, canAskAgain: false }); assert.equal(await first, false); await h.pump(); assert.equal(h.state().permission, 'denied'); assert.equal(h.state().status, 'denied'); assert.match(h.state().message, /Ajustes/); h.update({ active: true }); await h.pump(); assert.equal(h.state().speechEnabled, false); } finally { h.dispose(); }
});
test('binário antigo e script vazio ficam indisponíveis sem solicitar outro microfone', async () => {
  const old = harness({ available: false }); try { await old.pump(); assert.equal(await old.state().requestPermission(), false); assert.equal(old.calls(), 0); assert.equal(old.state().status, 'unavailable'); } finally { old.dispose(); }
  const empty = harness(); try { await start(empty); empty.update({ script: ' ' }); await empty.pump(); assert.equal(empty.state().speechEnabled, false); assert.equal(empty.state().words.length, 0); } finally { empty.dispose(); }
});
test('troca da geração da câmera rejeita gen antiga e aceita sequência reiniciada da nova', async () => {
  const h = harness(); try { await start(h); h.emit(); await h.pump(); const old = h.state().speechSessionId; h.update({ generation: 8 }); await h.pump(); h.emit({ generation: 7, sessionId: old, sequence: 99, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 4); h.emit({ generation: 8, sequence: 1, segmentId: 1, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 8); } finally { h.dispose(); }
});
test('erro nativo corta resultados tardios; retry explícito conserva o trecho já lido', async () => {
  const h = harness(); try { await start(h); h.emit(); await h.pump(); const id = h.state().speechSessionId; h.emit({ type: 'status', status: 'error', sequence: 2 }); h.emit({ sessionId: id, sequence: 3, segmentId: 2, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().status, 'error'); assert.equal(h.state().speechEnabled, false); assert.equal(h.state().readWordCount, 4); h.update({ active: false }); await h.pump(); h.update({ active: true }); await h.pump(); assert.equal(h.state().speechEnabled, true); h.emit({ segmentId: 1, transcript: 'aprendemos áudio com cuidado' }); await h.pump(); assert.equal(h.state().readWordCount, 8); assert.equal(h.calls(), 1); } finally { h.dispose(); }
});
test('silêncio nativo aguarda voz sem desligar intent ou transformar pausa em erro', async () => {
  const h = harness(); try {
    await start(h); h.emit(); await h.pump();
    h.emit({ type: 'status', status: 'paused', code: 'awaiting_speech', sequence: 2 }); await h.pump();
    assert.equal(h.state().speechEnabled, true); assert.equal(h.state().readWordCount, 4); assert.equal(h.state().message, 'Aguardando sua voz.');
    h.emit({ type: 'status', status: 'listening', sequence: 3 });
    h.emit({ segmentId: 2, sequence: 4, transcript: 'aprendemos áudio com cuidado' }); await h.pump();
    assert.equal(h.state().readWordCount, 8); assert.equal(h.state().status, 'listening'); assert.equal(h.calls(), 1);
  } finally { h.dispose(); }
});
test('parágrafo confirmado renova somente a leitura e aceita fala não cumulativa sem depender dos tempos do serviço', async () => {
  const h = harness({ script: 'Iluminação suave melhora detalhes.\n\nAprendemos áudio com cuidado.\n\nIluminação suave melhora detalhes.' });
  try {
    await start(h);
    const firstSession = h.state().speechSessionId;
    h.emit({ isFinal: false }); await h.pump(); assert.equal(h.state().readWordCount, 4);
    const secondSession = h.state().speechSessionId;
    assert.notEqual(secondSession, firstSession); assert.equal(h.state().speechEnabled, true);
    // Apple can report only the new utterance with all timestamps zero. A
    // paragraph boundary renews the native request without resetting words.
    h.emit({ sessionId: firstSession, sequence: 99, isFinal: true, transcript: 'Iluminação suave melhora detalhes. Aprendemos áudio com cuidado.' });
    await h.pump(); assert.equal(h.state().readWordCount, 4);
    h.emit({ isFinal: false, transcript: 'Aprendemos áudio com cuidado.' });
    await h.pump(); assert.equal(h.state().readWordCount, 8);
    const thirdSession = h.state().speechSessionId;
    assert.notEqual(thirdSession, secondSession);
    h.emit({ sequence: 1, type: 'status', status: 'paused', code: 'awaiting_speech_service' });
    await h.pump();
    assert.equal(h.state().speechEnabled, true); assert.equal(h.state().speechSessionId, thirdSession);
    assert.equal(h.state().readWordCount, 8); assert.equal(h.state().message, 'Retomando leitura…');
    // A delayed final cannot color the identical phrase in paragraph three.
    h.emit({ sessionId: firstSession, sequence: 100, isFinal: true }); await h.pump(); assert.equal(h.state().readWordCount, 8);
    h.emit({ sequence: 2, type: 'status', status: 'listening' });
    h.emit({ sequence: 3, isFinal: false }); await h.pump();
    assert.equal(h.state().readWordCount, 12); assert.equal(h.state().status, 'listening');
    assert.equal(h.state().speechSessionId, thirdSession); assert.equal(h.calls(), 1);
  } finally { h.dispose(); }
});
test('silêncio e frase incompleta não renovam parágrafo; resultado com duas quebras renova uma vez sem perder palavras', async () => {
  const h = harness({ script: 'Iluminação suave melhora detalhes.\r\nAprendemos áudio com cuidado.\n\nIluminação suave melhora detalhes.' });
  try {
    await start(h); const first = h.state().speechSessionId;
    h.emit({ isFinal: false, transcript: 'Iluminação suave melhora' }); await h.pump();
    assert.equal(h.state().readWordCount, 3); assert.equal(h.state().speechSessionId, first);
    h.emit({ type: 'status', status: 'paused', code: 'awaiting_speech', sequence: 2 }); await h.pump();
    assert.equal(h.state().speechSessionId, first); assert.equal(h.state().readWordCount, 3);
    h.emit({ sequence: 3, isFinal: false, transcript: 'Iluminação suave melhora detalhes. Aprendemos áudio com cuidado.' }); await h.pump();
    assert.equal(h.state().readWordCount, 8); const third = h.state().speechSessionId; assert.notEqual(third, first);
    h.emit({ sessionId: first, sequence: 4, isFinal: true }); await h.pump(); assert.equal(h.state().readWordCount, 8);
    h.emit({ isFinal: false }); await h.pump(); assert.equal(h.state().readWordCount, 12);
    assert.equal(h.state().speechSessionId, third); assert.equal(h.calls(), 1);
  } finally { h.dispose(); }
});
test('ausência de modelo, idioma e áudio comunica causa sem pedir atualização de um binário atual', async () => {
  for (const code of ['on_device_unavailable', 'speech_locale_unavailable', 'capture_audio_unavailable']) {
    const h = harness(); try { await start(h); h.emit({ type: 'status', status: 'unavailable', code }); await h.pump(); assert.equal(h.state().status, 'unavailable'); assert.equal(h.state().speechEnabled, false); assert.doesNotMatch(h.state().message, /Atualize/); } finally { h.dispose(); }
  }
});
test('reset manual e desmontagem descartam callbacks sem tocar a gravação', async () => {
  const h = harness(); await start(h); h.emit(); await h.pump(); const old = h.state().speechSessionId; h.state().reset(); await h.pump(); assert.equal(h.state().readWordCount, 0); h.emit({ sessionId: old, sequence: 100 }); await h.pump(); assert.equal(h.state().readWordCount, 0); const listener = h.state().onSpeech; h.dispose(); listener({ sessionId: h.state().speechSessionId, generation: 7, sequence: 3, segmentId: 2, type: 'result', transcript: 'iluminação suave melhora detalhes', isFinal: true }); assert.equal(h.calls(), 1);
});
