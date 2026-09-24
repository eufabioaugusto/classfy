const apiBase = 'https://api.mux.com/video/v1';

function muxAuthorization() {
  const id = Deno.env.get('MUX_TOKEN_ID');
  const secret = Deno.env.get('MUX_TOKEN_SECRET');
  if (!id || !secret) throw new Error('Mux credentials are not configured');
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function muxLiveRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { Authorization: muxAuthorization(), 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    // Never log or return a Mux response body: it may contain a stream key.
    throw new Error(`Mux Live API returned ${response.status}`);
  }
  return response.status === 204 ? null : (await response.json()).data;
}

export async function createMuxLiveStream(title: string, liveId: string) {
  const data = await muxLiveRequest('/live-streams', {
    method: 'POST',
    body: JSON.stringify({
      playback_policies: ['signed'],
      latency_mode: 'low',
      new_asset_settings: {
        playback_policies: ['signed'],
        meta: { title, external_id: liveId },
      },
      passthrough: liveId,
      max_continuous_duration: 3600,
    }),
  });
  if (!data?.id || !data?.stream_key || !data?.playback_ids?.[0]?.id) {
    throw new Error('Mux returned an incomplete live stream');
  }
  return {
    id: String(data.id),
    streamKey: String(data.stream_key),
    playbackId: String(data.playback_ids[0].id),
  };
}

export async function deleteMuxLiveStream(id: string) {
  await muxLiveRequest(`/live-streams/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function getMuxLiveStreamStatus(id: string) {
  const data = await muxLiveRequest(`/live-streams/${encodeURIComponent(id)}`);
  return { status: String(data?.status ?? ''), activeAssetId: data?.active_asset_id ? String(data.active_asset_id) : null };
}

export async function disableMuxLiveStream(id: string) {
  await muxLiveRequest(`/live-streams/${encodeURIComponent(id)}/disable`, { method: 'PUT' });
}

export async function getMuxLiveAsset(id: string) {
  return await muxLiveRequest(`/assets/${encodeURIComponent(id)}`);
}
