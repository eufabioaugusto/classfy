import { ThumbsUp, Bookmark, Star, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ShareButton } from "@/components/ShareButton";
import { FollowButton } from "@/components/FollowButton";
import { ParticleBurst } from "@/components/ui/particle-burst";
import { motion } from "framer-motion";
import { useContentActions } from "@/hooks/useContentActions";
import { cn } from "@/lib/utils";

interface CreatorInfo {
  id: string;
  display_name: string;
  avatar_url?: string | null;
}

interface SocialBarProps {
  contentId: string;
  isCourse?: boolean;
  contentTitle?: string;
  creator?: CreatorInfo | null;
  followersCount?: number;
  onAddToStudy?: () => void;
  showCreator?: boolean;
  compact?: boolean;
}

export function SocialBar({
  contentId,
  isCourse = false,
  contentTitle = "Conteúdo",
  creator,
  followersCount = 0,
  onAddToStudy,
  showCreator = true,
  compact = false,
}: SocialBarProps) {
  const {
    isLiked,
    isSaved,
    isFavorited,
    likesCount,
    isLikeBursting,
    toggleLike,
    toggleSave,
    toggleFavorite,
    formatCount,
  } = useContentActions({ contentId, isCourse });

  return (
    <div className={cn(
      "flex items-center gap-3 flex-wrap",
      compact ? "gap-2" : "justify-between"
    )}>
      {/* Left - Creator info */}
      {showCreator && creator && (
        <div className="flex items-center gap-2 sm:gap-3">
          <Avatar className={cn(compact ? "h-8 w-8" : "h-8 w-8 sm:h-10 sm:w-10")}>
            <AvatarImage src={creator.avatar_url || ""} />
            <AvatarFallback>{creator.display_name?.[0] || "C"}</AvatarFallback>
          </Avatar>
          <div className="mr-1 sm:mr-2">
            <p className={cn("font-semibold", compact ? "text-xs" : "text-xs sm:text-sm")}>
              {creator.display_name || "Criador"}
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
            onClick={toggleLike}
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

        {/* Share */}
        <ShareButton
          contentId={contentId}
          contentTitle={contentTitle}
          variant="secondary"
        />

        {/* Save */}
        <Button
          variant="secondary"
          size="sm"
          onClick={toggleSave}
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
          onClick={toggleFavorite}
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
  );
}
