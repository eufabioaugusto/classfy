import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { UserPlus, UserMinus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useToast } from "@/hooks/use-toast";

interface FollowButtonProps {
  creatorId: string;
  size?: "default" | "sm" | "lg" | "icon";
  variant?: "default" | "outline" | "secondary" | "ghost";
}

export function FollowButton({ creatorId, size = "default", variant = "outline" }: FollowButtonProps) {
  const { user } = useAuth();
  const { handleFollow } = useRewardSystem();
  const { toast } = useToast();
  const [isFollowing, setIsFollowing] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkFollowStatus();
  }, [creatorId, user]);

  const checkFollowStatus = async () => {
    if (!user || !creatorId || user.id === creatorId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('follows')
        .select('id')
        .eq('follower_id', user.id)
        .eq('following_id', creatorId)
        .maybeSingle();

      if (error) throw error;
      setIsFollowing(!!data);
    } catch (error) {
      console.error('Error checking follow status:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleFollow = async () => {
    if (!user) {
      toast({
        title: "Login necessário",
        description: "Você precisa estar logado para seguir creators.",
        variant: "destructive",
      });
      return;
    }

    if (user.id === creatorId) return;

    setLoading(true);
    try {
      if (isFollowing) {
        // Unfollow
        const { error } = await supabase
          .from('follows')
          .delete()
          .eq('follower_id', user.id)
          .eq('following_id', creatorId);

        if (error) throw error;

        setIsFollowing(false);
        toast({
          title: "Deixou de seguir",
          description: "Você não segue mais este creator.",
        });
      } else {
        // Follow
        const { error } = await supabase
          .from('follows')
          .insert({
            follower_id: user.id,
            following_id: creatorId,
          });

        if (error) throw error;

        setIsFollowing(true);
        
        // Trigger reward
        await handleFollow(user.id, creatorId);

        toast({
          title: "Seguindo!",
          description: "Agora você segue este creator.",
        });
      }
    } catch (error: any) {
      console.error('Error toggling follow:', error);
      toast({
        title: "Erro",
        description: error.message || "Não foi possível completar a ação.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.id === creatorId) return null;

  return (
    <Button
      onClick={toggleFollow}
      disabled={loading}
      size={size}
      variant={variant}
      className="gap-2"
    >
      {isFollowing ? (
        <>
          <UserMinus className="h-4 w-4" />
          Seguindo
        </>
      ) : (
        <>
          <UserPlus className="h-4 w-4" />
          Seguir
        </>
      )}
    </Button>
  );
}
