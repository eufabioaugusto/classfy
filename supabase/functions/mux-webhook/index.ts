import { corsHeaders, json, serviceClient } from '../_shared/video/http.ts';
import { normalizeMuxEvent, verifyMuxWebhook } from '../_shared/video/webhooks.ts';
import { getMuxLiveAsset } from '../_shared/video/live-mux.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const rawBody = await req.text();
  try {
    const secret = Deno.env.get('MUX_WEBHOOK_SECRET');
    if (!secret || !await verifyMuxWebhook(rawBody, req.headers.get('mux-signature'), secret)) return json({ error: 'Invalid signature' }, 401);
    const payload = JSON.parse(rawBody);
    if (payload.type === 'video.live_stream.active' || payload.type === 'video.live_stream.idle' || payload.type === 'video.asset.live_stream_completed') {
      const client = serviceClient();
      const data = payload.data ?? {};
      const streamId = payload.type.startsWith('video.live_stream.') ? data.id : data.live_stream_id;
      if (!streamId) return json({ received: true, unmatched: true });
      const { data: live, error: liveError } = await client.from('lives').select('id, status, mux_recording_asset_id')
        .eq('mux_live_stream_id', streamId).maybeSingle();
      if (liveError) throw liveError;
      if (!live) return json({ received: true, unmatched: true });
      if (live.status === 'cancelled') return json({ received: true, discarded: true });
      if (payload.type === 'video.live_stream.active' && live.status === 'waiting') {
        const { error } = await client.from('lives').update({ status: 'live', started_at: new Date().toISOString(),
          mux_recording_asset_id: data.active_asset_id ?? null }).eq('id', live.id);
        if (error) throw error;
      } else if (payload.type === 'video.live_stream.idle' && ['waiting', 'live'].includes(live.status)) {
        const { error } = await client.from('lives').update({ status: 'ended', ended_at: new Date().toISOString(),
          mux_recording_asset_id: data.active_asset_id ?? live.mux_recording_asset_id }).eq('id', live.id);
        if (error) throw error;
      } else if (payload.type === 'video.asset.live_stream_completed') {
        const asset = await getMuxLiveAsset(data.id);
        const playbackId = asset?.playback_ids?.find((id: { policy: string; id: string }) => id.policy === 'signed')?.id;
        if (!playbackId) throw new Error('Completed live recording has no signed playback ID');
        const { error } = await client.from('lives').update({
          status: 'ended', ended_at: new Date().toISOString(), recording_ready_at: new Date().toISOString(),
          mux_recording_asset_id: data.id, mux_recording_playback_id: playbackId,
        }).eq('id', live.id);
        if (error) throw error;
      }
      return json({ received: true, liveId: live.id });
    }
    const event = normalizeMuxEvent(payload);
    if (!event) return json({ received: true, ignored: true });
    const client = serviceClient();
    let query = client
      .from('media_provider_assets')
      .select('*, media_assets!media_provider_assets_media_asset_id_fkey(*)')
      .eq('provider', 'mux');
    query = event.providerUploadId ? query.eq('provider_upload_id', event.providerUploadId) : query.eq('provider_asset_id', event.providerAssetId!);
    const { data: binding, error } = await query.maybeSingle();
    if (error) throw error;
    if (!binding) return json({ received: true, unmatched: true });
    if (binding.last_event_id === event.id) return json({ received: true, duplicate: true });
    if (binding.last_event_at && new Date(binding.last_event_at) > new Date(event.occurredAt)) return json({ received: true, stale: true });

    const metadata = { ...(binding.provider_metadata ?? {}), ...event.metadata };
    const { error: bindingError } = await client.from('media_provider_assets').update({
      provider_asset_id: event.providerAssetId ?? binding.provider_asset_id,
      provider_playback_id: event.providerPlaybackId ?? binding.provider_playback_id,
      status: event.status, provider_metadata: metadata, last_event_id: event.id,
      last_event_at: event.occurredAt, updated_at: new Date().toISOString(),
    }).eq('id', binding.id);
    if (bindingError) throw bindingError;
    const assetUpdate = {
      status: event.status, duration_seconds: event.durationSeconds ?? binding.media_assets.duration_seconds,
      width: event.width ?? binding.media_assets.width, height: event.height ?? binding.media_assets.height,
      aspect_ratio: event.metadata.aspect_ratio ?? binding.media_assets.aspect_ratio, updated_at: new Date().toISOString(),
    };
    const { error: assetError } = await client.from('media_assets').update(assetUpdate).eq('id', binding.media_asset_id);
    if (assetError) throw assetError;
    if (binding.media_assets.content_id && event.status === 'ready') {
      await client.from('contents').update({ duration_seconds: event.durationSeconds ?? undefined }).eq('id', binding.media_assets.content_id);
    }
    return json({ received: true, mediaAssetId: binding.media_asset_id, status: event.status });
  } catch (error) {
    console.error('[mux-webhook]', error);
    return json({ error: error instanceof Error ? error.message : 'Webhook processing failed' }, 400);
  }
});
