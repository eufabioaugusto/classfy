import { useState, useRef, useCallback, useEffect } from "react";
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
  enabled?: boolean;
  onMilestone?: () => void;
}

export function useContentMetrics({ contentId, duration, enabled = true, onMilestone }: UseContentMetricsProps) {
  const { user } = useAuth();
  const { processReward, trackProgressSession } = useRewardSystem();
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
  const interestMilestonesRef = useRef({ half: false, complete: false });

  // --- Anti-seek tracking ---
  // Tracks the REAL accumulated seconds the user has watched (not seeked position)
  const accumulatedWatchTimeRef = useRef(0);
  // The previous timeupdate value, used to detect seeks
  const previousTimeRef = useRef(0);
  const watchSessionIdRef = useRef<string>(globalThis.crypto.randomUUID());
  // Max allowed jump between two timeupdate events before it's considered a seek (seconds)
  const MAX_NATURAL_JUMP = 3;

  useEffect(() => {
    watchSessionIdRef.current = globalThis.crypto.randomUUID();
    lastProgressUpdateRef.current = 0;
    accumulatedWatchTimeRef.current = 0;
    previousTimeRef.current = 0;
  }, [contentId, user?.id]);

  const recordMetric = useCallback(async (event: "start" | "half" | "complete") => {
    if (!enabled || metricsRecordedRef.current[event] || !user || !contentId) return;

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
  }, [contentId, enabled, user]);

  const checkFirstContentWeek = useCallback(async () => {
    if (!enabled || !user || !contentId) return;
    // O primeiro checkpoint de progresso já foi aceito pelo servidor. A decisão
    // semanal e a idempotência pertencem exclusivamente ao backend.
    await processReward({
      actionKey: "FIRST_CONTENT_WEEK",
      userId: user.id,
      contentId,
    });
  }, [user, contentId, enabled, processReward]);

  const trackContentInterest = useCallback(async (action: "watch_50" | "watch_100") => {
    if (!enabled || !user || !contentId) return;

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
  }, [contentId, enabled, user]);

  const handleTimeUpdate = useCallback(async (currentTime: number) => {
    if (!enabled || !contentId || !user || duration === 0) return;

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
    }

    // Persistir progresso e processar recompensas antes de analytics auxiliares.
    // Isso evita que requests nao economicos atrasem os milestones financeiros.
    const floorRealTime = Math.floor(realWatchTime);
    if (floorRealTime >= lastProgressUpdateRef.current + 5 && realWatchTime > 0.5) {
      lastProgressUpdateRef.current = floorRealTime;
      await trackProgressSession(
        user.id,
        contentId,
        watchSessionIdRef.current,
        realWatchTime,
        currentTime,
      );
      await checkFirstContentWeek();
    }

    // A evidencia server-side precisa existir antes da solicitacao da recompensa.
    if (!metricsRecordedRef.current.view15s && realWatchTime >= 15) {
      metricsRecordedRef.current.view15s = true;
      setMetricsRecorded((prev) => ({ ...prev, view15s: true }));
      const result = await processReward({
        actionKey: "VIEW_15S",
        userId: user.id,
        contentId: contentId,
        metadata: { watch_time: realWatchTime },
      });
      if (!result) {
        metricsRecordedRef.current.view15s = false;
        setMetricsRecorded((prev) => ({ ...prev, view15s: false }));
      } else {
        onMilestone?.();
      }
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

  }, [contentId, user, duration, enabled, recordMetric, processReward, trackProgressSession, checkFirstContentWeek, trackContentInterest, onMilestone]);

  const flushProgress = useCallback(async (currentPosition: number, isEnded = false) => {
    if (!enabled || !user || !contentId || duration <= 0) return;
    const realWatchTime = accumulatedWatchTimeRef.current;
    if (realWatchTime <= 0) return;
    await trackProgressSession(
      user.id,
      contentId,
      watchSessionIdRef.current,
      realWatchTime,
      currentPosition,
      isEnded,
    );
  }, [contentId, duration, enabled, trackProgressSession, user]);

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
    accumulatedWatchTimeRef.current = 0;
    previousTimeRef.current = 0;
    watchSessionIdRef.current = globalThis.crypto.randomUUID();
    interestMilestonesRef.current = { half: false, complete: false };
  }, []);

  return {
    handleTimeUpdate,
    flushProgress,
    registerView,
    registerCourseView,
    resetMetrics,
    metricsRecorded,
    currentTime: currentTimeRef.current,
  };
}
