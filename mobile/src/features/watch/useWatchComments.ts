import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';

export type WatchComment = {
  id: string;
  text: string;
  created_at: string;
  user_id: string;
  profiles?: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
};

type CommentRow = Omit<WatchComment, 'profiles'> & {
  profiles?: WatchComment['profiles'] | WatchComment['profiles'][] | null;
};

type UseWatchCommentsProps = {
  contentId?: string;
  enabled?: boolean;
};

function validateComment(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return 'Comentario nao pode estar vazio.';
  if (trimmed.length > 1000) return 'Comentario deve ter menos de 1000 caracteres.';
  if (/[<>]/.test(trimmed)) return 'Comentario contem caracteres invalidos.';
  return null;
}

export function useWatchComments({ contentId, enabled = false }: UseWatchCommentsProps) {
  const { user, profile } = useAuth();
  const [comments, setComments] = useState<WatchComment[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!contentId) return;

    setLoading(true);
    const { data, error } = await supabase
      .from('comments')
      .select('id,text,created_at,user_id,profiles:user_id(display_name,avatar_url)')
      .eq('content_id', contentId)
      .is('parent_id', null)
      .order('created_at', { ascending: false });

    if (!error) {
      const rows = ((data as CommentRow[] | null) ?? []).map((comment) => ({
        ...comment,
        profiles: Array.isArray(comment.profiles) ? comment.profiles[0] ?? null : comment.profiles ?? null,
      }));
      setComments(rows);
    }

    setLoading(false);
  }, [contentId]);

  useEffect(() => {
    if (enabled) {
      fetchComments();
    }
  }, [enabled, fetchComments]);

  const submitComment = useCallback(
    async (text: string) => {
      if (!user || !contentId) {
        Alert.alert('Login necessario', 'Entre na Classfy para comentar.');
        return false;
      }

      const validationError = validateComment(text);
      if (validationError) {
        Alert.alert('Comentario invalido', validationError);
        return false;
      }

      const trimmed = text.trim();
      setSubmitting(true);

      const { error } = await supabase.from('comments').insert({
        user_id: user.id,
        content_id: contentId,
        text: trimmed,
      });

      if (error) {
        setSubmitting(false);
        Alert.alert('Erro', 'Nao foi possivel publicar seu comentario.');
        return false;
      }

      await supabase.functions.invoke('process-reward', {
        body: {
          actionKey: 'COMMENT_CONTENT',
          userId: user.id,
          contentId,
          metadata: { commentLength: trimmed.length },
        },
      });

      await fetchComments();
      setSubmitting(false);
      return true;
    },
    [contentId, fetchComments, user],
  );

  return {
    comments,
    loading,
    submitting,
    user,
    profile,
    fetchComments,
    submitComment,
  };
}
