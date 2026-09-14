import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCallback, useRef } from "react";
import { dispatchRewardEarned } from "@/lib/rewards/events";

interface ProcessRewardParams {
  actionKey: string;
  userId: string;
  contentId?: string;
  metadata?: Record<string, any>;
}

// Session-level tracking to prevent duplicate calls
const sessionRewardTracker = new Set<string>();

const getBrazilDateString = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
};

export function useRewardSystem() {
  // Track in-flight reward processing to prevent duplicates
  const processingRewards = useRef<Set<string>>(new Set());
  const progressCheckpoints = useRef<Map<string, number>>(new Map());
  const pendingProgress = useRef<Map<string, {
    userId: string;
    contentId: string;
    watchedSeconds: number;
    currentPosition: number;
  }>>(new Map());
  const progressDrains = useRef<Map<string, Promise<void>>>(new Map());
  const pendingSessionProgress = useRef<Map<string, {
    userId: string;
    contentId: string;
    sessionId: string;
    watchedSeconds: number;
    currentPosition: number;
    isEnded: boolean;
  }>>(new Map());
  const sessionProgressDrains = useRef<Map<string, Promise<void>>>(new Map());

  const processReward = useCallback(async ({
    actionKey,
    userId,
    contentId,
    metadata = {},
  }: ProcessRewardParams) => {
    // Create unique key for this reward based on action type
    const today = getBrazilDateString();
    let rewardKey: string;
    
    // Match the server-side tracking key logic
    const dailyActions = ['DAILY_LOGIN'];
    const weeklyActions = ['FIRST_CONTENT_WEEK', 'WEEKLY_STREAK'];
    const uniquePerContentActions = ['LIKE', 'SAVE', 'FAVORITE', 'WATCH_50', 'WATCH_100', 'COMMENT', 'VIEW_15S', 'SHARE'];
    
    if (dailyActions.includes(actionKey)) {
      rewardKey = `${actionKey}_${userId}_${today}`;
    } else if (weeklyActions.includes(actionKey)) {
      const day = new Date(`${today}T12:00:00-03:00`);
      const weekday = day.getDay();
      day.setDate(day.getDate() - (weekday === 0 ? 6 : weekday - 1));
      rewardKey = `${actionKey}_${userId}_${getBrazilDateString(day)}`;
    } else if (uniquePerContentActions.includes(actionKey) && contentId) {
      rewardKey = `${actionKey}_${userId}_${contentId}`;
    } else if (metadata?.creatorId) {
      rewardKey = `${actionKey}_${userId}_${metadata.creatorId}`;
    } else {
      rewardKey = `${actionKey}_${userId}_${contentId || 'no-content'}`;
    }
    
    // Check session-level tracker first (survives component re-renders)
    if (sessionRewardTracker.has(rewardKey)) {
      console.log('Skipping reward (session tracker):', rewardKey);
      return null;
    }
    
    // If already processing, skip
    if (processingRewards.current.has(rewardKey)) {
      console.log('Skipping duplicate reward call (in-flight):', rewardKey);
      return null;
    }

    // Mark as processing in both trackers
    processingRewards.current.add(rewardKey);
    sessionRewardTracker.add(rewardKey);

    try {
      console.log('Processing reward:', { actionKey, rewardKey });
      
      const { data, error } = await supabase.functions.invoke('process-reward', {
        body: {
          actionKey,
          userId,
          contentId,
          metadata,
        },
      });

      if (error) throw error;

      // If already tracked on server, keep in session tracker
      if (data?.alreadyTracked) {
        console.log('Reward already tracked on server:', rewardKey);
        return data;
      }

      if (data?.rewards && data.rewards.length > 0) {
        const userReward = data.rewards.find((r: any) => r.user_id === userId);
        if (userReward && userReward.points > 0) {
          const pts = Number(userReward.points);
          const ptsDisplay = pts % 1 === 0 ? pts.toString() : pts.toFixed(2);
          dispatchRewardEarned({
            actionKey,
            userId,
            contentId,
            points: pts,
            pointType: userReward.point_type === "creator" ? "creator" : "user",
          });
          toast({
            title: "🎉 Recompensa recebida!",
            description: `+${ptsDisplay} Points`,
          });
        }
      }

      return data;
    } catch (error) {
      console.error('Error processing reward:', error);
      // On error, remove from session tracker to allow retry
      sessionRewardTracker.delete(rewardKey);
      return null;
    } finally {
      // Remove from in-flight tracker
      processingRewards.current.delete(rewardKey);
    }
  }, []);

  const reverseReward = useCallback(async (userId: string, targetId: string, actionKey: string) => {
    const normalizedActionKey = actionKey.trim().toUpperCase();
    const rewardKey = `${normalizedActionKey}_${userId}_${targetId}`;

    try {
      const { data, error } = await supabase.functions.invoke("reverse-reward", {
        body: {
          actionKey: normalizedActionKey,
          userId,
          targetId,
        },
      });

      if (error) throw error;

      if (data?.action_removed || data?.tracking_released || data?.reversed) {
        // A chave local precisa acompanhar o estado ativo do servidor. Sem
        // isso, uma nova ativacao valida continuaria bloqueada ate recarregar.
        sessionRewardTracker.delete(rewardKey);
        processingRewards.current.delete(rewardKey);
      }

      if (data?.reversed && Number(data?.points || 0) > 0) {
        dispatchRewardEarned({
          actionKey: normalizedActionKey,
          userId,
          contentId: targetId,
          points: -Number(data.points),
          pointType: "user",
        });
      }

      return data;
    } catch (error) {
      console.error("Error reversing reward:", error);
      return null;
    }
  }, []);

  const handleLike = async (userId: string, contentId: string, isLiking: boolean) => {
    if (!isLiking) return; // Only reward on like, not unlike
    
    await processReward({
      actionKey: 'LIKE',
      userId,
      contentId,
      metadata: { action: 'like' },
    });
  };

  const handleSave = async (userId: string, contentId: string) => {
    await processReward({
      actionKey: 'SAVE',
      userId,
      contentId,
      metadata: { action: 'save' },
    });
  };

  const handleFavorite = async (userId: string, contentId: string) => {
    await processReward({
      actionKey: 'FAVORITE',
      userId,
      contentId,
      metadata: { action: 'favorite' },
    });
  };

  const handleComment = async (userId: string, contentId: string, commentText: string) => {
    await processReward({
      actionKey: 'COMMENT',
      userId,
      contentId,
      metadata: { commentLength: commentText.length },
    });
  };

  const handleFollow = async (userId: string, creatorId: string) => {
    await processReward({
      actionKey: 'SUBSCRIBE_CREATOR',
      userId,
      contentId: undefined,
      metadata: { creatorId },
    });
  };

  const checkDailyLogin = async (userId: string) => {
    const today = getBrazilDateString();
    const dailyResult = await processReward({
      actionKey: 'DAILY_LOGIN',
      userId,
      metadata: { date: today },
    });
    if (Number(dailyResult?.currentStreak || 0) >= 7) {
      await processReward({ actionKey: 'WEEKLY_STREAK', userId, metadata: { date: today } });
    }
    return dailyResult !== null;
  };

  const checkCourseCompletion = async (userId: string, courseId: string) => {
    // Get all lessons from the course
    const { data: courseLessons } = await supabase
      .from('course_lessons')
      .select('id')
      .eq('course_id', courseId);

    if (!courseLessons || courseLessons.length === 0) return;

    // Check enrollment and completed lessons
    const { data: enrollment } = await supabase
      .from('course_enrollments')
      .select('completed_lessons')
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .maybeSingle();

    if (!enrollment) return;

    const completedLessonIds = enrollment.completed_lessons || [];
    const allLessonIds = courseLessons.map(l => l.id);
    const allCompleted = allLessonIds.every(id => completedLessonIds.includes(id));

    if (allCompleted) {
      await processReward({
        actionKey: 'COMPLETE_COURSE',
        userId,
        contentId: courseId,
        metadata: { lessonCount: courseLessons.length },
      });
    }
  };

  const checkProfileCompletion = async (userId: string) => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url, bio')
        .eq('id', userId)
        .single();

      // Profile is complete if has all basic info
      if (profile?.display_name && profile?.avatar_url && profile?.bio) {
        await processReward({
          actionKey: 'PROFILE_COMPLETE',
          userId,
        });
      }
    } catch (error) {
      console.error('Error checking profile completion:', error);
    }
  };

  const trackProgress = useCallback(async (
    userId: string,
    contentId: string,
    _currentPercent: number,
    watchedSeconds: number,
    currentPosition = watchedSeconds,
  ) => {
    const progressKey = `progress_${userId}_${contentId}`;
    const queued = pendingProgress.current.get(progressKey);
    if (!queued || watchedSeconds >= queued.watchedSeconds) {
      pendingProgress.current.set(progressKey, {
        userId,
        contentId,
        watchedSeconds,
        currentPosition,
      });
    }

    let drain = progressDrains.current.get(progressKey);
    if (!drain) {
      drain = (async () => {
        while (pendingProgress.current.has(progressKey)) {
          const request = pendingProgress.current.get(progressKey)!;
          pendingProgress.current.delete(progressKey);

          const watchedFloor = Math.floor(request.watchedSeconds);
          const previousCheckpoint = progressCheckpoints.current.get(progressKey) || 0;
          const watchedDelta = watchedFloor - previousCheckpoint;
          if (watchedDelta <= 0) continue;

          try {
            const { data, error } = await supabase.rpc("record_content_progress_v1", {
              p_content_id: request.contentId,
              p_watched_delta: watchedDelta,
              p_last_position_seconds: Math.floor(request.currentPosition),
            });
            if (error) throw error;

            const result = data as {
              accepted_watched_delta?: number;
              progress_percent?: number;
            } | null;
            const acceptedDelta = Math.max(0, Number(result?.accepted_watched_delta || 0));
            progressCheckpoints.current.set(progressKey, previousCheckpoint + acceptedDelta);
            const serverProgress = Number(result?.progress_percent || 0);

            // Ledger e tracking do servidor sao a fonte de idempotencia. A fila
            // impede que o checkpoint final seja perdido por concorrencia.
            if (serverProgress >= 50) {
              await processReward({
                actionKey: 'WATCH_50',
                userId: request.userId,
                contentId: request.contentId,
                metadata: { progress: 50 },
              });
            }

            if (serverProgress >= 100) {
              await processReward({
                actionKey: 'WATCH_100',
                userId: request.userId,
                contentId: request.contentId,
                metadata: { progress: 100 },
              });
            }
          } catch (error) {
            console.error('Error tracking progress:', error);
          }
        }
      })().finally(() => {
        progressDrains.current.delete(progressKey);
      });
      progressDrains.current.set(progressKey, drain);
    }

    await drain;

    // Uma nova leitura pode entrar exatamente entre o ultimo teste do `while`
    // e o `finally` que libera a fila. Nesse caso ela fica pendente, mas nao
    // pode depender de outro `timeupdate` (o video pode ter acabado).
    const pending = pendingProgress.current.get(progressKey);
    if (pending && !progressDrains.current.has(progressKey)) {
      await trackProgress(
        pending.userId,
        pending.contentId,
        _currentPercent,
        pending.watchedSeconds,
        pending.currentPosition,
      );
    }
  }, [processReward]);

  const trackProgressSession = useCallback(async (
    userId: string,
    contentId: string,
    sessionId: string,
    watchedSeconds: number,
    currentPosition: number,
    isEnded = false,
  ) => {
    const progressKey = `progress_session_${sessionId}`;
    const queued = pendingSessionProgress.current.get(progressKey);
    if (!queued || watchedSeconds >= queued.watchedSeconds) {
      pendingSessionProgress.current.set(progressKey, {
        userId,
        contentId,
        sessionId,
        watchedSeconds,
        currentPosition,
        isEnded: isEnded || Boolean(queued?.isEnded),
      });
    }

    let drain = sessionProgressDrains.current.get(progressKey);
    if (!drain) {
      drain = (async () => {
        while (pendingSessionProgress.current.has(progressKey)) {
          const request = pendingSessionProgress.current.get(progressKey)!;
          pendingSessionProgress.current.delete(progressKey);

          try {
            const { data, error } = await supabase.rpc("record_content_progress_v2", {
              p_content_id: request.contentId,
              p_session_id: request.sessionId,
              p_session_watched_seconds: Math.floor(request.watchedSeconds),
              p_last_position_seconds: Math.floor(request.currentPosition),
              p_is_ended: request.isEnded,
            });
            if (error) throw error;

            const result = data as {
              progress_percent?: number;
            } | null;
            const serverProgress = Number(result?.progress_percent || 0);

            if (serverProgress >= 50) {
              await processReward({
                actionKey: "WATCH_50",
                userId: request.userId,
                contentId: request.contentId,
                metadata: { progress: 50, sessionId: request.sessionId },
              });
            }

            if (serverProgress >= 100) {
              await processReward({
                actionKey: "WATCH_100",
                userId: request.userId,
                contentId: request.contentId,
                metadata: { progress: 100, sessionId: request.sessionId },
              });
            }
          } catch (error) {
            console.error("Error tracking session progress:", error);
          }
        }
      })().finally(() => {
        sessionProgressDrains.current.delete(progressKey);
      });
      sessionProgressDrains.current.set(progressKey, drain);
    }

    await drain;

    // Preserva o ultimo checkpoint quando ele chega no limite entre o loop e
    // o finally. O total cumulativo torna essa repeticao idempotente no banco.
    const pending = pendingSessionProgress.current.get(progressKey);
    if (pending && !sessionProgressDrains.current.has(progressKey)) {
      await trackProgressSession(
        pending.userId,
        pending.contentId,
        pending.sessionId,
        pending.watchedSeconds,
        pending.currentPosition,
        pending.isEnded,
      );
    }
  }, [processReward]);

  return {
    processReward,
    reverseReward,
    trackProgress,
    trackProgressSession,
    handleLike,
    handleSave,
    handleFavorite,
    handleComment,
    handleFollow,
    checkDailyLogin,
    checkCourseCompletion,
    checkProfileCompletion,
  };
}
