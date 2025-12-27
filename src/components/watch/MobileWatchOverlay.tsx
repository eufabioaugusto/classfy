import { useRef, useState, useCallback, useEffect } from "react";
import { motion, useMotionValue, useTransform, PanInfo, AnimatePresence } from "framer-motion";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

interface MobileWatchOverlayProps {
  children: React.ReactNode;
  content: {
    id: string;
    title: string;
    file_url: string;
    thumbnail_url?: string;
    duration_seconds: number;
    creator?: { display_name: string } | null;
  };
  currentTime: number;
  isVisible: boolean;
  onClose: () => void;
}

const MINIMIZE_THRESHOLD = 100; // px to drag before minimizing
const DISMISS_VELOCITY = 500; // velocity to dismiss

export function MobileWatchOverlay({
  children,
  content,
  currentTime,
  isVisible,
  onClose,
}: MobileWatchOverlayProps) {
  const navigate = useNavigate();
  const { startMiniPlayer } = useMiniPlayer();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Motion values for gesture
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 200], [1, 0.5]);
  const scale = useTransform(y, [0, 300], [1, 0.85]);
  const borderRadius = useTransform(y, [0, 100], [0, 24]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleDragEnd = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      setIsDragging(false);
      
      const { offset, velocity } = info;
      
      // If dragged past threshold or with high velocity, minimize to mini player
      if (offset.y > MINIMIZE_THRESHOLD || velocity.y > DISMISS_VELOCITY) {
        // Transition to mini player
        startMiniPlayer(
          {
            id: content.id,
            title: content.title,
            file_url: content.file_url,
            thumbnail_url: content.thumbnail_url,
            duration_seconds: content.duration_seconds,
            creator: content.creator ? { display_name: content.creator.display_name } : undefined,
          },
          currentTime
        );
        
        // Navigate back
        onClose();
      } else {
        // Snap back to original position
        y.set(0);
      }
    },
    [content, currentTime, startMiniPlayer, onClose, y]
  );

  // Reset position when becoming visible
  useEffect(() => {
    if (isVisible) {
      y.set(0);
    }
  }, [isVisible, y]);

  return (
    <AnimatePresence>
      {isVisible && (
        <>
          {/* Background that shows when dragging */}
          <motion.div 
            className="fixed inset-0 z-40 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: isDragging ? 1 : 0 }}
            exit={{ opacity: 0 }}
            style={{ pointerEvents: isDragging ? 'auto' : 'none' }}
          />
          
          <motion.div
            ref={containerRef}
            className="fixed inset-0 z-50 bg-background"
            style={{
              y,
              opacity,
              scale,
              borderRadius,
              transformOrigin: "top center",
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {/* Drag indicator */}
            <div 
              className={cn(
                "absolute top-0 left-0 right-0 z-50 flex items-center justify-center pt-2 pb-1 touch-none",
                isDragging && "bg-gradient-to-b from-black/20 to-transparent"
              )}
            >
              <div className="w-10 h-1 rounded-full bg-white/30" />
            </div>

            {/* Hint text when dragging */}
            {isDragging && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute top-8 left-0 right-0 z-50 flex justify-center"
              >
                <span className="text-xs text-white/70 bg-black/50 px-3 py-1 rounded-full">
                  Solte para minimizar
                </span>
              </motion.div>
            )}

            {/* Content */}
            <div className="h-full overflow-hidden">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}