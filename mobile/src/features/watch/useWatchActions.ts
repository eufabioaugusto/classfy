import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { useAuth } from '@/features/auth/authContext';
import { notifyConfirmedRewards, REWARDS_CHANGED } from '@/features/rewards/events';
import { supabase } from '@/lib/supabase';

type Props = { contentId?: string; isCourse?: boolean; initialLikes?: number | null; hasAccess?: boolean };
export function useWatchActions({ contentId, isCourse = false, initialLikes = 0, hasAccess = false }: Props) {
  const { user } = useAuth();
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(initialLikes || 0);
  const busy = useRef(false);
  const owner = useRef(user?.id); owner.current = user?.id;
  const foreignKey = isCourse ? 'course_id' : 'content_id';
  useEffect(() => {
    let active = true;
    setIsLiked(false); setIsSaved(false); setIsFavorited(false); setLikesCount(initialLikes || 0);
    if (!user || !contentId) return;
    void Promise.all([
      supabase.from('actions').select('id').eq('user_id', user.id).eq('type', 'LIKE').eq(foreignKey, contentId).maybeSingle(),
      supabase.from('saved_contents').select('id').eq('user_id', user.id).eq(foreignKey, contentId).maybeSingle(),
      supabase.from('favorites').select('id').eq('user_id', user.id).eq(foreignKey, contentId).maybeSingle(),
    ]).then(([like, saved, favorite]) => {
      if (!active) return;
      setIsLiked(Boolean(like.data)); setIsSaved(Boolean(saved.data)); setIsFavorited(Boolean(favorite.data));
    });
    return () => { active = false; };
  }, [user?.id, contentId, foreignKey, initialLikes]);

  const toggle = useCallback(async (actionKey: 'LIKE' | 'SAVE' | 'FAVORITE', current: boolean, setter: (value: boolean) => void) => {
    if (!user) { Alert.alert('Login necessário', 'Entre na Classfy para interagir com este conteúdo.'); return; }
    if (!contentId || busy.current) return;
    busy.current = true;
    try {
      if (current) {
        if (actionKey === 'LIKE') {
          let query = supabase.from('reward_events').select('points').eq('user_id', user.id).eq('action_key', 'LIKE').order('created_at', { ascending: false }).limit(1);
          query = isCourse ? query.contains('metadata', { course_id: contentId }) : query.eq('content_id', contentId);
          const { data, error } = await query.maybeSingle();
          if (error) throw error;
          if (Number(data?.points) > 0) {
            const confirmed = await new Promise<boolean>(resolve => Alert.alert('Remover curtida?', `${data!.points} Points recebidos por esta curtida serão deduzidos.`, [
              { text: 'Manter', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Remover', style: 'destructive', onPress: () => resolve(true) },
            ], { cancelable: true, onDismiss: () => resolve(false) }));
            if (!confirmed || owner.current !== user.id) return;
          }
        }
        // Same atomic removal + economic reversal as the web app.
        const { data, error } = await supabase.functions.invoke('reverse-reward', { body: { actionKey, userId: user.id, targetId: contentId } });
        if (error || data?.error) throw error || new Error(data.error);
        if (owner.current !== user.id) return;
        setter(false);
        if (actionKey === 'LIKE' && data?.action_removed) setLikesCount(count => Math.max(0, count - 1));
        DeviceEventEmitter.emit(REWARDS_CHANGED, { userId: user.id, contentId });
      } else {
        const table = actionKey === 'LIKE' ? 'actions' : actionKey === 'SAVE' ? 'saved_contents' : 'favorites';
        const { error } = await supabase.from(table).insert({ user_id: user.id, [foreignKey]: contentId, ...(actionKey === 'LIKE' ? { type: 'LIKE' } : {}) });
        if (error && error.code !== '23505') throw error;
        if (owner.current !== user.id) return;
        setter(true);
        if (actionKey === 'LIKE' && !error) setLikesCount(count => count + 1);
        if (hasAccess && !error) {
          const reward = await supabase.functions.invoke('process-reward', { body: { actionKey, userId: user.id, contentId } });
          if (!reward.error && owner.current === user.id) notifyConfirmedRewards(reward.data?.rewards || []);
        }
      }
    } catch { if (owner.current === user.id) Alert.alert('Não foi possível concluir', 'Tente novamente em instantes.'); }
    finally { busy.current = false; }
  }, [user?.id, contentId, isCourse, foreignKey, hasAccess]);
  return { isLiked, isSaved, isFavorited, likesCount, toggleLike: () => toggle('LIKE', isLiked, setIsLiked), toggleSave: () => toggle('SAVE', isSaved, setIsSaved), toggleFavorite: () => toggle('FAVORITE', isFavorited, setIsFavorited) };
}
