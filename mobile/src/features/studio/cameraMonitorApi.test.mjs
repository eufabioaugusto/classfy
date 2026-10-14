import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './cameraMonitorModel.ts';
const id = '11111111-1111-4111-8111-111111111111', device = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();
const initial = { id, ownerId: 'owner', deviceId: device, kind: 'aula', title: 'Minha aula', status: 'active', state: null,
  createdAt: now, expiresAt: new Date(Date.now() + 90_000).toISOString(), deviceSeenAt: now, closedAt: null };
function apiHarness(patch = {}, connectionPatch = {}) {
  const calls = [];
  const code = ts.transpileModule(readFileSync(new URL('./cameraMonitorApi.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const deps = { './cameraMonitorModel': model, './remoteCameraApi': { requestRemoteCameraResponse: async (...args) => {
    calls.push(args); return { monitor: { ...initial, ...patch }, serverAt: now,
      connection: { url: 'wss://test.invalid', token: 'test-only', identity: `studio-monitor-device-${id}-${device}`, ...connectionPatch } };
  } } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => deps[name], module, module.exports);
  return { api: module.exports, calls };
}
test('DTO inicial null, mesma conta/dispositivo e identidade publisher são confirmados', async () => {
  const h = apiHarness(), scope = { isCurrent: () => true };
  const response = await h.api.requestStudioCameraMonitor('owner', 'monitor-connect', { sessionId: id, role: 'device', clientId: device }, scope);
  assert.equal(response.monitor.state, null);
  assert.equal(h.calls[0][0], 'owner'); assert.equal(h.calls[0][1], 'monitor-connect'); assert.equal(h.calls[0][3], scope);
});
test('resposta de outra conta/id/device/estado ou token viewer não chega ao publisher', async () => {
  for (const patch of [{ ownerId: 'another' }, { id: device }, { deviceId: id }, { state: {} }, { state: { recording: false, elapsedSeconds: -1 } }, { expiresAt: now }, { status: 'closed' }]) {
    const h = apiHarness(patch);
    await assert.rejects(h.api.requestStudioCameraMonitor('owner', 'monitor-connect', { sessionId: id, role: 'device', clientId: device }));
  }
  for (const patch of [{ identity: `studio-monitor-viewer-${id}-${device}` }, { url: 'https://test.invalid' }, { url: 'wss://user@test.invalid' }, { token: '' }]) {
    const h = apiHarness({}, patch);
    await assert.rejects(h.api.requestStudioCameraMonitor('owner', 'monitor-connect', { sessionId: id, role: 'device', clientId: device }));
  }
});
test('close aceita sessão encerrada e o monitor elimina dados privados de erros RTC', async () => {
  const h = apiHarness({ status: 'closed', expiresAt: now, closedAt: now });
  assert.equal((await h.api.requestStudioCameraMonitor('owner', 'monitor-close', { sessionId: id, deviceId: device })).monitor.status, 'closed');
  const message = model.studioMonitorErrorMessage(Error('Falha wss://secret.invalid/private Bearer test-token eyJfoo.abc.def'));
  assert.equal(message.includes('secret.invalid'), false); assert.equal(message.includes('test-token'), false); assert.equal(message.includes('eyJfoo'), false);
});
