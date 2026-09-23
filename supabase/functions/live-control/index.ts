import { AccessToken, EncodingOptionsPreset, LiveKitAPI, StreamOutput, StreamProtocol } from 'npm:livekit-server-sdk@2.19.1';
import { corsHeaders, json, requireUser, serviceClient } from '../_shared/video/http.ts';
import { createMuxLiveStream, deleteMuxLiveStream, disableMuxLiveStream, getMuxLiveAsset } from '../_shared/video/live-mux.ts';
import { MuxVideoProvider } from '../_shared/video/mux.ts';

function liveKitConfig() {
  const url = Deno.env.get('LIVEKIT_URL');
  const key = Deno.env.get('LIVEKIT_API_KEY');
  const secret = Deno.env.get('LIVEKIT_API_SECRET');
  if (!url || !key || !secret) throw new Error('LiveKit is not configured');
  const host = url.replace(/^ws/, 'http').replace(/\/$/, '');
  return { url, key, secret, api: new LiveKitAPI({ host, apiKey: key, secret }) };
}

async function creatorToken(liveId: string, userId: string) {
  const { url, key, secret } = liveKitConfig();
  const token = new AccessToken(key, secret, { identity: userId, ttl: '2h' });
  token.addGrant({ roomJoin: true, room: `classfy-live-${liveId}`, canPublish: true, canSubscribe: false, canPublishData: false });
  return { url, token: await token.toJwt() };
}

async function approvedCreator(client: ReturnType<typeof serviceClient>, userId: string) {
  const [{ data: roles }, { data: profile }] = await Promise.all([
    client.from('user_roles').select('role').eq('user_id', userId).in('role', ['creator', 'admin']),
    client.from('profiles').select('creator_status').eq('id', userId).single(),
  ]);
  return roles?.some(item => item.role === 'admin') ||
    (roles?.some(item => item.role === 'creator') && profile?.creator_status === 'approved');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  let stage = 'authenticate';
  try {
    const { user, client } = await requireUser(req);
    const body = await req.json();
    const action = String(body.action || '');
    const liveId = typeof body.liveId === 'string' ? body.liveId : '';

    if (action === 'create') {
      stage = 'authorize creator';
      if (!await approvedCreator(client, user.id)) return json({ error: 'Approved creator access required' }, 403);
      const title = String(body.title || '').trim().slice(0, 150);
      const description = String(body.description || '').trim().slice(0, 1000);
      if (title.length < 3) return json({ error: 'Title is required' }, 400);
      stage = 'configure LiveKit';
      liveKitConfig(); // Fail before allocating a Mux stream.
      stage = 'check open lives';
      const { data: openLives, error: openError } = await client.from('lives').select('id')
        .eq('creator_id', user.id).in('status', ['waiting', 'live']).limit(1);
      if (openError) throw openError;
      if (openLives?.length) return json({ error: 'Finish your open live first' }, 409);
      const newId = crypto.randomUUID();
      stage = 'create Mux stream';
      const mux = await createMuxLiveStream(title, newId);
      try {
        stage = 'save live';
        const { error: liveError } = await client.from('lives').insert({
          id: newId, creator_id: user.id, title, description: description || null,
          status: 'waiting', visibility: 'free', gifts_enabled: false,
          mux_live_stream_id: mux.id, mux_live_playback_id: mux.playbackId,
        });
        if (liveError) throw liveError;
        stage = 'save stream key';
        const { error: secretError } = await client.from('live_stream_secrets').insert({
          live_id: newId, mux_stream_key: mux.streamKey,
        });
        if (secretError) throw secretError;
      } catch (error) {
        await deleteMuxLiveStream(mux.id).catch(() => undefined);
        await client.from('lives').delete().eq('id', newId);
        throw error;
      }
      stage = 'create creator token';
      return json({ liveId: newId, ...(await creatorToken(newId, user.id)) });
    }

    if (!liveId) return json({ error: 'liveId is required' }, 400);
    const { data: live, error: liveError } = await client.from('lives').select('*').eq('id', liveId).maybeSingle();
    if (liveError) throw liveError;
    if (!live) return json({ error: 'Live not found' }, 404);
    const { data: adminRole } = await client.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
    const owner = live.creator_id === user.id || Boolean(adminRole);

    if (action === 'playback') {
      if (!owner && live.status !== 'live' && !live.replay_published_at) return json({ error: 'Live not available' }, 403);
      const playbackId = live.status === 'live' ? live.mux_live_playback_id : live.mux_recording_playback_id;
      if (!playbackId) return json({ error: 'Video is not ready' }, 409);
      const source = await new MuxVideoProvider().getPlaybackSource({ provider_playback_id: playbackId }, { duration_seconds: 3600 });
      return json(source);
    }

    if (!owner) return json({ error: 'Forbidden' }, 403);
    if (action === 'connect') {
      if (!['waiting', 'live'].includes(live.status)) return json({ error: 'Live is closed' }, 409);
      return json(await creatorToken(liveId, user.id));
    }
    if (action === 'start') {
      if (live.status !== 'waiting' || live.livekit_egress_id) return json({ error: 'Live has already started' }, 409);
      const { data: secretRow, error: secretError } = await client.from('live_stream_secrets')
        .select('mux_stream_key').eq('live_id', liveId).single();
      if (secretError || !secretRow) return json({ error: 'Stream is not configured' }, 409);
      const { api } = liveKitConfig();
      const output = new StreamOutput({
        protocol: StreamProtocol.RTMP,
        urls: [`rtmps://global-live.mux.com:443/app/${secretRow.mux_stream_key}`],
      });
      const egress = await api.egress.startRoomCompositeEgress(`classfy-live-${liveId}`, { stream: output }, {
        layout: 'speaker', encodingOptions: EncodingOptionsPreset.H264_720P_30,
      });
      const { data: claimed, error: updateError } = await client.from('lives')
        .update({ livekit_egress_id: egress.egressId }).eq('id', liveId)
        .is('livekit_egress_id', null).in('status', ['waiting', 'live']).select('id');
      if (updateError || !claimed?.length) {
        await api.egress.stopEgress(egress.egressId).catch(() => undefined);
        if (updateError) throw updateError;
        return json({ error: 'Live has already started' }, 409);
      }
      return json({ waitingForMux: true });
    }
    if (action === 'end') {
      if (!['waiting', 'live'].includes(live.status)) return json({ error: 'Live is already closed' }, 409);
      if (!live.mux_live_stream_id) return json({ error: 'Stream is not configured' }, 409);
      // Close Mux ingest first so a failed bridge stop cannot keep billing for video.
      await disableMuxLiveStream(live.mux_live_stream_id);
      if (live.livekit_egress_id) {
        try {
          await liveKitConfig().api.egress.stopEgress(live.livekit_egress_id);
        } catch {
          // The bridge may already have stopped after a disconnect or timeout.
          console.warn('[live-control] egress was already unavailable during end');
        }
      }
      if (live.status === 'waiting') {
        // No Mux active/idle webhook is guaranteed when ingest never connected.
        const { error } = await client.from('lives').update({ status: 'cancelled', ended_at: new Date().toISOString() }).eq('id', liveId);
        if (error) throw error;
      }
      return json({ ending: true });
    }
    if (action === 'publish') {
      if (live.status !== 'ended' || !live.recording_ready_at || !live.mux_recording_asset_id || !live.mux_recording_playback_id) {
        return json({ error: 'Recording is not finalized' }, 409);
      }
      if (live.replay_content_id) return json({ contentId: live.replay_content_id, alreadySubmitted: true });
      const muxAsset = await getMuxLiveAsset(live.mux_recording_asset_id);
      if (muxAsset?.status !== 'ready') return json({ error: 'Recording is not ready' }, 409);
      const { data: contentId, error: publishError } = await client.rpc('submit_live_replay', {
        p_live_id: liveId, p_duration_seconds: Math.round(Number(muxAsset.duration || 0)),
      });
      if (publishError) throw publishError;
      return json({ contentId, submittedForReview: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    // Provider exceptions can embed URLs or tokens. Do not return/log raw messages.
    const muxStatus = error instanceof Error ? /^Mux Live API returned (\d{3})$/.exec(error.message)?.[1] : undefined;
    console.error('[live-control]', stage, error instanceof Error ? error.name : 'unknown error', muxStatus ?? '');
    return json({ error: 'Live operation failed. Check provider configuration and plan.' }, 502);
  }
});
