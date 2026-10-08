import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';

export function usePlaybackSource(mediaAssetId: string | null | undefined, legacyUrl: string | null | undefined, enabled: boolean) {
  const { user } = useAuth();
  enabled = enabled && Boolean(user);
  const source = mediaAssetId || legacyUrl || '';
  const key = enabled && source ? `${user?.id}:${source}` : '';
  const [resolved, setResolved] = useState({ key: '', url: '', error: '' });
  useEffect(() => {
    let active = true;
    if (!enabled || !key) { setResolved({ key, url: '', error: '' }); return; }
    if (!mediaAssetId) {
      setResolved({ key, url: legacyUrl?.startsWith('media:') ? '' : legacyUrl || '', error: legacyUrl?.startsWith('media:') ? 'Fonte de vídeo indisponível.' : '' });
      return;
    }
    void supabase.functions.invoke('video-playback', { body: { mediaAssetId } }).then(({ data, error }) => {
      if (!active) return;
      setResolved({ key, url: error ? '' : data?.source?.url || '', error: error || !data?.source?.url ? 'Não foi possível carregar o vídeo. Abra o conteúdo novamente.' : '' });
    });
    return () => { active = false; };
  }, [key, enabled, mediaAssetId, legacyUrl]);
  return { url: resolved.key === key ? resolved.url : '', error: resolved.key === key ? resolved.error : '', loading: enabled && Boolean(key) && resolved.key !== key };
}
