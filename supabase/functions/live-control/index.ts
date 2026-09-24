import { AccessToken, EncodingOptionsPreset, LiveKitAPI, StreamOutput, StreamProtocol } from 'npm:livekit-server-sdk@2.19.1';
import { corsHeaders, json, requireUser, serviceClient } from '../_shared/video/http.ts';
import { createMuxLiveStream, deleteMuxLiveAsset, deleteMuxLiveStream, disableMuxLiveStream, getMuxLiveAsset, getMuxLiveStreamStatus, listMuxLiveAssetIds } from '../_shared/video/live-mux.ts';
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

async function viewerToken(liveId: string, userId: string) {
  const { url, key, secret } = liveKitConfig();
  // A unique identity keeps two devices on the same account from disconnecting each other.
  const token = new AccessToken(key, secret, { identity: `viewer-${userId}-${crypto.randomUUID()}`, ttl: '2h' });
  token.addGrant({ roomJoin: true, room: `classfy-live-${liveId}`, canPublish: false, canSubscribe: true, canPublishData: false });
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

const diagnosticEvents = new Set([
  'page_opened', 'preview_ready', 'start_clicked', 'room_connected', 'tracks_published',
  'bridge_started', 'bridge_stalled', 'bridge_restarted', 'public_live', 'viewer_live', 'rtc_connected', 'rtc_first_frame',
  'hls_first_frame', 'fallback', 'reconnecting', 'reconnected', 'audio_blocked',
  'chat_sent', 'chat_received', 'playback_stalled', 'end_requested', 'end_confirmed', 'ended',
]);

function diagnosticNumber(value: unknown, max = 3_600_000) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(number, max) : null;
}

function diagnosticTime(value: unknown) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
}

function safeChatTiming(value: unknown) {
  const chat = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    direction: ['sent', 'received'].includes(String(chat.direction)) ? chat.direction : null,
    messageId: typeof chat.messageId === 'string' && /^[0-9a-f-]{36}$/i.test(chat.messageId) ? chat.messageId : null,
    serverCreatedAt: diagnosticTime(chat.serverCreatedAt),
    clientObservedAt: diagnosticTime(chat.clientObservedAt),
    acknowledgementMs: diagnosticNumber(chat.acknowledgementMs, 60_000),
    approximateTransitMs: diagnosticNumber(chat.approximateTransitMs, 60_000),
  };
}

function safeDiagnosticReport(input: unknown) {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const metrics = source.metrics && typeof source.metrics === 'object' ? source.metrics as Record<string, unknown> : {};
  const events = Array.isArray(source.events) ? source.events : [];
  return {
    version: 1,
    startedAt: diagnosticTime(source.startedAt),
    deviceClass: source.deviceClass === 'mobile' ? 'mobile' : 'desktop',
    networkHint: ['slow-2g', '2g', '3g', '4g'].includes(String(source.networkHint)) ? source.networkHint : 'unknown',
    clockOffsetMs: source.clockOffsetMs !== null && source.clockOffsetMs !== undefined && Number.isFinite(Number(source.clockOffsetMs))
      ? Math.max(-60_000, Math.min(60_000, Number(source.clockOffsetMs))) : null,
    clockProbeMs: diagnosticNumber(source.clockProbeMs, 30_000),
    quality: ['excellent', 'good', 'poor', 'lost', 'unknown'].includes(String(source.quality)) ? source.quality : 'unknown',
    fallbackReason: ['token', 'connect', 'timeout', 'host_left', 'room_left', 'hls_error', 'none'].includes(String(source.fallbackReason)) ? source.fallbackReason : 'none',
    metrics: Object.fromEntries(['firstFrameMs', 'roomConnectMs', 'bitrateKbps', 'packetsLost', 'jitterMs', 'rttMs', 'framesPerSecond', 'bufferSeconds', 'playbackLatencySeconds', 'droppedFrames', 'reconnects', 'stalls', 'audioBitrateKbps', 'audioPacketsLost', 'audioJitterMs'].map(key => [key, diagnosticNumber(metrics[key])])),
    lastChatSent: safeChatTiming(source.lastChatSent),
    lastChatReceived: safeChatTiming(source.lastChatReceived),
    events: events.slice(-40).flatMap((event: unknown) => {
      if (!event || typeof event !== 'object') return [];
      const item = event as Record<string, unknown>;
      const at = diagnosticTime(item.at);
      return at && diagnosticEvents.has(String(item.type)) ? [{ at, type: item.type }] : [];
    }),
  };
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
        .eq('creator_id', user.id).in('status', ['waiting', 'live'])
        .not('mux_live_stream_id', 'is', null).limit(1);
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

    if (action === 'clock') return json({ serverAt: new Date().toISOString() });

    if (action === 'diagnostics') {
      const sessionId = String(body.sessionId ?? '');
      const role = body.role === 'host' ? 'host' : body.role === 'viewer' ? 'viewer' : null;
      const route = ['waiting', 'webrtc', 'hls', 'replay', 'ended'].includes(String(body.route)) ? body.route : null;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId) || !role || !route || (role === 'host' && !owner)) {
        return json({ error: 'Invalid diagnostic session' }, 400);
      }
      const { error } = await client.from('live_diagnostic_sessions').upsert({
        session_id: sessionId, user_id: user.id, live_id: liveId, role, route,
        report: safeDiagnosticReport(body.report), updated_at: new Date().toISOString(),
      }, { onConflict: 'session_id,user_id' });
      if (error) throw error;
      return json({ saved: true });
    }

    if (action === 'playback') {
      if (!owner && live.status !== 'live' && !live.replay_published_at) return json({ error: 'Live not available' }, 403);
      const playbackId = live.status === 'live' ? live.mux_live_playback_id : live.mux_recording_playback_id;
      if (!playbackId) return json({ error: 'Video is not ready' }, 409);
      const source = await new MuxVideoProvider().getPlaybackSource({ provider_playback_id: playbackId }, { duration_seconds: 3600 });
      return json(source);
    }

    if (action === 'viewer-connect') {
      if (live.status !== 'live' || !live.livekit_egress_id) return json({ error: 'Live not available' }, 409);
      return json(await viewerToken(liveId, user.id));
    }

    if (!owner) return json({ error: 'Forbidden' }, 403);
    if (action === 'connect') {
      if (!['waiting', 'live'].includes(live.status)) return json({ error: 'Live is closed' }, 409);
      return json(await creatorToken(liveId, user.id));
    }
    if (action === 'sync') {
      if (live.status !== 'waiting' || !live.livekit_egress_id || !live.mux_live_stream_id) return json({ status: live.status });
      stage = 'check Mux live status';
      const mux = await getMuxLiveStreamStatus(live.mux_live_stream_id);
      if (mux.status === 'active') {
        const { error } = await client.from('lives').update({
          status: 'live', started_at: new Date().toISOString(), mux_recording_asset_id: mux.activeAssetId,
        }).eq('id', liveId).eq('status', 'waiting');
        if (error) throw error;
        return json({ status: 'live' });
      }
      return json({ status: 'waiting' });
    }
    if (action === 'start' || action === 'restart') {
      if (live.status !== 'waiting' || (action === 'start' && live.livekit_egress_id)) return json({ error: 'Live has already started' }, 409);
      if (action === 'restart' && live.livekit_egress_id) {
        stage = 'restart stalled bridge';
        const mux = await getMuxLiveStreamStatus(live.mux_live_stream_id);
        if (mux.status === 'active') return json({ error: 'Mux is already active' }, 409);
        const { api } = liveKitConfig();
        await api.egress.stopEgress(live.livekit_egress_id).catch(() => undefined);
        const { data: released, error: releaseError } = await client.from('lives')
          .update({ livekit_egress_id: null }).eq('id', liveId).eq('status', 'waiting')
          .eq('livekit_egress_id', live.livekit_egress_id).select('id');
        if (releaseError) throw releaseError;
        if (!released?.length) return json({ error: 'Live state changed; try again' }, 409);
      }
      const { data: secretRow, error: secretError } = await client.from('live_stream_secrets')
        .select('mux_stream_key').eq('live_id', liveId).single();
      if (secretError || !secretRow) return json({ error: 'Stream is not configured' }, 409);
      const { api } = liveKitConfig();
      const output = new StreamOutput({
        protocol: StreamProtocol.RTMP,
        urls: [`rtmps://global-live.mux.com:443/app/${secretRow.mux_stream_key}`],
      });
      const egress = await api.egress.startRoomCompositeEgress(`classfy-live-${liveId}`, { stream: output }, {
        layout: 'single-speaker', encodingOptions: EncodingOptionsPreset.H264_720P_30,
      });
      const { data: claimed, error: updateError } = await client.from('lives')
        .update({ livekit_egress_id: egress.egressId }).eq('id', liveId)
        .is('livekit_egress_id', null).in('status', ['waiting', 'live']).select('id');
      if (updateError || !claimed?.length) {
        await api.egress.stopEgress(egress.egressId).catch(() => undefined);
        if (updateError) throw updateError;
        return json({ error: 'Live has already started' }, 409);
      }
      return json({ waitingForMux: true, egressId: egress.egressId });
    }
    if (action === 'end') {
      if (!['waiting', 'live'].includes(live.status)) return json({ error: 'Live is already closed' }, 409);
      if (!live.mux_live_stream_id) return json({ error: 'Stream is not configured' }, 409);
      // Let the bridge flush its final audio/video packets before closing ingest.
      if (live.livekit_egress_id) {
        try {
          await liveKitConfig().api.egress.stopEgress(live.livekit_egress_id);
        } catch {
          // The bridge may already have stopped after a disconnect or timeout.
          console.warn('[live-control] egress was already unavailable during end');
        }
      }
      await disableMuxLiveStream(live.mux_live_stream_id);
      // Publish the end state before the host disconnects, so real-time viewers
      // can play the final frames and backup viewers can drain their HLS buffer.
      const { error } = await client.from('lives').update({
        status: live.status === 'waiting' ? 'cancelled' : 'ended', ended_at: new Date().toISOString(),
      }).eq('id', liveId).in('status', ['waiting', 'live']);
      if (error) throw error;
      return json({ ending: true });
    }
    if (action === 'discard') {
      if (!owner) return json({ error: 'Forbidden' }, 403);
      if (live.replay_content_id || live.replay_published_at) return json({ error: 'Published or submitted replays cannot be discarded here' }, 409);
      if (!['waiting', 'ended', 'cancelled'].includes(live.status) || (live.status === 'waiting' && live.livekit_egress_id)) {
        return json({ error: 'End the live before discarding it' }, 409);
      }
      const { count: giftCount, error: giftError } = await client.from('live_gift_transactions')
        .select('id', { count: 'exact', head: true }).eq('live_id', liveId);
      if (giftError) throw giftError;
      if (giftCount) return json({ error: 'Live with gift transactions cannot be discarded' }, 409);

      stage = 'find live recordings';
      const assetIds = new Set<string>(live.mux_recording_asset_id ? [live.mux_recording_asset_id] : []);
      if (live.mux_live_stream_id) {
        for (const assetId of await listMuxLiveAssetIds(live.mux_live_stream_id)) assetIds.add(assetId);
      }
      if (live.started_at && live.status === 'ended' && !assetIds.size) {
        return json({ error: 'Recording is still being prepared' }, 409);
      }
      // Block publication and late provider webhooks before deleting resources.
      const { error: stateError } = await client.from('lives').update({ status: 'cancelled' })
        .eq('id', liveId).in('status', ['waiting', 'ended', 'cancelled']);
      if (stateError) throw stateError;
      stage = 'discard recording';
      for (const assetId of assetIds) await deleteMuxLiveAsset(assetId);
      stage = 'discard live stream';
      if (live.mux_live_stream_id) await deleteMuxLiveStream(live.mux_live_stream_id);
      stage = 'discard live room';
      if (live.mux_live_stream_id) {
        try {
          await liveKitConfig().api.room.deleteRoom(`classfy-live-${liveId}`);
        } catch (error) {
          const code = (error as { code?: number | string }).code;
          if (code !== 5 && code !== 404 && !/not.?found|does not exist/i.test(error instanceof Error ? error.message : '')) throw error;
        }
      }
      stage = 'discard live record';
      const { error: deleteError } = await client.from('lives').delete().eq('id', liveId);
      if (deleteError) throw deleteError;
      return json({ discarded: true });
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
