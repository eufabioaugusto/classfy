import { AccessToken, TokenVerifier } from 'npm:livekit-server-sdk@2.19.1';
import { cameraConnectionAccess } from './index.ts';
import { CameraError } from './protocol.ts';

function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
const session = {
  id: '10000000-0000-4000-8000-000000000001', controllerId: '10000000-0000-4000-8000-000000000002',
  deviceId: '10000000-0000-4000-8000-000000000003', status: 'ready',
};
async function claims(role: string) {
  const { identity, grant } = cameraConnectionAccess(session, role);
  const key = 'camera-grant-test-key', secret = 'camera-grant-test-secret-only-fictitious';
  const token = new AccessToken(key, secret, { identity, ttl: '5m' });
  token.addGrant(grant);
  return new TokenVerifier(key, secret).verify(await token.toJwt());
}
function noAdministrativeGrants(video: Record<string, unknown>) {
  for (const permission of ['roomAdmin', 'roomCreate', 'roomList', 'roomRecord', 'ingressAdmin', 'canUpdateOwnMetadata', 'canManageAgentSession'])
    assert(video[permission] !== true, `unexpected ${permission}`);
}

Deno.test('controller JWT can send private camera data while publishing no media', async () => {
  const decoded = await claims('controller'), video = decoded.video!;
  assert(decoded.sub === `studio-controller-${session.id}-${session.controllerId}`);
  assert(video.roomJoin === true && video.room === `classfy-studio-camera-${session.id}`);
  assert(video.canPublishData === true && video.canPublish === false && video.canSubscribe === true);
  assert(Array.isArray(video.canPublishSources) && video.canPublishSources.length === 0);
  assert(Number(decoded.exp) - Number(decoded.nbf) <= 300);
  noAdministrativeGrants(video as Record<string, unknown>);
});
Deno.test('device JWT can ACK private camera data and publish only its camera', async () => {
  const decoded = await claims('device'), video = decoded.video!;
  assert(decoded.sub === `studio-device-${session.id}-${session.deviceId}`);
  assert(video.roomJoin === true && video.room === `classfy-studio-camera-${session.id}`);
  assert(video.canPublishData === true && video.canPublish === true && video.canSubscribe === false);
  assert(JSON.stringify(video.canPublishSources) === JSON.stringify(['camera']));
  noAdministrativeGrants(video as Record<string, unknown>);
});
Deno.test('private camera grants reject unknown roles, unbound sessions and arbitrary room identifiers', () => {
  for (const [value, role] of [
    [session, 'admin'], [session, ''], [{ ...session, status: 'closed' }, 'controller'],
    [{ ...session, deviceId: null }, 'controller'], [{ ...session, controllerId: null }, 'device'],
    [{ ...session, id: 'another-room' }, 'controller'], [{ ...session, deviceId: 'untrusted-participant' }, 'device'],
  ] as const) {
    let rejected = false;
    try { cameraConnectionAccess(value, role); } catch (error) { assert(error instanceof CameraError); rejected = true; }
    assert(rejected, 'accepted invalid camera room access');
  }
});
Deno.test('camera data grants stay bound to the exact session room and role identity', () => {
  const other = { ...session, id: '10000000-0000-4000-8000-000000000004' };
  for (const role of ['controller', 'device']) {
    const original = cameraConnectionAccess(session, role), next = cameraConnectionAccess(other, role);
    assert(original.grant.room !== next.grant.room && original.identity !== next.identity);
    assert(!original.identity.includes(other.id) && !next.identity.includes(session.id));
  }
});
