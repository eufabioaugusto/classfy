import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  ThumbsUp, 
  Bookmark, 
  Star, 
  BookOpen, 
  ChevronDown,
  ChevronUp,
  MessageCircle,
  Play,
  ListVideo
} from "lucide-react";
import { FollowButton } from "@/components/FollowButton";
import { ShareButton } from "@/components/ShareButton";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ParticleBurst } from "@/components/ui/particle-burst";
import { useParticleBurst } from "@/hooks/useParticleBurst";

interface MobileWatchLayoutProps {
  content: {
    id: string;
    title: string;
    description: string | null;
    views_count: number;
    likes_count: number;
    created_at?: string;
    tags: string[] | null;
    content_type?: string;
    creator?: {
      id: string;
      display_name: string;
      avatar_url: string | null;
    } | null;
  };
  followersCount: number;
  isLiked: boolean;
  isSaved: boolean;
  isFavorited: boolean;
  likesCount: number;
  onToggleLike: () => void;
  onToggleSave: () => void;
  onToggleFavorite: () => void;
  onAddToStudy: () => void;
  onShowComments: () => void;
  onShowCurriculum?: () => void;
  isCourse?: boolean;
  totalLessons?: number;
  relatedContents: Array<{
    id: string;
    title: string;
    thumbnail_url: string;
    duration_seconds: number;
    views_count: number;
    creator?: { display_name?: string | null } | null;
  }>;
  onContentClick: (id: string) => void;
}

const formatCount = (count: number) => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export function MobileWatchLayout({
  content,
  followersCount,
  isLiked,
  isSaved,
  isFavorited,
  likesCount,
  onToggleLike,
  onToggleSave,
  onToggleFavorite,
  onAddToStudy,
  onShowComments,
  onShowCurriculum,
  isCourse = false,
  totalLessons = 0,
  relatedContents,
  onContentClick,
}: MobileWatchLayoutProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const { isBursting: isLikeBursting, triggerBurst: triggerLikeBurst } = useParticleBurst();

  const handleLikeClick = () => {
    if (!isLiked) {
      triggerLikeBurst();
    }
    onToggleLike();
  };
  return (
    <div className="flex flex-col w-full" style={{ maxWidth: '100vw', overflowX: 'hidden' }}>
      {/* Title with Course Badge */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <h1 className="text-base font-semibold leading-tight line-clamp-2 flex-1">
          {content.title}
        </h1>
        {isCourse && (
          <Badge variant="secondary" className="flex-shrink-0 bg-primary/10 text-primary border-primary/20">
            Curso
          </Badge>
        )}
      </div>

      {/* Creator Row - YouTube Style */}
      <div className="flex items-center justify-between px-3 pb-2">
        <div 
          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
          onClick={() => content.creator?.id && window.location.assign(`/creator/${content.creator.id}`)}
        >
          <Avatar className="h-9 w-9 ring-2 ring-primary/20">
            <AvatarImage src={content.creator?.avatar_url || ""} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {content.creator?.display_name?.[0] || "C"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">
              {content.creator?.display_name || "Criador"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatCount(followersCount)} seguidores
            </p>
          </div>
        </div>
        {content.creator?.id && (
          <FollowButton creatorId={content.creator.id} size="sm" />
        )}
      </div>

      {/* Action Buttons - Horizontal Scroll */}
      <div className="flex gap-2 px-3 pb-3 overflow-x-auto scrollbar-hide" style={{ maxWidth: '100vw' }}>
        <div className="relative flex-shrink-0">
          <ParticleBurst isActive={isLikeBursting} color="primary" />
          <Button
            variant="secondary"
            size="sm"
            onClick={handleLikeClick}
            className={cn(
              "gap-1.5 rounded-full px-4 h-9",
              isLiked && "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            <motion.div
              animate={isLikeBursting ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.3, ease: "easeOut" }}
            >
              <ThumbsUp className={cn("h-4 w-4", isLiked && "fill-current")} />
            </motion.div>
            <span className="text-sm font-medium">{formatCount(likesCount)}</span>
          </Button>
        </div>

        <ShareButton 
          contentId={content.id} 
          contentTitle={content.title} 
          variant="secondary"
        />

        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleSave}
          className={cn(
            "gap-1.5 rounded-full px-4 h-9 flex-shrink-0",
            isSaved && "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          <Bookmark className={cn("h-4 w-4", isSaved && "fill-current")} />
          <span className="text-sm">Salvar</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onToggleFavorite}
          className={cn(
            "gap-1.5 rounded-full px-4 h-9 flex-shrink-0",
            isFavorited && "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
          )}
        >
          <Star className={cn("h-4 w-4", isFavorited && "fill-current")} />
          <span className="text-sm">Favorito</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onAddToStudy}
          className="gap-1.5 rounded-full px-4 h-9 flex-shrink-0"
        >
          <BookOpen className="h-4 w-4" />
          <span className="text-sm">Estudo</span>
        </Button>
      </div>

      {/* Expandable Description Card */}
      <div 
        className="mx-3 mb-3 bg-secondary/50 rounded-xl overflow-hidden"
        onClick={() => setDescExpanded(!descExpanded)}
      >
        <div className="p-3 cursor-pointer active:bg-secondary/70 transition-colors">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
            <span className="font-medium">{formatCount(content.views_count || 0)} views</span>
            <span>•</span>
            <span>
              {formatDistanceToNow(new Date(content.created_at || Date.now()), { 
                addSuffix: true, 
                locale: ptBR 
              })}
            </span>
          </div>
          
          {content.tags && content.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {content.tags.slice(0, 4).map((tag, i) => (
                <span key={i} className="text-xs text-primary font-medium">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          <p className={cn(
            "text-sm transition-all",
            !descExpanded && "line-clamp-2"
          )}>
            {content.description || "Sem descrição disponível."}
          </p>

          <button className="flex items-center gap-1 text-sm font-medium text-muted-foreground mt-2">
            {descExpanded ? (
              <>
                <span>Mostrar menos</span>
                <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                <span>...mais</span>
                <ChevronDown className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Course Curriculum Button - Only for courses */}
      {isCourse && onShowCurriculum && (
        <button
          onClick={onShowCurriculum}
          className="mx-3 mb-3 p-3 bg-secondary/50 rounded-xl flex items-center justify-between active:bg-secondary/70 transition-colors"
        >
          <div className="flex items-center gap-2">
            <ListVideo className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Conteúdo do Curso</span>
            {totalLessons > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalLessons} aulas
              </Badge>
            )}
          </div>
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        </button>
      )}

      {/* Comments Preview Button */}
      <button
        onClick={onShowComments}
        className="mx-3 mb-3 p-3 bg-secondary/50 rounded-xl flex items-center justify-between active:bg-secondary/70 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Comentários</span>
        </div>
        <ChevronDown className="h-5 w-5 text-muted-foreground" />
      </button>

      {/* Related Content - Compact Grid */}
      {relatedContents.length > 0 && (
        <div className="px-3 pb-6 overflow-hidden">
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">
            A seguir
          </h3>
          <div className="space-y-3">
            {relatedContents.slice(0, 5).map((item) => (
              <div
                key={item.id}
                onClick={() => onContentClick(item.id)}
                className="flex gap-3 cursor-pointer group"
              >
                <div className="relative w-36 min-w-[144px] aspect-video rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                  <img
                    src={item.thumbnail_url}
                    alt={item.title}
                    className="w-full h-full object-cover group-active:scale-105 transition-transform"
                  />
                  <div className="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] px-1.5 py-0.5 rounded font-medium">
                    {formatDuration(item.duration_seconds)}
                  </div>
                </div>
                <div className="flex-1 min-w-0 py-0.5 overflow-hidden">
                  <h4 className="text-sm font-medium line-clamp-2 mb-1 group-active:text-primary transition-colors">
                    {item.title}
                  </h4>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.creator?.display_name || "Criador"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCount(item.views_count)} views
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
