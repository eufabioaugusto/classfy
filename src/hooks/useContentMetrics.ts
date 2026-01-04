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
}

export function useContentMetrics({ contentId, duration }: UseContentMetricsProps) {
  const { user } = useAuth();
  const { processReward, trackProgress } = useRewardSystem();
  const [metricsRecorded, setMetricsRecorded] = useState<MetricsState>({
    start: false,
    half: false,
    complete: false,
    view15s: false,
  });
  const currentTimeRef = useRef(0);

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

  const handleTimeUpdate = useCallback(async (currentTime: number) => {
    if (!contentId || !user || duration === 0) return;

    currentTimeRef.current = currentTime;
    const percent = (currentTime / duration) * 100;

    // 15 second view reward
    if (!metricsRecorded.view15s && currentTime >= 15) {
      await processReward({
        actionKey: "VIEW_15S",
        userId: user.id,
        contentId: contentId,
        metadata: { watch_time: currentTime },
      });
      setMetricsRecorded((prev) => ({ ...prev, view15s: true }));
    }

    // Start metric
    if (!metricsRecorded.start && currentTime > 0) {
      await recordMetric("start");
      await checkFirstContentWeek();
    }

    // Half metric
    if (!metricsRecorded.half && currentTime > duration / 2) {
      await recordMetric("half");
    }

    // Complete metric (95%)
    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      await recordMetric("complete");
      await checkBingeWatch();
    }

    // Track progress every 5 seconds
    if (currentTime % 5 < 0.5) {
      await trackProgress(user.id, contentId, percent, currentTime);
    }

    // Update watch time in content_views every 10 seconds
    if (currentTime % 10 < 0.5 && currentTime > 0) {
      const today = new Date().toISOString().split('T')[0];
      await supabase
        .from('content_views')
        .update({ 
          total_watch_time_seconds: Math.floor(currentTime),
          last_viewed_at: new Date().toISOString()
        })
        .eq('content_id', contentId)
        .eq('user_id', user.id)
        .eq('view_date', today);
    }
  }, [contentId, user, duration, metricsRecorded, recordMetric, processReward, trackProgress, checkFirstContentWeek, checkBingeWatch]);

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
