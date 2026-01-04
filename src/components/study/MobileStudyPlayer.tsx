import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, Minimize2 } from "lucide-react";
import { UnifiedVideoPlayer } from "@/components/unified/UnifiedVideoPlayer";
import { SocialBar } from "@/components/unified/SocialBar";
import { StudyToolbar, ToolPanel } from "@/components/unified/StudyToolbar";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";

interface MobileStudyPlayerProps {
  activeContent: {
    id: string;
    title: string;
    file_url: string;
    content_type: string;
    duration_seconds?: number;
    creator?: {
      id?: string;
      display_name: string;
    };
  };
  activePlaylist: { messageId: string; currentIndex: number } | null;
  messageContents: Map<string, any[]>;
  autoplayCountdown: number | null;
  activeToolPanel: ToolPanel;
  onToolPanelChange: (panel: ToolPanel) => void;
  onMinimize: () => void;
  onVideoEnded: () => void;
  onNoteCreated: () => void;
  onCancelAutoplay: () => void;
}

export function MobileStudyPlayer({
  activeContent,
  activePlaylist,
  messageContents,
  autoplayCountdown,
  activeToolPanel,
  onToolPanelChange,
  onMinimize,
  onVideoEnded,
  onNoteCreated,
  onCancelAutoplay,
}: MobileStudyPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showControls, setShowControls] = useState(true);
  
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 100], [1, 0.5]);
  const scale = useTransform(y, [0, 100], [1, 0.95]);

  const handleDragEnd = useCallback((event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setIsDragging(false);
    
    // If dragged down more than 50px or with velocity > 300, minimize
    if (info.offset.y > 50 || info.velocity.y > 300) {
      onMinimize();
    }
  }, [onMinimize]);

  const handleTap = () => {
    setShowControls(prev => !prev);
  };

  return (
    <motion.div
      ref={containerRef}
      className="flex-shrink-0 relative"
      style={{ y, opacity, scale }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={0.2}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
    >
      {/* Drag Indicator */}
      <div className="absolute top-0 left-0 right-0 z-50 flex justify-center py-1.5 pointer-events-none">
        <div className="w-10 h-1 rounded-full bg-white/30" />
      </div>

      {/* Mobile Study Toolbar - ABOVE player */}
      <div className="px-2 py-1.5 bg-card border-b border-border overflow-x-auto scrollbar-hide flex items-center gap-2">
        <StudyToolbar
          activePanel={activeToolPanel}
          onPanelChange={onToolPanelChange}
          compact
        />
        
        <div className="flex-1" />
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onMinimize}
          className="h-8 px-2.5 shrink-0"
        >
          <Minimize2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Video Container with aspect ratio */}
      <div className="relative bg-black" style={{ maxHeight: '30vh' }}>
        {/* Minimize button overlay - top left */}
        <AnimatePresence>
          {showControls && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => {
                e.stopPropagation();
                onMinimize();
              }}
              className="absolute top-3 left-3 z-50 w-10 h-10 rounded-full bg-black/50 flex items-center justify-center text-white backdrop-blur-sm"
            >
              <ChevronDown className="w-6 h-6" />
            </motion.button>
          )}
        </AnimatePresence>

        <div className="aspect-video max-h-[30vh]" onClick={handleTap}>
          <UnifiedVideoPlayer
            content={{
              id: activeContent.id,
              title: activeContent.title,
              file_url: activeContent.file_url,
              content_type: activeContent.content_type as "aula" | "short" | "podcast" | "curso",
              duration_seconds: activeContent.duration_seconds,
              content_id: activeContent.id,
              creator: activeContent.creator,
            }}
            mode="study"
            compact
            onVideoEnded={onVideoEnded}
            onNoteCreated={onNoteCreated}
          />
        </div>

        {/* Autoplay Countdown Overlay - Mobile */}
        {autoplayCountdown !== null && activePlaylist && (
          <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-lg p-4 text-center space-y-2 mx-4">
              <h3 className="text-base font-bold text-foreground">Próximo Vídeo</h3>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {(() => {
                  const playlistContents = messageContents.get(activePlaylist.messageId) || [];
                  const nextContent = playlistContents[activePlaylist.currentIndex + 1];
                  return nextContent?.title || "Carregando...";
                })()}
              </p>
              <div className="text-2xl font-bold text-primary">{autoplayCountdown}</div>
              <Button variant="outline" size="sm" onClick={onCancelAutoplay}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Swipe down hint */}
        {isDragging && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center pointer-events-none">
            <div className="text-white text-sm font-medium flex items-center gap-2">
              <ChevronDown className="w-5 h-5 animate-bounce" />
              Solte para minimizar
            </div>
          </div>
        )}
      </div>

      {/* Mobile Social Bar - BELOW player */}
      <div className="px-2 py-2 bg-card border-b border-border">
        <SocialBar
          contentId={activeContent.id}
          contentTitle={activeContent.title}
          creator={activeContent.creator?.id ? activeContent.creator as { id: string; display_name: string } : undefined}
          compact
          showCreator={false}
        />
      </div>
    </motion.div>
  );
}