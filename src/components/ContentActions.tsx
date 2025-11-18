import { useState, useEffect } from "react";
import { Heart, Bookmark, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "@/hooks/use-toast";

interface ContentActionsProps {
  contentId: string;
}

export function ContentActions({ contentId }: ContentActionsProps) {
  const { user } = useAuth();
  const { handleLike, handleSave, handleFavorite } = useRewardSystem();
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    // Check if user already liked, saved, favorited
    const checkStatus = async () => {
      // Check likes (we need to create this table if it doesn't exist)
      const { data: likeData } = await supabase
        .from('actions')
        .select('id')
        .eq('user_id', user.id)
        .eq('content_id', contentId)
        .eq('type', 'LIKE')
        .maybeSingle();

      setIsLiked(!!likeData);

      // Check saved
      const { data: savedData } = await supabase
        .from('saved_contents')
        .select('id')
        .eq('user_id', user.id)
        .eq('content_id', contentId)
        .maybeSingle();

      setIsSaved(!!savedData);

      // Check favorited
      const { data: favoriteData } = await supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id)
        .eq('content_id', contentId)
        .maybeSingle();

      setIsFavorited(!!favoriteData);

      // Get likes count
      const { count } = await supabase
        .from('actions')
        .select('*', { count: 'exact', head: true })
        .eq('content_id', contentId)
        .eq('type', 'LIKE');

      setLikesCount(count || 0);
    };

    checkStatus();
  }, [user, contentId]);

  const toggleLike = async () => {
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
        // Unlike
        await supabase
          .from('actions')
          .delete()
          .eq('user_id', user.id)
          .eq('content_id', contentId)
          .eq('type', 'LIKE');

        setIsLiked(false);
        setLikesCount(prev => Math.max(0, prev - 1));
      } else {
        // Like
        await supabase
          .from('actions')
          .insert({
            user_id: user.id,
            content_id: contentId,
            type: 'LIKE',
          });

        setIsLiked(true);
        setLikesCount(prev => prev + 1);

        // Process reward
        await handleLike(user.id, contentId, true);
      }
    } catch (error) {
      console.error('Error toggling like:', error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  };

  const toggleSave = async () => {
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
        // Unsave
        await supabase
          .from('saved_contents')
          .delete()
          .eq('user_id', user.id)
          .eq('content_id', contentId);

        setIsSaved(false);
        toast({
          title: "Removido dos salvos",
          description: "Conteúdo removido da sua lista",
        });
      } else {
        // Save
        await supabase
          .from('saved_contents')
          .insert({
            user_id: user.id,
            content_id: contentId,
          });

        setIsSaved(true);

        // Process reward
        await handleSave(user.id, contentId);
      }
    } catch (error) {
      console.error('Error toggling save:', error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  };

  const toggleFavorite = async () => {
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
        // Unfavorite
        await supabase
          .from('favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('content_id', contentId);

        setIsFavorited(false);
        toast({
          title: "Removido dos favoritos",
          description: "Conteúdo removido dos seus favoritos",
        });
      } else {
        // Favorite
        await supabase
          .from('favorites')
          .insert({
            user_id: user.id,
            content_id: contentId,
          });

        setIsFavorited(true);

        // Process reward
        await handleFavorite(user.id, contentId);
      }
    } catch (error) {
      console.error('Error toggling favorite:', error);
      toast({
        title: "Erro",
        description: "Não foi possível processar sua ação",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleLike}
        className="gap-2"
      >
        <Heart
          className={`h-5 w-5 ${isLiked ? 'fill-red-500 text-red-500' : ''}`}
        />
        <span className="text-sm">{likesCount}</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={toggleSave}
        className="gap-2"
      >
        <Bookmark
          className={`h-5 w-5 ${isSaved ? 'fill-current' : ''}`}
        />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={toggleFavorite}
        className="gap-2"
      >
        <Star
          className={`h-5 w-5 ${isFavorited ? 'fill-yellow-500 text-yellow-500' : ''}`}
        />
      </Button>
    </div>
  );
}
