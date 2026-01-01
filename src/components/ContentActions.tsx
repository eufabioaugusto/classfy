import { useState, useEffect } from "react";
import { ThumbsUp, Bookmark, Star, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { toast } from "@/hooks/use-toast";
import { ShareButton } from "@/components/ShareButton";
import { motion } from "framer-motion";
import { ParticleBurst } from "@/components/ui/particle-burst";
import { useParticleBurst } from "@/hooks/useParticleBurst";
interface ContentActionsProps {
  contentId: string;
  isCourse?: boolean;
  contentTitle?: string;
  onAddToStudy?: () => void;
  onShare?: () => void;
}

export function ContentActions({ 
  contentId, 
  isCourse = false, 
  contentTitle = "Conteúdo",
  onAddToStudy,
  onShare 
}: ContentActionsProps) {
  const { user } = useAuth();
  const { handleLike, handleSave, handleFavorite } = useRewardSystem();
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const { isBursting: isLikeBursting, triggerBurst: triggerLikeBurst } = useParticleBurst();

  useEffect(() => {
    if (!user) return;

    const checkStatus = async () => {
      // Check likes
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
        const insertData: any = {
          user_id: user.id,
          type: 'LIKE',
        };

        if (isCourse) {
          insertData.course_id = contentId;
        } else {
          insertData.content_id = contentId;
        }

        await supabase.from('actions').insert(insertData);

        if (isCourse) {
          await supabase
            .from('courses')
            .update({ likes_count: likesCount + 1 })
            .eq('id', contentId);
        }

        setIsLiked(true);
        setLikesCount(prev => prev + 1);
        triggerLikeBurst();
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
        const insertData: any = {
          user_id: user.id,
        };

        if (isCourse) {
          insertData.course_id = contentId;
        } else {
          insertData.content_id = contentId;
        }

        await supabase.from('saved_contents').insert(insertData);

        setIsSaved(true);
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
        const insertData: any = {
          user_id: user.id,
        };

        if (isCourse) {
          insertData.course_id = contentId;
        } else {
          insertData.content_id = contentId;
        }

        await supabase.from('favorites').insert(insertData);

        setIsFavorited(true);
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

  const formatCount = (count: number) => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K`;
    }
    return count.toString();
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap">
      {/* Like */}
      <div className="relative">
        <ParticleBurst isActive={isLikeBursting} color="primary" />
        <Button
          variant="secondary"
          size="sm"
          onClick={toggleLike}
          className="gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 h-8 sm:h-9"
        >
          <motion.div
            animate={isLikeBursting ? { scale: [1, 1.3, 1] } : {}}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <ThumbsUp className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isLiked ? 'fill-current' : ''}`} />
          </motion.div>
          <span className="text-xs sm:text-sm">{formatCount(likesCount)}</span>
        </Button>
      </div>

      {/* Compartilhar */}
      <ShareButton 
        contentId={contentId} 
        contentTitle={contentTitle} 
        variant="secondary"
      />

      {/* Salvar */}
      <Button
        variant="secondary"
        size="sm"
        onClick={toggleSave}
        className={`gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 h-8 sm:h-9 ${isSaved ? 'bg-primary text-primary-foreground hover:bg-primary/90' : ''}`}
      >
        <Bookmark className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isSaved ? 'fill-current' : ''}`} />
        <span className="hidden sm:inline text-xs sm:text-sm">Salvar</span>
      </Button>

      {/* Favoritos */}
      <Button
        variant="secondary"
        size="sm"
        onClick={toggleFavorite}
        className={`gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 h-8 sm:h-9 ${isFavorited ? 'bg-yellow-500/20 text-yellow-500' : ''}`}
      >
        <Star className={`h-3.5 w-3.5 sm:h-4 sm:w-4 ${isFavorited ? 'fill-current' : ''}`} />
        <span className="hidden sm:inline text-xs sm:text-sm">Favoritos</span>
      </Button>

      {/* Adicionar ao Estudo */}
      {onAddToStudy && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onAddToStudy}
          className="gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 h-8 sm:h-9"
        >
          <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="hidden sm:inline text-xs sm:text-sm">Estudo</span>
        </Button>
      )}
    </div>
  );
}
