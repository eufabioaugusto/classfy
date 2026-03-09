import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { X, Play } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface AutoplayNextOverlayProps {
  nextContent: {
    id: string;
    title: string;
    thumbnail_url?: string;
    profiles?: {
      display_name?: string;
    };
    creator?: {
      display_name?: string;
    };
  } | null;
  show: boolean;
  onCancel: () => void;
  countdownSeconds?: number;
}

export function AutoplayNextOverlay({
  nextContent,
  show,
  onCancel,
  countdownSeconds = 5,
}: AutoplayNextOverlayProps) {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(countdownSeconds);

  const handlePlayNow = useCallback(() => {
    if (nextContent) {
      navigate(`/watch/${nextContent.id}`);
    }
  }, [nextContent, navigate]);

  useEffect(() => {
    if (!show || !nextContent) {
      setCountdown(countdownSeconds);
      return;
    }

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handlePlayNow();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [show, nextContent, countdownSeconds, handlePlayNow]);

  if (!nextContent) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="flex flex-col items-center gap-4 p-6 max-w-md"
          >
            {/* Cancel button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={onCancel}
              className="absolute top-4 right-4 text-white hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </Button>

            {/* Header */}
            <p className="text-white/70 text-sm">Próximo vídeo em</p>
            
            {/* Countdown Circle */}
            <div className="relative w-20 h-20">
              <svg className="w-full h-full -rotate-90">
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  fill="none"
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="4"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  fill="none"
                  stroke="hsl(var(--primary))"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={226}
                  strokeDashoffset={226 - (226 * (countdownSeconds - countdown)) / countdownSeconds}
                  className="transition-all duration-1000 ease-linear"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white">
                {countdown}
              </span>
            </div>

            {/* Next content preview */}
            <div className="flex gap-3 bg-white/10 rounded-lg p-3 w-full">
              <div className="relative w-28 aspect-video rounded overflow-hidden flex-shrink-0">
                <img
                  src={nextContent.thumbnail_url || "/placeholder.svg"}
                  alt={nextContent.title}
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Play className="w-8 h-8 text-white fill-white" />
                </div>
              </div>
              <div className="flex flex-col justify-center min-w-0">
                <p className="text-white font-medium text-sm line-clamp-2">
                  {nextContent.title}
                </p>
                {(nextContent.profiles?.display_name || nextContent.creator?.display_name) && (
                  <p className="text-white/60 text-xs mt-1">
                    {nextContent.profiles?.display_name || nextContent.creator?.display_name}
                  </p>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 w-full">
              <Button
                variant="outline"
                onClick={onCancel}
                className="flex-1 border-white/30 text-white hover:bg-white/10"
              >
                Cancelar
              </Button>
              <Button onClick={handlePlayNow} className="flex-1">
                <Play className="w-4 h-4 mr-2" />
                Assistir agora
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
