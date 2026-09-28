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
  ListVideo,
  FileText,
  Brain,
  StickyNote,
  Lightbulb,
  ArrowUpRight,
  ChevronRight,
} from "lucide-react";
import { FollowButton } from "@/components/FollowButton";
import { FeaturedBadge } from "@/components/FeaturedBadge";
import { ShareButton } from "@/components/ShareButton";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ParticleBurst } from "@/components/ui/particle-burst";
import type { ToolPanel } from "@/components/unified/StudyToolbar";
import { useParticleBurst } from "@/hooks/useParticleBurst";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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
  onShowStudyTool?: (panel: ToolPanel) => void;
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
  unlikeConfirmation?: { pending: boolean; rewardValue: number };
  onConfirmUnlike?: () => void;
  onCancelUnlike?: () => void;
}

const formatCount = (count: number) => {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
};

const formatDuration = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
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
  onShowStudyTool,
  isCourse = false,
  totalLessons = 0,
  relatedContents,
  onContentClick,
  unlikeConfirmation = { pending: false, rewardValue: 0 },
  onConfirmUnlike,
  onCancelUnlike,
}: MobileWatchLayoutProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const { isBursting: isLikeBursting, triggerBurst: triggerLikeBurst } = useParticleBurst();

  const handleLikeClick = () => {
    if (!isLiked) {
      triggerLikeBurst();
    }
    onToggleLike();
  };

  const activeActionClass = "bg-red-500/15 text-red-500 ring-1 ring-inset ring-red-500/35 hover:bg-red-500/20 hover:text-red-500 dark:bg-white dark:text-zinc-950 dark:ring-white/25 dark:hover:bg-zinc-100 dark:hover:text-zinc-950";

  return (
    <>
      <div className="cf-mobile-watch-details flex flex-col w-full" style={{ maxWidth: "100vw", overflowX: "hidden" }}>
        {/* Title with Course Badge */}
        <div className="flex items-start gap-2 px-3 pt-3 pb-2">
          <h1 className="text-lg font-semibold tracking-tight leading-snug line-clamp-2 flex-1">
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
        <a
          className="flex items-center gap-2.5 flex-1 min-w-0"
          href={content.creator?.id ? `/creator/${content.creator.id}` : undefined}
        >
          <Avatar className="h-9 w-9 border border-border/50">
            <AvatarImage src={content.creator?.avatar_url || ""} />
            <AvatarFallback className="bg-primary/10 text-primary font-medium">
              {content.creator?.display_name?.[0] || "C"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate flex items-center gap-1">
              {content.creator?.display_name || "Criador"}
              <FeaturedBadge creatorId={content.creator?.id} size="sm" />
            </p>
            <p className="text-xs text-muted-foreground">
              {formatCount(followersCount)} seguidores
            </p>
          </div>
        </a>
        {content.creator?.id && (
          <FollowButton creatorId={content.creator.id} size="sm" />
        )}
      </div>

      {/* Action Buttons - Horizontal Scroll */}
      <div className="cf-mobile-watch-actions flex gap-1.5 px-3 pt-1 pb-4 overflow-x-auto scrollbar-hide" style={{ maxWidth: '100vw' }}>
        <div className="relative flex-shrink-0">
          <ParticleBurst isActive={isLikeBursting} color="primary" />
          <Button
            variant="secondary"
            size="sm"
            aria-label="Curtir"
            aria-pressed={isLiked}
            onClick={handleLikeClick}
            className={cn(
              "gap-1.5 rounded-full px-3 h-10",
              isLiked && activeActionClass
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
          isCourse={isCourse}
        />

        <Button
          variant="secondary"
          size="sm"
          aria-pressed={isSaved}
          onClick={onToggleSave}
          className={cn(
            "gap-1.5 rounded-full px-3 h-10 flex-shrink-0",
            isSaved && activeActionClass
          )}
        >
          <Bookmark className={cn("h-4 w-4", isSaved && "fill-current")} />
          <span className="text-sm">Salvar</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          aria-pressed={isFavorited}
          onClick={onToggleFavorite}
          className={cn(
            "gap-1.5 rounded-full px-3 h-10 flex-shrink-0",
            isFavorited && activeActionClass
          )}
        >
          <Star className={cn("h-4 w-4", isFavorited && "fill-current")} />
          <span className="text-sm">Favorito</span>
        </Button>

        <Button
          variant="secondary"
          size="sm"
          onClick={onAddToStudy}
          className="gap-1.5 rounded-full px-3 h-10 flex-shrink-0"
        >
          <BookOpen className="h-4 w-4" />
          <span className="text-sm">Estudo</span>
        </Button>
      </div>

      {/* Expandable Description Card */}
      <div
        className="mx-3 mb-5 border border-border/50 bg-muted/30 rounded-xl overflow-hidden"

      >
        <div className="p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
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

          <button aria-expanded={descExpanded} onClick={() => setDescExpanded(!descExpanded)} className="flex min-h-9 items-center gap-1 text-xs font-semibold text-foreground mt-1">
            {descExpanded ? (
              <>
                <span>Mostrar menos</span>
                <ChevronUp className="h-4 w-4" />
              </>
            ) : (
              <>
                <span>Ver descrição</span>
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
          className="mx-3 mb-5 p-3.5 border border-border/60 bg-card rounded-xl flex items-center justify-between active:bg-muted/50 transition-colors"
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

      {onShowStudyTool && (
        <section className="mx-3 mb-5" aria-label="Ferramentas de estudo">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold tracking-tight">Estude esta aula</h2>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Com a Classy</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([
              { panel: 'transcription', label: 'Transcrição', detail: 'Acompanhe o conteúdo', icon: FileText },
              { panel: 'quiz', label: 'Quiz', detail: 'Teste o que aprendeu', icon: Brain },
              { panel: 'notes', label: 'Anotações', detail: 'Guarde suas ideias', icon: StickyNote },
              { panel: 'recommendations', label: 'Sugestões', detail: 'Explore o próximo passo', icon: Lightbulb },
            ] as const).map(({ panel, label, detail, icon: Icon }) => (
              <motion.button key={panel} whileTap={{ scale: 0.98 }} onClick={() => onShowStudyTool(panel)}
                className="min-h-[76px] p-3 border border-border/60 bg-card rounded-xl text-left active:bg-muted/50 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <Icon className="h-4 w-4 text-red-500" />
                  <ArrowUpRight className="h-3 w-3 text-muted-foreground/60" />
                </div>
                <span className="block text-xs font-semibold">{label}</span>
                <span className="block mt-0.5 text-[10px] text-muted-foreground">{detail}</span>
              </motion.button>
            ))}
          </div>
        </section>
      )}

      {/* Comments Preview Button */}
      <button
        onClick={onShowComments}
        className="mx-3 mb-5 p-3.5 border border-border/60 bg-card rounded-xl flex items-center justify-between active:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm font-medium">Comentários</span>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </button>

      {/* Related Content - Compact Grid */}
      {relatedContents.length > 0 && (
        <div className="px-3 pb-6 overflow-hidden">
          <h3 className="text-sm font-semibold mb-3 tracking-tight">
            A seguir
          </h3>
          <div className="space-y-3">
            {relatedContents.slice(0, 5).map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => onContentClick(item.id)}
                className="flex w-full gap-3 text-left group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
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
              </button>
            ))}
          </div>
        </div>
      )}
    </div>

    {/* Unlike Confirmation Dialog */}
    <AlertDialog
      open={unlikeConfirmation.pending}
      onOpenChange={(open) => {
        if (!open) onCancelUnlike?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Tem certeza disso?</AlertDialogTitle>
          <AlertDialogDescription>
            Ao remover o like, você perderá{" "}
            <span className="font-bold text-destructive">
              {unlikeConfirmation.rewardValue} Points
            </span>{" "}
            conquistados.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancelUnlike}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirmUnlike}
            className="bg-destructive hover:bg-destructive/90"
          >
            Remover like
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
);
}
