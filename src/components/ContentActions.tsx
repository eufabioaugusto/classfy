import { useState } from "react";
import { ThumbsUp, Bookmark, Star, BookOpen, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShareButton } from "@/components/ShareButton";
import { motion } from "framer-motion";
import { ParticleBurst } from "@/components/ui/particle-burst";
import { useContentActions } from "@/hooks/useContentActions";
import { useAuth } from "@/contexts/AuthContext";
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

interface ContentActionsProps {
  contentId: string;
  isCourse?: boolean;
  contentTitle?: string;
  contentThumbnail?: string;
  creatorName?: string;
  hasAccess?: boolean;
  onAddToStudy?: () => void;
  onShare?: () => void;
}

export function ContentActions({ 
  contentId, 
  isCourse = false, 
  contentTitle = "Conteúdo",
  contentThumbnail,
  creatorName,
  hasAccess = true,
  onAddToStudy,
  onShare 
}: ContentActionsProps) {
  const { user } = useAuth();
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

  return (
    <>
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

        {/* Send via DM (aviãozinho) */}
        {user && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowDMModal(true)}
            className="gap-1.5 sm:gap-2 rounded-full px-3 sm:px-4 h-8 sm:h-9"
          >
            <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline text-xs sm:text-sm">Enviar</span>
          </Button>
        )}

        {/* Compartilhar */}
        <ShareButton 
          contentId={contentId} 
          contentTitle={contentTitle} 
          contentThumbnail={contentThumbnail}
          creatorName={creatorName}
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

      {/* Unlike Confirmation Dialog */}
      <AlertDialog open={unlikeConfirmation.pending} onOpenChange={(open) => !open && cancelUnlike()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza disso?</AlertDialogTitle>
            <AlertDialogDescription>
              Ao remover o like, você perderá <span className="font-bold text-destructive">{Math.floor(unlikeConfirmation.rewardValue)} pontos de performance</span>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelUnlike}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUnlike} className="bg-destructive hover:bg-destructive/90">
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
        creatorName={creatorName}
      />
    </>
  );
}
