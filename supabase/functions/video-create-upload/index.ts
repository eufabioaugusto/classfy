import { corsHeaders, json, requireUser } from '../_shared/video/http.ts';
import { getVideoProvider } from '../_shared/video/provider.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { user, client } = await requireUser(req);
    const { title, corsOrigin } = await req.json();
    if (!title) return json({ error: 'title is required' }, 400);
    const provider = getVideoProvider();
    const { data: asset, error: assetError } = await client.from('media_assets').insert({ owner_id: user.id }).select().single();
    if (assetError) throw assetError;
    try {
      const target = await provider.createUpload({ mediaAssetId: asset.id, title, corsOrigin: corsOrigin || req.headers.get('origin') || '*' });
      const { data: binding, error: bindingError } = await client.from('media_provider_assets').insert({
        media_asset_id: asset.id,
        provider: provider.name,
        provider_asset_id: target.providerAssetId ?? null,
        provider_upload_id: target.providerUploadId,
        status: 'uploading',
        playback_policy: provider.name === 'bunny' ? 'public' : 'signed',
        provider_metadata: { upload_expires_at: target.expiresAt },
      }).select().single();
      if (bindingError) throw bindingError;
      await client.from('media_assets').update({ active_provider_binding_id: binding.id, status: 'uploading', updated_at: new Date().toISOString() }).eq('id', asset.id);
      return json({ mediaAssetId: asset.id, ...target });
    } catch (error) {
      await client.from('media_assets').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', asset.id);
      throw error;
    }
  } catch (error) {
    console.error('[video-create-upload]', error);
    return json({ error: error instanceof Error ? error.message : 'Upload creation failed' }, 400);
  }
});
