import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useRewardSystem } from "./useRewardSystem";

export function useProfileComplete(userId: string | undefined, profile: any) {
  const { processReward } = useRewardSystem();

  useEffect(() => {
    const checkProfileComplete = async () => {
      if (!userId || !profile) return;

      const isComplete = !!(
        profile.display_name &&
        profile.avatar_url &&
        profile.bio
      );

      if (isComplete) {
        // Check if reward was already given
        const { data: existingReward } = await supabase
          .from('reward_action_tracking')
          .select('id')
          .eq('user_id', userId)
          .eq('action_key', 'PROFILE_COMPLETE')
          .maybeSingle();

        if (!existingReward) {
          await processReward({
            actionKey: 'PROFILE_COMPLETE',
            userId,
            metadata: { completedAt: new Date().toISOString() },
          });
        }
      }
    };

    checkProfileComplete();
  }, [userId, profile, processReward]);
}
