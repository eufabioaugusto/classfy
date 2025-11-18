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
  };
}
