import { useState, useEffect } from "react";
import { Heart, Bookmark, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/ShareButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "@/hooks/use-toast";

interface ContentActionsProps {
  contentId: string;
  isCourse?: boolean;
}

export function ContentActions({ contentId, isCourse = false }: ContentActionsProps) {
  const { user } = useAuth();
  const { handleLike, handleSave, handleFavorite } = useRewardSystem();
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  useEffect(() => {
    if (!user) return;

    const checkStatus = async () => {
      // Check likes - use course_id or content_id based on type
      const likeQuery = supabase
        .from('actions')
        .select('id')
        .eq('user_id', user.id)
        .eq('type', 'LIKE');
      
      if (isCourse) {
        likeQuery.eq('course_id', contentId);
      } else {
        likeQuery.eq('content_id', contentId);
      }

      const { data: likeData } = await likeQuery.maybeSingle();
      setIsLiked(!!likeData);

      // Check saved
      const savedQuery = supabase
        .from('saved_contents')
        .select('id')
        .eq('user_id', user.id);

      if (isCourse) {
        savedQuery.eq('course_id', contentId);
      } else {
        savedQuery.eq('content_id', contentId);
      }

      const { data: savedData } = await savedQuery.maybeSingle();
      setIsSaved(!!savedData);

      // Check favorited
      const favoriteQuery = supabase
        .from('favorites')
        .select('id')
        .eq('user_id', user.id);

      if (isCourse) {
        favoriteQuery.eq('course_id', contentId);
      } else {
        favoriteQuery.eq('content_id', contentId);
      }

      const { data: favoriteData } = await favoriteQuery.maybeSingle();
      setIsFavorited(!!favoriteData);

      // Get likes count
      const countQuery = supabase
        .from('actions')
        .select('*', { count: 'exact', head: true })
        .eq('type', 'LIKE');

      if (isCourse) {
        countQuery.eq('course_id', contentId);
      } else {
        countQuery.eq('content_id', contentId);
      }

      const { count } = await countQuery;
      setLikesCount(count || 0);
    };

    checkStatus();
  }, [user, contentId, isCourse]);

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
        const deleteQuery = supabase
          .from('actions')
          .delete()
          .eq('user_id', user.id)
          .eq('type', 'LIKE');

        if (isCourse) {
          deleteQuery.eq('course_id', contentId);
        } else {
          deleteQuery.eq('content_id', contentId);
        }

        await deleteQuery;

        // Update likes_count in courses table if it's a course
        if (isCourse) {
          const { data: course } = await supabase
            .from('courses')
            .select('likes_count')
            .eq('id', contentId)
            .single();
          
          await supabase
            .from('courses')
            .update({ likes_count: Math.max(0, (course?.likes_count || 1) - 1) })
            .eq('id', contentId);
        }

        setIsLiked(false);
        setLikesCount(prev => Math.max(0, prev - 1));
      } else {
        // Like
        const insertData: any = {
          user_id: user.id,
          type: 'LIKE',
        };

        if (isCourse) {
          insertData.course_id = contentId;
        } else {
          insertData.content_id = contentId;
        }

        await supabase
          .from('actions')
          .insert(insertData);

        // Update likes_count in the appropriate table
        if (isCourse) {
          await supabase
            .from('courses')
            .update({ likes_count: likesCount + 1 })
            .eq('id', contentId);
        }

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
        const deleteQuery = supabase
          .from('saved_contents')
          .delete()
          .eq('user_id', user.id);

        if (isCourse) {
          deleteQuery.eq('course_id', contentId);
        } else {
          deleteQuery.eq('content_id', contentId);
        }

        await deleteQuery;

        setIsSaved(false);
        toast({
          title: "Removido dos salvos",
          description: "Conteúdo removido da sua lista",
        });
      } else {
        // Save
        const insertData: any = {
          user_id: user.id,
        };

        if (isCourse) {
          insertData.course_id = contentId;
        } else {
          insertData.content_id = contentId;
        }

        await supabase
          .from('saved_contents')
          .insert(insertData);

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
        const deleteQuery = supabase
          .from('favorites')
          .delete()
          .eq('user_id', user.id);

        if (isCourse) {
          deleteQuery.eq('course_id', contentId);
        } else {
          deleteQuery.eq('content_id', contentId);
        }

        await deleteQuery;

        setIsFavorited(false);
        toast({
          title: "Removido dos favoritos",
          description: "Conteúdo removido dos seus favoritos",
        });
      } else {
        // Favorite
        const insertData: any = {
          user_id: user.id,
        };

        if (isCourse) {
          insertData.course_id = contentId;
        } else {
          insertData.content_id = contentId;
        }

        await supabase
          .from('favorites')
          .insert(insertData);

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

      <ShareButton 
        contentId={contentId} 
        contentTitle="Conteúdo" 
        size="sm" 
        variant="ghost"
      />
    </div>
  );
}
