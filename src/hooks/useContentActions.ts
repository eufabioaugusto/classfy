import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "@/hooks/use-toast";
import { useParticleBurst } from "@/hooks/useParticleBurst";

interface UseContentActionsProps {
  contentId: string;
  isCourse?: boolean;
  hasAccess?: boolean;
}

interface UnlikeConfirmation {
  pending: boolean;
  rewardValue: number;
}

export function useContentActions({ contentId, isCourse = false, hasAccess = true }: UseContentActionsProps) {
  const { user, profile, role } = useAuth();
  const { handleLike: rewardLike, handleSave: rewardSave, handleFavorite: rewardFavorite, reverseReward } = useRewardSystem();
  const { isBursting: isLikeBursting, triggerBurst: triggerLikeBurst } = useParticleBurst();

  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [unlikeConfirmation, setUnlikeConfirmation] = useState<UnlikeConfirmation>({ pending: false, rewardValue: 0 });

  // Check initial status
  useEffect(() => {
    if (!user || !contentId) {
      setLoading(false);
      return;
    }

    const checkStatus = async () => {
      try {
        const [likeResult, savedResult, favoriteResult, countResult] = await Promise.all([
          // Check like
          supabase
            .from("actions")
            .select("id")
            .eq("user_id", user.id)
            .eq("type", "LIKE")
            .eq(isCourse ? "course_id" : "content_id", contentId)
            .maybeSingle(),
          // Check saved
          supabase
            .from("saved_contents")
            .select("id")
            .eq("user_id", user.id)
            .eq(isCourse ? "course_id" : "content_id", contentId)
            .maybeSingle(),
          // Check favorite
          supabase
            .from("favorites")
            .select("id")
            .eq("user_id", user.id)
            .eq(isCourse ? "course_id" : "content_id", contentId)
            .maybeSingle(),
          // Get likes count
          supabase
            .from(isCourse ? "courses" : "contents")
            .select("likes_count")
            .eq("id", contentId)
            .single(),
        ]);

        setIsLiked(!!likeResult.data);
        setIsSaved(!!savedResult.data);
        setIsFavorited(!!favoriteResult.data);
        setLikesCount(countResult.data?.likes_count || 0);
      } catch (error) {
        console.error("Error checking action status:", error);
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
  }, [user, contentId, isCourse]);

  const refreshLikesCount = useCallback(async () => {
    const table = isCourse ? "courses" : "contents";
    const { data } = await supabase
      .from(table)
      .select("likes_count")
      .eq("id", contentId)
      .single();

    if (data) {
      setLikesCount(data.likes_count || 0);
    }
  }, [contentId, isCourse]);

  const refreshLikesCountEventually = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 250));
    await refreshLikesCount();
    await new Promise((r) => setTimeout(r, 250));
    await refreshLikesCount();
  }, [refreshLikesCount]);

  // Get reward PP for this like (if any)
  const getLikeRewardPoints = useCallback(async (): Promise<number> => {
    if (!user) return 0;

    const { data, error } = await supabase
      .from("reward_events")
      .select("performance_points, created_at")
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .eq("action_key", "LIKE_CONTENT")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("Could not fetch like reward points:", error);
      return 0;
    }

    return data?.performance_points || 0;
  }, [user, contentId]);

  const toggleLike = useCallback(async () => {
    if (!user) {
      toast({
        title: "Login necessário",
        description: "Faça login para curtir este conteúdo",
        variant: "destructive",
      });
      return;
    }

    try {
      if (isLiked) {
        // Check if there's a reward to reverse
        const rewardPoints = await getLikeRewardPoints();
        
        if (rewardPoints > 0) {
          // Show confirmation pending - will be handled by confirmUnlike
          setUnlikeConfirmation({ pending: true, rewardValue: rewardPoints });
          return;
        }
        
        // No reward to reverse, just unlike
        await performUnlike();
      } else {
        const insertData: any = {
          user_id: user.id,
          type: "LIKE",
          [isCourse ? "course_id" : "content_id"]: contentId,
        };

        const { error } = await supabase.from("actions").insert(insertData);

        if (!error) {
          setIsLiked(true);
          setLikesCount((prev) => prev + 1);
          triggerLikeBurst();
          
          // Only give reward if user has access to the content
          if (hasAccess) {
            await rewardLike(user.id, contentId, true);
          }
        } else if (error.code === "23505") {
          setIsLiked(true);
        } else {
          throw error;
        }
      }

      await refreshLikesCountEventually();
    } catch (error) {
      console.error("Error toggling like:", error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  }, [user, isLiked, contentId, isCourse, triggerLikeBurst, rewardLike, refreshLikesCountEventually, hasAccess, getLikeRewardPoints]);

  const performUnlike = useCallback(async () => {
    if (!user) return;
    
    const { data: deleted } = await supabase
      .from("actions")
      .delete()
      .eq("user_id", user.id)
      .eq("type", "LIKE")
      .eq(isCourse ? "course_id" : "content_id", contentId)
      .select("id");

    setIsLiked(false);
    if ((deleted?.length || 0) > 0) {
      setLikesCount((prev) => Math.max(0, prev - 1));
    }
    await refreshLikesCountEventually();
  }, [user, contentId, isCourse, refreshLikesCountEventually]);

  const confirmUnlike = useCallback(async () => {
    if (!user || !unlikeConfirmation.pending) return;
    
    try {
      // Reverse the reward
      await reverseReward(user.id, contentId, "LIKE_CONTENT");
      
      // Perform the unlike
      await performUnlike();
      
      toast({
        title: "Like removido",
        description: `${Math.floor(unlikeConfirmation.rewardValue)} pontos de performance deduzidos`,
      });
    } catch (error) {
      console.error("Error confirming unlike:", error);
      toast({
        title: "Erro",
        description: "Não foi possível remover o like",
        variant: "destructive",
      });
    } finally {
      setUnlikeConfirmation({ pending: false, rewardValue: 0 });
    }
  }, [user, contentId, unlikeConfirmation, performUnlike, reverseReward]);

  const cancelUnlike = useCallback(() => {
    setUnlikeConfirmation({ pending: false, rewardValue: 0 });
  }, []);

  const toggleSave = useCallback(async () => {
    if (!user) {
      toast({
        title: "Login necessário",
        description: "Faça login para salvar este conteúdo",
        variant: "destructive",
      });
      return;
    }

    try {
      if (isSaved) {
        await supabase
          .from("saved_contents")
          .delete()
          .eq("user_id", user.id)
          .eq(isCourse ? "course_id" : "content_id", contentId);

        setIsSaved(false);
        toast({
          title: "Removido dos salvos",
          description: "Conteúdo removido da sua lista",
        });
      } else {
        await supabase.from("saved_contents").insert({
          user_id: user.id,
          [isCourse ? "course_id" : "content_id"]: contentId,
        });

        setIsSaved(true);
        await rewardSave(user.id, contentId);
      }
    } catch (error) {
      console.error("Error toggling save:", error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  }, [user, isSaved, contentId, isCourse, rewardSave]);

  const toggleFavorite = useCallback(async () => {
    if (!user) {
      toast({
        title: "Login necessário",
        description: "Faça login para favoritar este conteúdo",
        variant: "destructive",
      });
      return;
    }

    try {
      if (isFavorited) {
        await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq(isCourse ? "course_id" : "content_id", contentId);

        setIsFavorited(false);
        toast({
          title: "Removido dos favoritos",
          description: "Conteúdo removido dos seus favoritos",
        });
      } else {
        await supabase.from("favorites").insert({
          user_id: user.id,
          [isCourse ? "course_id" : "content_id"]: contentId,
        });

        setIsFavorited(true);
        await rewardFavorite(user.id, contentId);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  }, [user, isFavorited, contentId, isCourse, rewardFavorite]);

  const formatCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  return {
    isLiked,
    isSaved,
    isFavorited,
    likesCount,
    loading,
    isLikeBursting,
    unlikeConfirmation,
    toggleLike,
    toggleSave,
    toggleFavorite,
    confirmUnlike,
    cancelUnlike,
    formatCount,
    refreshLikesCount,
  };
}
