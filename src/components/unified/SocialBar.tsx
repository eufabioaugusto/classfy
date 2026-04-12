import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ThumbsUp, Bookmark, Star, BookOpen, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShareButton } from "@/components/ShareButton";
import { FollowButton } from "@/components/FollowButton";
import { FeaturedBadge } from "@/components/FeaturedBadge";
import { ParticleBurst } from "@/components/ui/particle-burst";
import { motion } from "framer-motion";
import { useContentActions } from "@/hooks/useContentActions";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ShareViaDMModal } from "@/components/direct-messages/ShareViaDMModal";
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

interface CreatorInfo {
  id: string;
  display_name: string;
  avatar_url?: string | null;
  channel_name?: string | null;
}

interface SocialBarProps {
  contentId: string;
  isCourse?: boolean;
  contentTitle?: string;
  contentThumbnail?: string;
  creator?: CreatorInfo | null;
  followersCount?: number;
  hasAccess?: boolean;
  onAddToStudy?: () => void;
  showCreator?: boolean;
  compact?: boolean;
  onAction?: () => void;
  onStateChange?: (states: { isLiked: boolean; isSaved: boolean; isFavorited: boolean }) => void;
}

export function SocialBar({
  contentId,
  isCourse = false,
  contentTitle = "Conteúdo",
  contentThumbnail,
  creator,
  followersCount = 0,
  hasAccess = true,
  onAddToStudy,
  showCreator = true,
  compact = false,
  onAction,
  onStateChange,
}: SocialBarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showDMModal, setShowDMModal] = useState(false);

  const {
    isLiked,
    isSaved,
    isFavorited,
    likesCount,
    isLikeBursting,
    unlikeConfirmation,
    toggleLike,
    toggleSave,
    toggleFavorite,
    confirmUnlike,
    cancelUnlike,
    formatCount,
  } = useContentActions({ contentId, isCourse, hasAccess });

  // Emite estado ao vivo para o pai sempre que mudar
  useEffect(() => {
    onStateChange?.({ isLiked, isSaved, isFavorited });
  }, [isLiked, isSaved, isFavorited]);

  return (
    <>
      <div className={cn(
        "flex items-center gap-3 flex-wrap",
        compact ? "gap-2" : "justify-between"
      )}>
        {/* Left - Creator info */}
        {showCreator && creator && (
          <div
            className="flex items-center gap-2 sm:gap-3 cursor-pointer"
            onClick={() => navigate(creator.channel_name ? `/@${creator.channel_name}` : `/@${creator.display_name}`)}
          >
            <Avatar className={cn(compact ? "h-8 w-8" : "h-8 w-8 sm:h-10 sm:w-10")}>
              <AvatarImage src={creator.avatar_url || ""} />
              <AvatarFallback>{creator.display_name?.[0] || "C"}</AvatarFallback>
            </Avatar>
            <div className="mr-1 sm:mr-2">
              <p className={cn("font-semibold flex items-center gap-1 hover:text-primary transition-colors", compact ? "text-xs" : "text-xs sm:text-sm")}>
                {creator.display_name || "Criador"}
                <FeaturedBadge creatorId={creator.id} size="sm" />
              </p>
              <p className="text-[10px] sm:text-xs text-muted-foreground">
                {followersCount} seguidores
              </p>
            </div>
            <FollowButton creatorId={creator.id} size="sm" />
          </div>
        )}

        {/* Right - Actions */}
        <div className={cn(
          "flex items-center gap-1.5 sm:gap-2 flex-nowrap",
          !showCreator && "w-full justify-center sm:justify-start"
        )}>
          {/* Like */}
          <div className="relative">
            <ParticleBurst isActive={isLikeBursting} color="primary" />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { toggleLike(); onAction?.(); }}
              className={cn(
                "gap-1.5 sm:gap-2 rounded-full h-8 sm:h-9",
                compact ? "px-2.5" : "px-3 sm:px-4"
              )}
            >
              <motion.div
                animate={isLikeBursting ? { scale: [1, 1.3, 1] } : {}}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <ThumbsUp className={cn(
                  "h-3.5 w-3.5 sm:h-4 sm:w-4",
                  isLiked && "fill-current"
                )} />
              </motion.div>
              <span className="text-xs sm:text-sm">{formatCount(likesCount)}</span>
            </Button>
          </div>

          {/* Send via DM (aviãozinho) */}
          {user && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowDMModal(true)}
              className={cn(
                "gap-1.5 sm:gap-2 rounded-full h-8 sm:h-9",
                compact ? "px-2.5" : "px-3 sm:px-4"
              )}
            >
              <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {!compact && <span className="hidden sm:inline text-xs sm:text-sm">Enviar</span>}
            </Button>
          )}

          {/* Share */}
          <ShareButton
            contentId={contentId}
            contentTitle={contentTitle}
            contentThumbnail={contentThumbnail}
            creatorName={creator?.display_name}
            variant="secondary"
          />

          {/* Save */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { toggleSave(); onAction?.(); }}
            className={cn(
              "gap-1.5 sm:gap-2 rounded-full h-8 sm:h-9",
              compact ? "px-2.5" : "px-3 sm:px-4",
              isSaved && "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            <Bookmark className={cn(
              "h-3.5 w-3.5 sm:h-4 sm:w-4",
              isSaved && "fill-current"
            )} />
            {!compact && <span className="hidden sm:inline text-xs sm:text-sm">Salvar</span>}
          </Button>

          {/* Favorite */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { toggleFavorite(); onAction?.(); }}
            className={cn(
              "gap-1.5 sm:gap-2 rounded-full h-8 sm:h-9",
              compact ? "px-2.5" : "px-3 sm:px-4",
              isFavorited && "bg-yellow-500/20 text-yellow-500"
            )}
          >
            <Star className={cn(
              "h-3.5 w-3.5 sm:h-4 sm:w-4",
              isFavorited && "fill-current"
            )} />
            {!compact && <span className="hidden sm:inline text-xs sm:text-sm">Favoritos</span>}
          </Button>

          {/* Add to Study */}
          {onAddToStudy && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onAddToStudy}
              className={cn(
                "gap-1.5 sm:gap-2 rounded-full h-8 sm:h-9",
                compact ? "px-2.5" : "px-3 sm:px-4"
              )}
            >
              <BookOpen className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              {!compact && <span className="hidden sm:inline text-xs sm:text-sm">Estudo</span>}
            </Button>
          )}
        </div>
      </div>

      {/* Unlike Confirmation Dialog */}
      <AlertDialog open={unlikeConfirmation.pending} onOpenChange={(open) => !open && cancelUnlike()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza disso?</AlertDialogTitle>
            <AlertDialogDescription>
              Ao remover o like, você perderá <span className="font-bold text-destructive">{unlikeConfirmation.rewardValue} pontos</span> de performance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelUnlike}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmUnlike(); onAction?.(); }} className="bg-destructive hover:bg-destructive/90">
              Remover like
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* DM Share Modal */}
      <ShareViaDMModal
        open={showDMModal}
        onClose={() => setShowDMModal(false)}
        contentId={contentId}
        contentTitle={contentTitle}
        contentThumbnail={contentThumbnail}
        creatorName={creator?.display_name}
      />
    </>
  );
}
