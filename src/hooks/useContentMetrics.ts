import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { trackUserInteraction } from "@/lib/personalization/interests";

interface MetricsState {
  start: boolean;
  half: boolean;
  complete: boolean;
  view15s: boolean;
}

interface UseContentMetricsProps {
  contentId: string;
  duration: number;
  onMilestone?: () => void;
}

export function useContentMetrics({ contentId, duration, onMilestone }: UseContentMetricsProps) {
  const { user } = useAuth();
  const { processReward, trackProgress } = useRewardSystem();
  const [metricsRecorded, setMetricsRecorded] = useState<MetricsState>({
    start: false,
    half: false,
    complete: false,
    view15s: false,
  });
  const metricsRecordedRef = useRef<MetricsState>({
    start: false,
    half: false,
    complete: false,
    view15s: false,
  });
  const currentTimeRef = useRef(0);
  const lastProgressUpdateRef = useRef(0);
  const lastWatchTimeUpdateRef = useRef(0);
  const interestMilestonesRef = useRef({ half: false, complete: false });

  // --- Anti-seek tracking ---
  // Tracks the REAL accumulated seconds the user has watched (not seeked position)
  const accumulatedWatchTimeRef = useRef(0);
  // The previous timeupdate value, used to detect seeks
  const previousTimeRef = useRef(0);
  // Max allowed jump between two timeupdate events before it's considered a seek (seconds)
  const MAX_NATURAL_JUMP = 3;

  const recordMetric = useCallback(async (event: "start" | "half" | "complete") => {
    if (metricsRecordedRef.current[event] || !user || !contentId) return;

    metricsRecordedRef.current[event] = true;
    setMetricsRecorded((prev) => ({ ...prev, [event]: true }));

    try {
      const { error } = await supabase.from("content_metrics").insert({
        content_id: contentId,
        user_id: user.id,
        event,
      });
      if (error) throw error;
    } catch (error) {
      metricsRecordedRef.current[event] = false;
      setMetricsRecorded((prev) => ({ ...prev, [event]: false }));
      console.error("Error recording metric:", error);
    }
  }, [contentId, user]);

  const checkFirstContentWeek = useCallback(async () => {
    if (!user || !contentId) return;
    // A evidência de start já foi persistida. A decisão de primeira ação da
    // semana e a idempotência pertencem exclusivamente ao servidor.
    await processReward({
      actionKey: "FIRST_CONTENT_WEEK",
      userId: user.id,
      contentId,
    });
  }, [user, contentId, processReward]);

  const updateWatchTime = useCallback(async (watchedSeconds: number) => {
    if (!user || !contentId) return;
    
    const today = new Date().toISOString().split('T')[0];
    try {
      await supabase
        .from('content_views')
        .update({ 
          total_watch_time_seconds: Math.floor(watchedSeconds),
          last_viewed_at: new Date().toISOString()
        })
        .eq('content_id', contentId)
        .eq('user_id', user.id)
        .eq('view_date', today);
    } catch (error) {
      console.error('Error updating watch time:', error);
    }
  }, [user, contentId]);

  const trackContentInterest = useCallback(async (action: "watch_50" | "watch_100") => {
    if (!user || !contentId) return;

    const { data } = await supabase
      .from("contents")
      .select("title, tags, category_id")
      .eq("id", contentId)
      .maybeSingle();

    await trackUserInteraction({
      userId: user.id,
      action,
      title: data?.title,
      tags: data?.tags,
      categoryId: data?.category_id,
    });
  }, [contentId, user]);

  const handleTimeUpdate = useCallback(async (currentTime: number) => {
    if (!contentId || !user || duration === 0) return;

    currentTimeRef.current = currentTime;

    // --- Calculate delta and detect seeks ---
    const delta = currentTime - previousTimeRef.current;
    previousTimeRef.current = currentTime;

    // Only accumulate if delta is a natural playback increment (> 0 and within threshold)
    // This excludes: seeks forward (large jumps), seeks backward (negative delta), paused (delta ~0)
    if (delta > 0 && delta <= MAX_NATURAL_JUMP) {
      accumulatedWatchTimeRef.current += delta;
    }

    const realWatchTime = accumulatedWatchTimeRef.current;
    
    // Use REAL watch time for percentage calculations on rewards
    // (the user must actually watch, not just seek)
    const realPercent = duration > 0 ? (realWatchTime / duration) * 100 : 0;

    // Start metric: triggers on first real playback (any small delta counts)
    if (!metricsRecordedRef.current.start && realWatchTime > 0.5) {
      await recordMetric("start");
      await checkFirstContentWeek();
    }

    // 15 second view reward - based on REAL accumulated watch time
    if (!metricsRecordedRef.current.view15s && realWatchTime >= 15) {
      metricsRecordedRef.current.view15s = true;
      setMetricsRecorded((prev) => ({ ...prev, view15s: true }));
      // Persistir a evidencia antes de pedir a recompensa. O servidor nao confia
      // no tempo informado pelo cliente sem um registro de progresso associado.
      await updateWatchTime(realWatchTime);
      await processReward({
        actionKey: "VIEW_15S",
        userId: user.id,
        contentId: contentId,
        metadata: { watch_time: realWatchTime },
      });
      onMilestone?.();
    }

    // Persistir progresso e processar recompensas antes de analytics auxiliares.
    // Isso evita que requests nao economicos atrasem os milestones financeiros.
    const floorRealTime = Math.floor(realWatchTime);
    if (floorRealTime >= lastProgressUpdateRef.current + 5 && realWatchTime > 0.5) {
      lastProgressUpdateRef.current = floorRealTime;
      await trackProgress(user.id, contentId, realPercent, realWatchTime);
    }

    // Half metric - user must have actually watched >= 50% of the content
    if (!metricsRecordedRef.current.half && realPercent >= 50) {
      await recordMetric("half");
      if (!interestMilestonesRef.current.half) {
        interestMilestonesRef.current.half = true;
        await trackContentInterest("watch_50");
      }
      onMilestone?.();
    }

    // Complete metric - user must have actually watched >= 90% of the content
    if (!metricsRecordedRef.current.complete && realPercent >= 90) {
      await recordMetric("complete");
      if (!interestMilestonesRef.current.complete) {
        interestMilestonesRef.current.complete = true;
        await trackContentInterest("watch_100");
      }
      onMilestone?.();
    }

    // Update watch time every 10 seconds of REAL watch time (throttled)
    if (floorRealTime >= lastWatchTimeUpdateRef.current + 10 && realWatchTime >= 10) {
      lastWatchTimeUpdateRef.current = floorRealTime;
      await updateWatchTime(realWatchTime);
    }
  }, [contentId, user, duration, recordMetric, processReward, trackProgress, checkFirstContentWeek, updateWatchTime, trackContentInterest, onMilestone]);

  const registerView = useCallback(async () => {
    if (!user || !contentId) return;

    try {
      await supabase.rpc("increment_content_view", {
        p_user_id: user.id,
        p_content_id: contentId,
      });
    } catch (error) {
      console.error("Error registering view:", error);
    }
  }, [user, contentId]);

  const registerCourseView = useCallback(async (courseId: string) => {
    if (!user || !courseId) return;

    try {
      await supabase.rpc("increment_course_view", {
        p_user_id: user.id,
        p_course_id: courseId,
      });
    } catch (error) {
      console.error("Error registering course view:", error);
    }
  }, [user]);

  const resetMetrics = useCallback(() => {
    const initialState = {
      start: false,
      half: false,
      complete: false,
      view15s: false,
    };
    metricsRecordedRef.current = initialState;
    setMetricsRecorded(initialState);
    lastProgressUpdateRef.current = 0;
    lastWatchTimeUpdateRef.current = 0;
    accumulatedWatchTimeRef.current = 0;
    previousTimeRef.current = 0;
    interestMilestonesRef.current = { half: false, complete: false };
  }, []);

  return {
    handleTimeUpdate,
    registerView,
    registerCourseView,
    resetMetrics,
    metricsRecorded,
    currentTime: currentTimeRef.current,
  };
}
