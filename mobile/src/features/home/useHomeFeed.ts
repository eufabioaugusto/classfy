import { useEffect, useState } from 'react';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { ContentSummary } from '@/types/content';

const previewContents: ContentSummary[] = [
  {
    id: 'preview-aula',
    title: 'Como a Classfy transforma conteudo em estudo e recompensa',
    description: 'Preview local para validar a experiencia mobile antes de ligar o feed real.',
    content_type: 'aula',
    visibility: 'free',
    views_count: 1280,
    profiles: { display_name: 'Classfy' },
  },
  {
    id: 'preview-rewards',
    title: 'Rewards, carteira e creator economy no centro do app',
    description: 'A camada de monetizacao deve aparecer como produto, nao como detalhe escondido.',
    content_type: 'short',
    visibility: 'pro',
    views_count: 820,
    profiles: { display_name: 'Classfy Labs' },
  },
];

export function useHomeFeed() {
  const [contents, setContents] = useState<ContentSummary[]>(isSupabaseConfigured ? [] : previewContents);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);
  const [usingFallback, setUsingFallback] = useState(!isSupabaseConfigured);

  useEffect(() => {
    let mounted = true;

    async function loadFeed() {
      if (!isSupabaseConfigured) {
        return;
      }

      setLoading(true);
      const { data, error: feedError } = await supabase
        .from('contents')
        .select('id,title,description,thumbnail_url,content_type,visibility,views_count,duration_seconds,profiles:creator_id(display_name,avatar_url)')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(12);

      if (!mounted) {
        return;
      }

      if (feedError) {
        setError(feedError.message);
        setContents(previewContents);
        setUsingFallback(true);
      } else {
        setContents((data as ContentSummary[] | null) ?? []);
        setUsingFallback(false);
      }

      setLoading(false);
    }

    loadFeed();

    return () => {
      mounted = false;
    };
  }, []);

  return { contents, loading, error, usingFallback };
}
