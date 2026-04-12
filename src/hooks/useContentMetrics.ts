import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useRewardSystem } from "@/hooks/useRewardSystem";

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
  const currentTimeRef = useRef(0);
  const lastProgressUpdateRef = useRef(0);
  const lastWatchTimeUpdateRef = useRef(0);

  // --- Anti-seek tracking ---
  // Tracks the REAL accumulated seconds the user has watched (not seeked position)
  const accumulatedWatchTimeRef = useRef(0);
  // The previous timeupdate value, used to detect seeks
  const previousTimeRef = useRef(0);
  // Max allowed jump between two timeupdate events before it's considered a seek (seconds)
  const MAX_NATURAL_JUMP = 3;

  const recordMetric = useCallback(async (event: "start" | "half" | "complete") => {
    if (metricsRecorded[event] || !user || !contentId) return;

    try {
      await supabase.from("content_metrics").insert({
        content_id: contentId,
        user_id: user.id,
        event,
      });

      setMetricsRecorded((prev) => ({ ...prev, [event]: true }));
    } catch (error) {
      console.error("Error recording metric:", error);
    }
  }, [contentId, user, metricsRecorded]);

  const checkBingeWatch = useCallback(async () => {
    if (!user) return;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCompletions } = await supabase
      .from("content_metrics")
      .select("content_id")
      .eq("user_id", user.id)
      .eq("event", "complete")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(3);

    if (recentCompletions && recentCompletions.length >= 3) {
      await processReward({
        actionKey: "BINGE_WATCH",
        userId: user.id,
        metadata: { contentCount: recentCompletions.length },
      });
    }
  }, [user, processReward]);

  const checkFirstContentWeek = useCallback(async () => {
    if (!user || !contentId) return;

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const { data: weeklyViews } = await supabase
      .from("content_metrics")
      .select("id")
      .eq("user_id", user.id)
      .eq("event", "start")
      .gte("created_at", startOfWeek.toISOString())
      .limit(1);

    if (!weeklyViews || weeklyViews.length === 0) {
      await processReward({
        actionKey: "FIRST_CONTENT_WEEK",
        userId: user.id,
        contentId: contentId,
      });
    }
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
    if (!metricsRecorded.start && realWatchTime > 0.5) {
      await recordMetric("start");
      await checkFirstContentWeek();
    }

    // 15 second view reward - based on REAL accumulated watch time
    if (!metricsRecorded.view15s && realWatchTime >= 15) {
      await processReward({
        actionKey: "VIEW_15S",
        userId: user.id,
        contentId: contentId,
        metadata: { watch_time: realWatchTime },
      });
      setMetricsRecorded((prev) => ({ ...prev, view15s: true }));
      onMilestone?.();
    }

    // Half metric - user must have actually watched >= 50% of the content
    if (!metricsRecorded.half && realPercent >= 50) {
      await recordMetric("half");
      onMilestone?.();
    }

    // Complete metric - user must have actually watched >= 90% of the content
    if (!metricsRecorded.complete && realPercent >= 90) {
      await recordMetric("complete");
      await checkBingeWatch();
      onMilestone?.();
    }

    // Track progress every 5 seconds of REAL watch time (throttled)
    const floorRealTime = Math.floor(realWatchTime);
    if (floorRealTime >= lastProgressUpdateRef.current + 5 && realWatchTime > 0.5) {
      lastProgressUpdateRef.current = floorRealTime;
      // Pass realPercent so progress/rewards are based on actual watching
      await trackProgress(user.id, contentId, realPercent, realWatchTime);
    }

    // Update watch time every 10 seconds of REAL watch time (throttled)
    if (floorRealTime >= lastWatchTimeUpdateRef.current + 10 && realWatchTime >= 10) {
      lastWatchTimeUpdateRef.current = floorRealTime;
      await updateWatchTime(realWatchTime);
    }
  }, [contentId, user, duration, metricsRecorded, recordMetric, processReward, trackProgress, checkFirstContentWeek, checkBingeWatch, updateWatchTime]);

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
    setMetricsRecorded({
      start: false,
      half: false,
      complete: false,
      view15s: false,
    });
    lastProgressUpdateRef.current = 0;
    lastWatchTimeUpdateRef.current = 0;
    accumulatedWatchTimeRef.current = 0;
    previousTimeRef.current = 0;
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
