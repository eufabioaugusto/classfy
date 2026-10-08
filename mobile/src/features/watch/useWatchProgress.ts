import { useEffect, useState } from 'react';
import { useAuth } from '@/features/auth/authContext';
import { useMiniPlayer } from './miniPlayerContext';
import { supabase } from '@/lib/supabase';

type Props = { contentId?: string; durationSeconds?: number | null; enabled?: boolean; lessonId?: string };
/** PlaybackProvider owns writes so minimizing never interrupts the watch session. */
export function useWatchProgress({ contentId, enabled = false, lessonId }: Props) {
  const { user } = useAuth();
  const playback = useMiniPlayer();
  const [savedPositionSeconds, setSavedPosition] = useState<number | null>(null);
  const [savedPercent, setSavedPercent] = useState(0);
  const [hasLoadedSavedProgress, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    setSavedPosition(null); setSavedPercent(0); setLoaded(false);
    if (!user || (!contentId && !lessonId) || !enabled) return;
    void supabase.from(lessonId ? 'course_lesson_progress' : 'user_progress').select('last_position_seconds,progress_percent').eq('user_id', user.id).eq(lessonId ? 'lesson_id' : 'content_id', lessonId || contentId!).maybeSingle().then(({ data }) => {
      if (!active) return;
      setSavedPosition(Number(data?.last_position_seconds || 0)); setSavedPercent(Number(data?.progress_percent || 0)); setLoaded(true);
    });
    return () => { active = false; };
  }, [user?.id, contentId, enabled, lessonId]);
  return { milestones: { start: playback.qualifiedWatchSeconds > 0, view15s: playback.qualifiedWatchSeconds >= 15, half: Math.max(savedPercent, playback.watchPercent) >= 50, complete: playback.completed || savedPercent >= 100 }, watchPercent: Math.max(savedPercent, playback.watchPercent), realWatchSeconds: playback.realWatchSeconds, savedPositionSeconds, hasLoadedSavedProgress };
}
