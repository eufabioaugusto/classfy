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

async function deleteMuxResource(path: string) {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'DELETE',
    headers: { Authorization: muxAuthorization() },
  });
  // Deletion is retried when a later cleanup step fails.
  if (response.status !== 204 && response.status !== 404) throw new Error(`Mux Live API returned ${response.status}`);
}

export async function deleteMuxLiveStream(id: string) {
  await deleteMuxResource(`/live-streams/${encodeURIComponent(id)}`);
}

export async function deleteMuxLiveAsset(id: string) {
  await deleteMuxResource(`/assets/${encodeURIComponent(id)}`);
}

export async function listMuxLiveAssetIds(streamId: string) {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ live_stream_id: streamId, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch(`${apiBase}/assets?${query}`, {
      headers: { Authorization: muxAuthorization() },
    });
    if (!response.ok) throw new Error(`Mux Live API returned ${response.status}`);
    const result = await response.json();
    if (!Array.isArray(result.data)) throw new Error('Mux returned an invalid asset list');
    for (const asset of result.data) if (typeof asset.id === 'string') ids.push(asset.id);
    cursor = typeof result.next_cursor === 'string' && result.next_cursor ? result.next_cursor : null;
    if (!cursor) return ids;
  }
  throw new Error('Mux asset list exceeded pagination limit');
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
