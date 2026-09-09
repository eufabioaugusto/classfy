import { corsHeaders, json, requireUser } from '../_shared/video/http.ts';
import { getVideoProvider } from '../_shared/video/provider.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { user, client } = await requireUser(req);
    const { mediaAssetId } = await req.json();
    const { data: asset, error } = await client.from('media_assets').select('*, media_provider_assets(*)').eq('id', mediaAssetId).single();
    if (error || !asset) return json({ error: 'Media asset not found' }, 404);

    const { data: content } = asset.content_id
      ? await client.from('contents').select('id, creator_id, status, visibility, required_plan').eq('id', asset.content_id).single()
      : { data: null };
    if (!content || content.status !== 'approved') {
      if (asset.owner_id !== user.id) return json({ error: 'Forbidden' }, 403);
    } else if (content.creator_id !== user.id) {
      if (content.visibility === 'paid') {
        const { data: purchase } = await client.from('purchased_contents').select('id').eq('user_id', user.id).eq('content_id', content.id).maybeSingle();
        if (!purchase) return json({ error: 'Purchase required' }, 403);
      } else if (content.visibility === 'pro' || content.visibility === 'premium') {
        const { data: profile } = await client.from('profiles').select('plan').eq('id', user.id).single();
        const rank: Record<string, number> = { free: 0, pro: 1, premium: 2 };
        if ((rank[profile?.plan ?? 'free'] ?? 0) < rank[content.visibility]) return json({ error: 'Subscription required' }, 403);
      }
    }

    const bindings = asset.media_provider_assets as Array<Record<string, any>>;
    const binding = bindings.find(item => item.id === asset.active_provider_binding_id);
    if (!binding || binding.status !== 'ready') return json({ error: 'Video is still processing', status: asset.status }, 409);
    const source = await getVideoProvider(binding.provider).getPlaybackSource(binding, asset);
    return json({ mediaAssetId: asset.id, status: asset.status, source });
  } catch (error) {
    console.error('[video-playback]', error);
    return json({ error: error instanceof Error ? error.message : 'Playback resolution failed' }, 400);
  }
});
