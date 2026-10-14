import { AccessToken, TokenVerifier } from 'npm:livekit-server-sdk@2.19.1';
import { monitorConnectionAccess } from './index.ts';
import { CameraError, monitorState, validateRequest } from './protocol.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function rejects(fn: () => unknown) { try { fn(); } catch (error) { assert(error instanceof CameraError); return; } throw new Error('accepted invalid monitor'); }
const id = '10000000-0000-4000-8000-000000000001', device = '20000000-0000-4000-8000-000000000001';
const viewer = '30000000-0000-4000-8000-000000000001';
const monitor = { id, deviceId: device, status: 'active', expiresAt: new Date(Date.now() + 90000).toISOString() };
Deno.test('monitor requests support same-account discovery and mobile-only lifecycle', () => {
  assert(JSON.stringify(validateRequest({ action: 'monitor-discover', ownerId: 'untrusted' }).params) === '{}');
  const create = validateRequest({ action: 'monitor-create', sessionId: id, deviceId: device, kind: 'short', title: 'Minha aula', ownerId: 'untrusted' });
  assert(create.params.sessionId === id && create.params.deviceId === device && create.params.ownerId === undefined);
  assert(validateRequest({ action: 'monitor-close', sessionId: id, deviceId: device }).params.deviceId === device);
  for (const patch of [{ kind: 'live' }, { kind: 'podcast' }, { title: 'x'.repeat(151) }, { sessionId: 'bad' }, { deviceId: null }])
    rejects(() => validateRequest({ action: 'monitor-create', sessionId: id, deviceId: device, kind: 'aula', ...patch }));
  for (const action of ['monitor-command', 'monitor-start', 'monitor-stop', 'monitor-configure', 'monitor-upload-start', 'monitor-download'])
    rejects(() => validateRequest({ action, sessionId: id }));
});
Deno.test('monitor state is visual-only, bounded, and writable only by device heartbeat', () => {
  const state = { recording: true, elapsedSeconds: 12.4, width: 3840, height: 2160, fps: 30, cameraFacing: 'back' };
  assert(JSON.stringify(monitorState(state)) === JSON.stringify(state));
  assert(validateRequest({ action: 'monitor-heartbeat', sessionId: id, role: 'device', clientId: device }).params.state === undefined);
  for (const patch of [{ recording: 'true' }, { elapsedSeconds: -1 }, { width: 0 }, { height: 1.5 }, { fps: NaN }, { cameraFacing: 'external' }, { token: 'secret' }, { configuration: {} }, { uri: 'file:///original.mov' }])
    rejects(() => monitorState({ ...state, ...patch }));
  rejects(() => validateRequest({ action: 'monitor-heartbeat', sessionId: id, role: 'viewer', clientId: viewer, state }));
  rejects(() => validateRequest({ action: 'monitor-connect', sessionId: id, role: 'device', clientId: device, state }));
  rejects(() => validateRequest({ action: 'monitor-connect', sessionId: id, role: 'controller', clientId: viewer }));
});
Deno.test('monitor device publishes CAMERA only and viewer subscribes without any data/control grant', async () => {
  for (const [role, client] of [['device', device], ['viewer', viewer]]) {
    const { identity, grant } = monitorConnectionAccess(monitor, role, client);
    const key = 'monitor-test-key', secret = 'monitor-test-secret-only-fictitious';
    const token = new AccessToken(key, secret, { identity, ttl: 60 }); token.addGrant(grant);
    const decoded = await new TokenVerifier(key, secret).verify(await token.toJwt()); const video = decoded.video!;
    assert(decoded.sub === `studio-monitor-${role}-${id}-${client}`);
    assert(video.room === `classfy-studio-monitor-${id}` && video.canPublishData === false);
    assert(video.canPublish === (role === 'device') && video.canSubscribe === (role === 'viewer'));
    assert(JSON.stringify(video.canPublishSources) === JSON.stringify(role === 'device' ? ['camera'] : []));
    for (const admin of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'ingressAdmin', 'canUpdateOwnMetadata', 'canManageAgentSession'])
      assert((video as Record<string, unknown>)[admin] !== true, `unexpected ${admin}`);
    assert(Number(decoded.exp) - Number(decoded.nbf) <= 60);
  }
});
Deno.test('monitor grants reject expired, closed, unbound and controller access', () => {
  rejects(() => monitorConnectionAccess(monitor, 'controller', viewer));
  rejects(() => monitorConnectionAccess(monitor, 'device', viewer));
  rejects(() => monitorConnectionAccess({ ...monitor, status: 'closed' }, 'viewer', viewer));
  rejects(() => monitorConnectionAccess({ ...monitor, expiresAt: new Date(Date.now() - 1).toISOString() }, 'viewer', viewer));
  rejects(() => monitorConnectionAccess({ ...monitor, id: 'unrelated-room' }, 'viewer', viewer));
  rejects(() => monitorConnectionAccess({ ...monitor, deviceId: null }, 'viewer', viewer));
});
