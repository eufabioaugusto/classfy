import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ProcessRewardParams {
  actionKey: string;
  userId: string;
  contentId?: string;
  metadata?: Record<string, any>;
}

export function useRewardSystem() {
  const processReward = async ({
    actionKey,
    userId,
    contentId,
    metadata = {},
  }: ProcessRewardParams) => {
    try {
      const { data, error } = await supabase.functions.invoke('process-reward', {
        body: {
          actionKey,
          userId,
          contentId,
          metadata,
        },
      });

      if (error) throw error;

      if (data?.rewards && data.rewards.length > 0) {
        // Show toast for user rewards
        const userReward = data.rewards.find((r: any) => r.user_id === userId);
        if (userReward && (userReward.points > 0 || userReward.value > 0)) {
          toast({
            title: "🎉 Recompensa recebida!",
            description: `Você ganhou ${userReward.points} pontos e R$ ${userReward.value.toFixed(2)}!`,
          });
        }
      }

      return data;
    } catch (error) {
      console.error('Error processing reward:', error);
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
    // Check if already logged in today
    const today = new Date().toISOString().split('T')[0];
    const lastLogin = localStorage.getItem(`lastLogin_${userId}`);
    
    if (lastLogin !== today) {
      localStorage.setItem(`lastLogin_${userId}`, today);
      
      // Update streak
      const { data: streak } = await supabase
        .from('user_login_streaks')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      if (streak) {
        const isConsecutive = streak.last_login_date === yesterdayStr;
        const newStreak = isConsecutive ? streak.current_streak + 1 : 1;
        const newLongest = Math.max(newStreak, streak.longest_streak);

        await supabase
          .from('user_login_streaks')
          .update({
            current_streak: newStreak,
            longest_streak: newLongest,
            last_login_date: today,
          })
          .eq('user_id', userId);
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

      await processReward({
        actionKey: 'DAILY_LOGIN',
        userId,
        metadata: { date: today },
      });
    }
  };

  const checkCourseCompletion = async (userId: string, courseId: string) => {
    // Get all lessons from course
    const { data: courseLessons } = await supabase
      .from('contents')
      .select('id')
      .eq('category_id', courseId); // Assuming courses are categories with lessons

    if (!courseLessons || courseLessons.length === 0) return;

    // Check if all lessons are completed
    const { data: completedLessons } = await supabase
      .from('user_progress')
      .select('content_id')
      .eq('user_id', userId)
      .eq('completed', true)
      .in('content_id', courseLessons.map(l => l.id));

    if (completedLessons && completedLessons.length === courseLessons.length) {
      await processReward({
        actionKey: 'COMPLETE_COURSE',
        userId,
        contentId: courseId,
        metadata: { lessonCount: courseLessons.length },
      });
    }
  };

  const trackProgress = async (
    userId: string,
    contentId: string,
    currentPercent: number,
    duration: number
  ) => {
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

      // Trigger rewards based on progress
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
    } catch (error) {
      console.error('Error tracking progress:', error);
    }
  };

  return {
    processReward,
    trackProgress,
    handleLike,
    handleSave,
    handleFavorite,
    handleComment,
    handleFollow,
    checkDailyLogin,
    checkCourseCompletion,
  };
}
