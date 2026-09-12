import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "@/hooks/use-toast";
import { useParticleBurst } from "@/hooks/useParticleBurst";
import { trackUserInteraction } from "@/lib/personalization/interests";

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

  // Get Points for this like (if any)
  const getLikeRewardPoints = useCallback(async (): Promise<number> => {
    if (!user) return 0;

    let query = supabase
      .from("reward_events")
      .select("points, created_at")
      .eq("user_id", user.id)
      .eq("action_key", "LIKE")
      .order("created_at", { ascending: false })
      .limit(1);
    query = isCourse
      ? query.contains("metadata", { course_id: contentId })
      : query.eq("content_id", contentId);
    const { data, error } = await query.maybeSingle();

    if (error) {
      console.warn("Could not fetch like reward points:", error);
      return 0;
    }

    return data?.points || 0;
  }, [user, contentId, isCourse]);

  const trackContentInterest = useCallback(async (action: "like" | "save" | "favorite") => {
    if (!user || isCourse) return;

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
  }, [contentId, isCourse, user]);

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
        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
        triggerLikeBurst();

        const insertData: any = {
          user_id: user.id,
          type: "LIKE",
          [isCourse ? "course_id" : "content_id"]: contentId,
        };

        const { error } = await supabase.from("actions").insert(insertData);

        if (!error) {
          // Only give reward if user has access to the content
          if (hasAccess) {
            await rewardLike(user.id, contentId, true);
          }
          await trackContentInterest("like");
        } else if (error.code === "23505") {
          setIsLiked(true);
        } else {
          setIsLiked(false);
          setLikesCount((prev) => Math.max(0, prev - 1));
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
  }, [user, isLiked, contentId, isCourse, triggerLikeBurst, rewardLike, refreshLikesCountEventually, hasAccess, getLikeRewardPoints, trackContentInterest]);

  const performUnlike = useCallback(async () => {
    if (!user) return;

    const reversal = await reverseReward(user.id, contentId, "LIKE");
    if (!reversal) throw new Error("Reward reversal failed");

    setIsLiked(false);
    if (reversal.action_removed) {
      setLikesCount((prev) => Math.max(0, prev - 1));
    }
    await refreshLikesCountEventually();
  }, [user, contentId, refreshLikesCountEventually, reverseReward]);

  const confirmUnlike = useCallback(async () => {
    if (!user || !unlikeConfirmation.pending) return;
    
    try {
      // O backend remove o like e reverte o evento na mesma transacao.
      const reversal = await reverseReward(user.id, contentId, "LIKE");
      if (!reversal) throw new Error("Reward reversal failed");
      setIsLiked(false);
      if (reversal.action_removed) {
        setLikesCount((prev) => Math.max(0, prev - 1));
      }
      await refreshLikesCountEventually();

      const revertedPoints = Number(reversal.points || 0);
      toast({
        title: "Like removido",
        description: revertedPoints > 0
          ? `${revertedPoints} Points deduzidos`
          : "O like foi removido",
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
  }, [user, contentId, unlikeConfirmation, refreshLikesCountEventually, reverseReward]);

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
        const reversal = await reverseReward(user.id, contentId, "SAVE");
        if (!reversal) throw new Error("Reward reversal failed");
        setIsSaved(false);
        const revertedPoints = Number(reversal.points || 0);
        toast({
          title: "Removido dos salvos",
          description: revertedPoints > 0
            ? `${revertedPoints} Points deduzidos e conteúdo removido da sua lista`
            : "Conteúdo removido da sua lista",
        });
      } else {
        setIsSaved(true);
        const { error } = await supabase.from("saved_contents").insert({
          user_id: user.id,
          [isCourse ? "course_id" : "content_id"]: contentId,
        });
        if (error) {
          setIsSaved(false);
          throw error;
        }
        await rewardSave(user.id, contentId);
        await trackContentInterest("save");
      }
    } catch (error) {
      console.error("Error toggling save:", error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  }, [user, isSaved, contentId, isCourse, rewardSave, reverseReward, trackContentInterest]);

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
        const reversal = await reverseReward(user.id, contentId, "FAVORITE");
        if (!reversal) throw new Error("Reward reversal failed");
        setIsFavorited(false);
        const revertedPoints = Number(reversal.points || 0);
        toast({
          title: "Removido dos favoritos",
          description: revertedPoints > 0
            ? `${revertedPoints} Points deduzidos e conteúdo removido dos favoritos`
            : "Conteúdo removido dos seus favoritos",
        });
      } else {
        setIsFavorited(true);
        const { error } = await supabase.from("favorites").insert({
          user_id: user.id,
          [isCourse ? "course_id" : "content_id"]: contentId,
        });
        if (error) {
          setIsFavorited(false);
          throw error;
        }
        await rewardFavorite(user.id, contentId);
        await trackContentInterest("favorite");
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  }, [user, isFavorited, contentId, isCourse, rewardFavorite, reverseReward, trackContentInterest]);

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
