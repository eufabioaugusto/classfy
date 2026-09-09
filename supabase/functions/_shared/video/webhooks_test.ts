import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { normalizeMuxEvent, verifyMuxWebhook } from './webhooks.ts';

Deno.test('normalizes a ready Mux event without leaking Mux event names to the domain', () => {
  const event = normalizeMuxEvent({
    id: 'evt_1', type: 'video.asset.ready', created_at: '2026-09-09T12:00:00Z',
    data: { id: 'asset_1', duration: 42, aspect_ratio: '16:9', playback_ids: [{ id: 'playback_1', policy: 'signed' }] },
  });
  assertEquals(event?.type, 'media.ready');
  assertEquals(event?.status, 'ready');
  assertEquals(event?.providerAssetId, 'asset_1');
  assertEquals(event?.providerPlaybackId, 'playback_1');
});

Deno.test('ignores unsupported Mux events', () => {
  assertEquals(normalizeMuxEvent({ id: 'evt_2', type: 'video.asset.static_rendition.ready', data: {} }), null);
});

Deno.test('verifies a valid Mux webhook signature', async () => {
  const body = '{"id":"evt_1"}';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = 'test-secret';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  assertEquals(await verifyMuxWebhook(body, `t=${timestamp},v1=${signature}`, secret), true);
  assertEquals(await verifyMuxWebhook(body, `t=${timestamp},v1=invalid`, secret), false);
});
