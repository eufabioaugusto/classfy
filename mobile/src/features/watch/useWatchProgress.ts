import { useCallback, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';

type WatchMilestones = {
  start: boolean;
  view15s: boolean;
  half: boolean;
  complete: boolean;
};

type UseWatchProgressProps = {
  contentId?: string;
  durationSeconds?: number | null;
  enabled?: boolean;
};

const maxNaturalJumpSeconds = 3;

export function useWatchProgress({ contentId, durationSeconds = 0, enabled = false }: UseWatchProgressProps) {
  const { user } = useAuth();
  const [watchPercent, setWatchPercent] = useState(0);
  const [realWatchSeconds, setRealWatchSeconds] = useState(0);
  const [milestones, setMilestones] = useState<WatchMilestones>({
    start: false,
    view15s: false,
    half: false,
    complete: false,
  });

  const previousPositionRef = useRef(0);
  const accumulatedWatchRef = useRef(0);
  const lastProgressWriteRef = useRef(0);
  const milestoneRef = useRef<WatchMilestones>({
    start: false,
    view15s: false,
    half: false,
    complete: false,
  });

  const updateMilestone = useCallback((key: keyof WatchMilestones) => {
    milestoneRef.current = { ...milestoneRef.current, [key]: true };
    setMilestones(milestoneRef.current);
  }, []);

  const processReward = useCallback(
    async (actionKey: string, metadata?: Record<string, unknown>) => {
      if (!user || !contentId) return;

      await supabase.functions.invoke('process-reward', {
        body: {
          actionKey,
          userId: user.id,
          contentId,
          metadata,
        },
      });
    },
    [contentId, user],
  );

  const recordMetric = useCallback(
    async (event: 'start' | 'half' | 'complete') => {
      if (!user || !contentId) return;

      await supabase.from('content_metrics').insert({
        content_id: contentId,
        user_id: user.id,
        event,
      });
    },
    [contentId, user],
  );

  const trackProgress = useCallback(
    async (currentPercent: number, watchedSeconds: number) => {
      if (!user || !contentId) return;

      const clampedPercent = Math.min(Math.floor(currentPercent), 100);
      const progressData = {
        user_id: user.id,
        content_id: contentId,
        progress_percent: clampedPercent,
        last_position_seconds: Math.floor(watchedSeconds),
        completed: clampedPercent >= 90,
        completed_at: clampedPercent >= 90 ? new Date().toISOString() : null,
      };

      const { data: existingProgress } = await supabase
        .from('user_progress')
        .select('id, progress_percent')
        .eq('user_id', user.id)
        .eq('content_id', contentId)
        .maybeSingle();

      if (existingProgress) {
        if (clampedPercent > (existingProgress.progress_percent || 0)) {
          await supabase.from('user_progress').update(progressData).eq('id', existingProgress.id);
        }
      } else {
        await supabase.from('user_progress').insert(progressData);
      }
    },
    [contentId, user],
  );

  const updateWatchTime = useCallback(
    async (watchedSeconds: number) => {
      if (!user || !contentId) return;

      const today = new Date().toISOString().split('T')[0];
      await supabase
        .from('content_views')
        .update({
          total_watch_time_seconds: Math.floor(watchedSeconds),
          last_viewed_at: new Date().toISOString(),
        })
        .eq('content_id', contentId)
        .eq('user_id', user.id)
        .eq('view_date', today);
    },
    [contentId, user],
  );

  const handlePlaybackPosition = useCallback(
    async (positionSeconds: number) => {
      if (!enabled || !user || !contentId || !durationSeconds) return;

      const delta = positionSeconds - previousPositionRef.current;
      previousPositionRef.current = positionSeconds;

      if (delta > 0 && delta <= maxNaturalJumpSeconds) {
        accumulatedWatchRef.current += delta;
      }

      const watched = accumulatedWatchRef.current;
      const percent = Math.min((watched / durationSeconds) * 100, 100);
      setRealWatchSeconds(watched);
      setWatchPercent(percent);

      if (!milestoneRef.current.start && watched > 0.5) {
        updateMilestone('start');
        await recordMetric('start');
      }

      if (!milestoneRef.current.view15s && watched >= 15) {
        updateMilestone('view15s');
        await processReward('VIEW_15S', { watch_time: watched });
      }

      if (!milestoneRef.current.half && percent >= 50) {
        updateMilestone('half');
        await recordMetric('half');
        await processReward('WATCH_50', { progress: 50 });
      }

      if (!milestoneRef.current.complete && percent >= 90) {
        updateMilestone('complete');
        await recordMetric('complete');
        await processReward('WATCH_100', { progress: 100 });
      }

      const floored = Math.floor(watched);
      if (floored >= lastProgressWriteRef.current + 5) {
        lastProgressWriteRef.current = floored;
        await trackProgress(percent, watched);
        await updateWatchTime(watched);
      }
    },
    [
      contentId,
      durationSeconds,
      enabled,
      processReward,
      recordMetric,
      trackProgress,
      updateMilestone,
      updateWatchTime,
      user,
    ],
  );

  return {
    watchPercent,
    realWatchSeconds,
    milestones,
    handlePlaybackPosition,
  };
}
