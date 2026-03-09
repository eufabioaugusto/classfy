import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useRef } from "react";

interface ProcessRewardParams {
  actionKey: string;
  userId: string;
  contentId?: string;
  metadata?: Record<string, any>;
}

// Session-level tracking to prevent duplicate calls
const sessionRewardTracker = new Set<string>();

export function useRewardSystem() {
  // Track in-flight reward processing to prevent duplicates
  const processingRewards = useRef<Set<string>>(new Set());

  const processReward = async ({
    actionKey,
    userId,
    contentId,
    metadata = {},
  }: ProcessRewardParams) => {
    // Create unique key for this reward based on action type
    const today = new Date().toISOString().split('T')[0];
    let rewardKey: string;
    
    // Match the server-side tracking key logic
    const dailyActions = ['DAILY_LOGIN', 'FIRST_CONTENT_WEEK', 'BINGE_WATCH'];
    const uniquePerContentActions = ['LIKE_CONTENT', 'SAVE_CONTENT', 'FAVORITE_CONTENT', 'WATCH_50', 'WATCH_100', 'COMMENT_CONTENT', 'VIEW_15S', 'SHARE_CONTENT'];
    
    if (dailyActions.includes(actionKey)) {
      rewardKey = `${actionKey}_${userId}_${today}`;
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
        return null;
      }

      if (data?.rewards && data.rewards.length > 0) {
        const userReward = data.rewards.find((r: any) => r.user_id === userId);
        if (userReward && (userReward.points > 0 || userReward.performance_points > 0)) {
          const pts = Number(userReward.points);
          const ptsDisplay = pts % 1 === 0 ? pts.toString() : pts.toFixed(2);
          toast({
            title: "🎉 Recompensa recebida!",
            description: `+${ptsDisplay} pontos de performance`,
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
  };

  const reverseReward = async (userId: string, contentId: string, actionKey: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("reverse-reward", {
        body: {
          actionKey,
          userId,
          contentId,
        },
      });

      if (error) throw error;

      // Keep client-side trackers aligned with server reversal
      const rewardKey = `${actionKey}_${userId}_${contentId}`;
      sessionRewardTracker.delete(rewardKey);

      return data;
    } catch (error) {
      console.error("Error reversing reward:", error);
      return null;
    }
  };

  const handleLike = async (userId: string, contentId: string, isLiking: boolean) => {
    if (!isLiking) return; // Only reward on like, not unlike
    
    await processReward({
      actionKey: 'LIKE_CONTENT',
      userId,
      contentId,
      metadata: { action: 'like' },
    });
  };

  const handleSave = async (userId: string, contentId: string) => {
    await processReward({
      actionKey: 'SAVE_CONTENT',
      userId,
      contentId,
      metadata: { action: 'save' },
    });
  };

  const handleFavorite = async (userId: string, contentId: string) => {
    await processReward({
      actionKey: 'FAVORITE_CONTENT',
      userId,
      contentId,
      metadata: { action: 'favorite' },
    });
  };

  const handleComment = async (userId: string, contentId: string, commentText: string) => {
    await processReward({
      actionKey: 'COMMENT_CONTENT',
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
    // Server-side validation handles duplicate prevention via reward_action_tracking table
    const today = new Date().toISOString().split('T')[0];
    
    // Update streak (server will handle if already done today)
    const { data: streak } = await supabase
      .from('user_login_streaks')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let currentStreak = 1;

    if (streak) {
      // Only update if not already logged in today
      if (streak.last_login_date !== today) {
        const isConsecutive = streak.last_login_date === yesterdayStr;
        currentStreak = isConsecutive ? (streak.current_streak || 0) + 1 : 1;
        const newLongest = Math.max(currentStreak, streak.longest_streak || 0);

        await supabase
          .from('user_login_streaks')
          .update({
            current_streak: currentStreak,
            longest_streak: newLongest,
            last_login_date: today,
          })
          .eq('user_id', userId);
      } else {
        currentStreak = streak.current_streak || 1;
      }
    } else {
      await supabase
        .from('user_login_streaks')
        .insert({
          user_id: userId,
          current_streak: 1,
          longest_streak: 1,
          last_login_date: today,
        });
    }

    // Server validates via reward_action_tracking - will skip if already rewarded today
    await processReward({
      actionKey: 'DAILY_LOGIN',
      userId,
      metadata: { date: today },
    });

    // Check WEEKLY_STREAK: reward when streak reaches 7 (or multiples)
    if (currentStreak >= 7 && currentStreak % 7 === 0) {
      await processReward({
        actionKey: 'WEEKLY_STREAK',
        userId,
        metadata: { streak: currentStreak, date: today },
      });
    }
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

  const trackProgress = async (
    userId: string,
    contentId: string,
    currentPercent: number,
    duration: number
  ) => {
    try {
      // Create unique key for this progress update
      const progressKey = `progress_${userId}_${contentId}`;
      
      // Prevent multiple simultaneous updates
      if (processingRewards.current.has(progressKey)) {
        return;
      }
      
      processingRewards.current.add(progressKey);

      try {
        // Check if user already has progress record
        const { data: existingProgress } = await supabase
          .from('user_progress')
          .select('*')
          .eq('user_id', userId)
          .eq('content_id', contentId)
          .single();

        const progressData = {
          user_id: userId,
          content_id: contentId,
          progress_percent: Math.floor(currentPercent),
          last_position_seconds: Math.floor(duration),
          completed: currentPercent >= 95,
          completed_at: currentPercent >= 95 ? new Date().toISOString() : null,
        };

        if (existingProgress) {
          await supabase
            .from('user_progress')
            .update(progressData)
            .eq('id', existingProgress.id);
        } else {
          await supabase.from('user_progress').insert(progressData);
        }

        // Trigger rewards based on progress (only if not already at that milestone)
        if (currentPercent >= 50 && (!existingProgress || existingProgress.progress_percent < 50)) {
          await processReward({
            actionKey: 'WATCH_50',
            userId,
            contentId,
            metadata: { progress: 50 },
          });
        }

        if (currentPercent >= 95 && (!existingProgress || existingProgress.progress_percent < 95)) {
          await processReward({
            actionKey: 'WATCH_100',
            userId,
            contentId,
            metadata: { progress: 100 },
          });
        }
      } finally {
        // Remove from processing after a short delay
        setTimeout(() => {
          processingRewards.current.delete(progressKey);
        }, 1000);
      }
    } catch (error) {
      console.error('Error tracking progress:', error);
    }
  };

  return {
    processReward,
    reverseReward,
    trackProgress,
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
