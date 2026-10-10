import test from 'node:test';
import assert from 'node:assert/strict';
import { compileLive, liveFixture, messageFixture, plain } from './liveTestHarness.mjs';
const model = compileLive('./model.ts');

test('live record exposes provider identifiers but never credentials from server rows', () => {
  const live = model.readLiveRecord(liveFixture({ stream_key: 'fixture-private', recording_playback_id: 'private-playback', token: 'private-room', viewer_count: -4, peak_viewers: '12' }));
  assert.equal(live.viewer_count, 0); assert.equal(live.peak_viewers, 12);
  for (const field of ['stream_key', 'token', 'recording_playback_id']) assert.equal(field in live, false);
  assert.throws(() => model.readLiveRecord({ ...liveFixture(), status: 'invented' }), /live inválida/);
});
test('creation validation trims web-compatible metadata and rejects remote or oversized input before I/O', () => {
  assert.deepEqual(plain(model.validateCreateLiveInput({ title: ' Aula ', description: ' Conteúdo ', coverUri: 'file:///cover.jpg' })), { title: 'Aula', description: 'Conteúdo', coverUri: 'file:///cover.jpg' });
  assert.throws(() => model.validateCreateLiveInput({ title: 'ab', coverUri: 'file:///cover.jpg' }), /título/);
  assert.throws(() => model.validateCreateLiveInput({ title: 'Aula', description: 'x'.repeat(1001), coverUri: 'file:///cover.jpg' }), /descrição/);
  assert.throws(() => model.validateCreateLiveInput({ title: 'Aula', coverUri: 'https://remote.test/photo' }), /aparelho/);
});
test('covers crop centered in landscape or portrait and remain within original pixel bounds', () => {
  for (const [width, height] of [[1200,1600], [3200,1200], [1920,1080], [319,181]]) {
    const crop = model.liveCoverCrop(width,height);
    assert.ok(crop.originX >= 0 && crop.originY >= 0);
    assert.ok(crop.originX + crop.width <= width && crop.originY + crop.height <= height);
    assert.ok(Math.abs(crop.width / crop.height - 16/9) < 0.02);
  }
  assert.throws(() => model.liveCoverCrop(0,100), /imagem/);
});
test('replay/discard states preserve server moderation and active egress requirements', () => {
  const ready = liveFixture({ status: 'ended', recording_ready_at: 'ready' });
  assert.equal(model.canSubmitLiveReplay(ready), true);
  assert.equal(model.canDiscardStudioLive(ready), true);
  assert.equal(model.canSubmitLiveReplay({ ...ready, replay_content_id: 'content' }), false);
  assert.equal(model.canDiscardStudioLive({ ...ready, replay_content_id: 'content' }), false);
  assert.equal(model.canDiscardStudioLive(liveFixture({ livekit_egress_id: 'active' })), false);
  assert.equal(model.canDiscardStudioLive(liveFixture()), true);
  assert.equal(model.liveChatCapabilities.pin, false);
});
test('joined message profiles normalize PostgREST relation arrays; scope cancels by owner/focus or AbortSignal', () => {
  assert.deepEqual(plain(model.readLiveMessage(messageFixture({ user: [{ display_name: 'Nome', avatar_url: null }] })).user), { display_name: 'Nome', avatar_url: null });
  assert.throws(() => model.assertLiveScope({ isCurrent: () => false }), error => model.isLiveCancellation(error));
  const controller = new AbortController(); controller.abort();
  assert.throws(() => model.assertLiveScope({ signal: controller.signal }), error => model.isLiveCancellation(error));
});
