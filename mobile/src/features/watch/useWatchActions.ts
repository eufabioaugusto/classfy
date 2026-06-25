import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';

type UseWatchActionsProps = {
  contentId?: string;
  isCourse?: boolean;
  initialLikes?: number | null;
  hasAccess?: boolean;
};

export function useWatchActions({ contentId, isCourse = false, initialLikes = 0, hasAccess = false }: UseWatchActionsProps) {
  const { user } = useAuth();
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(initialLikes || 0);

  useEffect(() => {
    setLikesCount(initialLikes || 0);
  }, [initialLikes]);

  useEffect(() => {
    let mounted = true;

    async function loadState() {
      if (!user || !contentId) return;
      const foreignKey = isCourse ? 'course_id' : 'content_id';

      const [likeResult, savedResult, favoriteResult] = await Promise.all([
        supabase.from('actions').select('id').eq('user_id', user.id).eq('type', 'LIKE').eq(foreignKey, contentId).maybeSingle(),
        supabase.from('saved_contents').select('id').eq('user_id', user.id).eq(foreignKey, contentId).maybeSingle(),
        supabase.from('favorites').select('id').eq('user_id', user.id).eq(foreignKey, contentId).maybeSingle(),
      ]);

      if (!mounted) return;
      setIsLiked(Boolean(likeResult.data));
      setIsSaved(Boolean(savedResult.data));
      setIsFavorited(Boolean(favoriteResult.data));
    }

    loadState();

    return () => {
      mounted = false;
    };
  }, [contentId, isCourse, user]);

  const requireUser = useCallback(() => {
    if (user) return true;
    Alert.alert('Login necessario', 'Entre na Classfy para interagir com este conteudo.');
    return false;
  }, [user]);

  const toggleLike = useCallback(async () => {
    if (!requireUser() || !contentId || !user) return;
    const foreignKey = isCourse ? 'course_id' : 'content_id';

    if (isLiked) {
      await supabase.from('actions').delete().eq('user_id', user.id).eq('type', 'LIKE').eq(foreignKey, contentId);
      setIsLiked(false);
      setLikesCount((count) => Math.max(0, count - 1));
      return;
    }

    const { error } = await supabase.from('actions').insert({
      user_id: user.id,
      type: 'LIKE',
      [foreignKey]: contentId,
    });

    if (!error || error.code === '23505') {
      setIsLiked(true);
      if (!error) setLikesCount((count) => count + 1);
    }

    if (hasAccess && !isCourse && !error) {
      supabase.functions.invoke('process-reward', {
        body: { actionKey: 'LIKE_CONTENT', userId: user.id, contentId },
      }).then(() => {});
    }
  }, [contentId, hasAccess, isCourse, isLiked, requireUser, user]);

  const toggleSavedTable = useCallback(
    async (table: 'saved_contents' | 'favorites', current: boolean, setter: (value: boolean) => void) => {
      if (!requireUser() || !contentId || !user) return;
      const foreignKey = isCourse ? 'course_id' : 'content_id';

      if (current) {
        await supabase.from(table).delete().eq('user_id', user.id).eq(foreignKey, contentId);
        setter(false);
        return;
      }

      const { error } = await supabase.from(table).insert({
        user_id: user.id,
        [foreignKey]: contentId,
      });

      if (!error || error.code === '23505') {
        setter(true);
      }
    },
    [contentId, isCourse, requireUser, user],
  );

  return {
    isLiked,
    isSaved,
    isFavorited,
    likesCount,
    toggleLike,
    toggleSave: () => toggleSavedTable('saved_contents', isSaved, setIsSaved),
    toggleFavorite: () => toggleSavedTable('favorites', isFavorited, setIsFavorited),
  };
}
