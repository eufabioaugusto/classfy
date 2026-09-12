import { corsHeaders, json, requireUser } from '../_shared/video/http.ts';
import { getVideoProvider } from '../_shared/video/provider.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const { user, client } = await requireUser(req);
    const [{ data: roles }, { data: profile }] = await Promise.all([
      client.from('user_roles').select('role').eq('user_id', user.id).in('role', ['creator', 'admin']),
      client.from('profiles').select('creator_status').eq('id', user.id).single(),
    ]);
    const isAdmin = roles?.some(item => item.role === 'admin');
    const isApprovedCreator = roles?.some(item => item.role === 'creator')
      && profile?.creator_status === 'approved';
    if (!isAdmin && !isApprovedCreator) return json({ error: 'Approved creator access required' }, 403);

    const { title, corsOrigin, mediaType = 'video', draftId = null, slotKey = null } = await req.json();
    if (!title) return json({ error: 'title is required' }, 400);
    if (!['video', 'audio'].includes(mediaType)) return json({ error: 'invalid media type' }, 400);
    if (draftId) {
      const { data: draft } = await client.from('publication_drafts').select('id').eq('id', draftId).eq('owner_id', user.id).eq('state', 'draft').maybeSingle();
      if (!draft) return json({ error: 'Draft not found' }, 404);
    }
    const provider = getVideoProvider();
    const { data: asset, error: assetError } = await client.from('media_assets').insert({
      owner_id: user.id,
      media_type: mediaType,
      publication_draft_id: draftId,
    }).select().single();
    if (assetError) throw assetError;
    try {
      if (draftId) {
        const { error: draftAssetError } = await client.from('publication_draft_assets').upsert({
          draft_id: draftId,
          media_asset_id: asset.id,
          slot_key: slotKey || `media:${asset.id}`,
        }, { onConflict: 'draft_id,slot_key' });
        if (draftAssetError) throw draftAssetError;
      }
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
      if (provider.name === 'mock') {
        await client.from('media_assets').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', asset.id);
        await client.from('media_provider_assets').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', binding.id);
      }
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
