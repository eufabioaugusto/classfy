import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, Crown, Loader2, Lock, Play, X } from "lucide-react";
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
    visibility?: "free" | "pro" | "premium" | "paid" | null;
    price?: number | null;
  } | null;
  show: boolean;
  onCancel: () => void;
  canPlay?: boolean;
  checkingAccess?: boolean;
  blockReason?: "plan" | "purchase" | null;
  requiredPlan?: "pro" | "premium";
  onUpgradeClick?: () => void;
  onPurchaseClick?: () => void;
  onFindFree?: () => void;
  countdownSeconds?: number;
}

export function AutoplayNextOverlay({
  nextContent,
  show,
  onCancel,
  canPlay = true,
  checkingAccess = false,
  blockReason = null,
  requiredPlan = "pro",
  onUpgradeClick,
  onPurchaseClick,
  onFindFree,
  countdownSeconds = 5,
}: AutoplayNextOverlayProps) {
  const navigate = useNavigate();
  const [countdown, setCountdown] = useState(countdownSeconds);

  const handlePlayNow = useCallback(() => {
    if (nextContent && canPlay && !checkingAccess) {
      navigate(`/watch/${nextContent.id}`);
    }
  }, [canPlay, checkingAccess, nextContent, navigate]);

  useEffect(() => {
    if (!show || !nextContent || !canPlay || checkingAccess) {
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
  }, [
    show,
    nextContent,
    countdownSeconds,
    handlePlayNow,
    canPlay,
    checkingAccess,
  ]);

  if (!nextContent) return null;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black/90 z-50"
        >
          <img
            src={nextContent.thumbnail_url || "/placeholder.svg"}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-105 object-cover opacity-25 blur-lg"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/75 to-black/95" />
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative flex w-full max-w-lg flex-col items-center gap-4 p-6 text-center"
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

            {checkingAccess ? (
              <div className="flex min-h-56 flex-col items-center justify-center gap-4 text-white">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <div>
                  <p className="font-semibold">Preparando a próxima aula</p>
                  <p className="mt-1 text-sm text-white/60">
                    Verificando seu acesso com segurança.
                  </p>
                </div>
              </div>
            ) : !canPlay && blockReason ? (
              <>
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold text-white/85 backdrop-blur-md">
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  Aula concluída
                </div>

                <div
                  className={`mt-1 flex h-16 w-16 items-center justify-center rounded-full border shadow-2xl ${
                    blockReason === "purchase"
                      ? "border-primary/45 bg-primary/20 text-primary"
                      : requiredPlan === "premium"
                        ? "border-red-400/45 bg-red-500/20 text-red-400"
                        : "border-amber-300/45 bg-amber-400/20 text-amber-300"
                  }`}
                >
                  {blockReason === "purchase" ? (
                    <Lock className="h-7 w-7" />
                  ) : (
                    <Crown className="h-8 w-8" fill="currentColor" />
                  )}
                </div>

                <div className="max-w-md">
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
                    Continue aprendendo
                  </p>
                  <h2 className="mt-2 text-2xl font-bold text-white sm:text-3xl">
                    {blockReason === "purchase"
                      ? "Sua próxima aula está pronta"
                      : `A próxima aula faz parte do plano ${requiredPlan === "premium" ? "Premium" : "Pro"}`}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-white/70 sm:text-base">
                    {blockReason === "purchase"
                      ? `Desbloqueie “${nextContent.title}” para continuar agora.`
                      : `Desbloqueie “${nextContent.title}” e continue sua jornada sem interromper o ritmo.`}
                  </p>
                </div>

                <div className="mt-1 flex w-full max-w-sm flex-col gap-2 sm:flex-row">
                  <Button
                    onClick={
                      blockReason === "purchase"
                        ? onPurchaseClick
                        : onUpgradeClick
                    }
                    className="flex-1 bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90"
                  >
                    {blockReason === "purchase"
                      ? `Comprar por R$ ${Number(nextContent.price || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                      : `Assinar ${requiredPlan === "premium" ? "Premium" : "Pro"}`}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onFindFree || onCancel}
                    className="flex-1 border-white/25 bg-black/25 text-white hover:bg-white/10 hover:text-white"
                  >
                    Ver aulas gratuitas
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* Header */}
                <p className="text-sm text-white/70">Próximo vídeo em</p>

                {/* Countdown Circle */}
                <div className="relative h-20 w-20">
                  <svg className="h-full w-full -rotate-90">
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
                      strokeDashoffset={
                        226 -
                        (226 * (countdownSeconds - countdown)) /
                          countdownSeconds
                      }
                      className="transition-all duration-1000 ease-linear"
                    />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-2xl font-bold text-white">
                    {countdown}
                  </span>
                </div>

                {/* Next content preview */}
                <div className="flex w-full gap-3 rounded-lg bg-white/10 p-3">
                  <div className="relative aspect-video w-28 flex-shrink-0 overflow-hidden rounded">
                    <img
                      src={nextContent.thumbnail_url || "/placeholder.svg"}
                      alt={nextContent.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Play className="w-8 h-8 text-white fill-white" />
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col justify-center text-left">
                    <p className="text-white font-medium text-sm line-clamp-2">
                      {nextContent.title}
                    </p>
                    {(nextContent.profiles?.display_name ||
                      nextContent.creator?.display_name) && (
                      <p className="text-white/60 text-xs mt-1">
                        {nextContent.profiles?.display_name ||
                          nextContent.creator?.display_name}
                      </p>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex w-full gap-3">
                  <Button
                    variant="outline"
                    onClick={onCancel}
                    className="flex-1 border-white/35 bg-white text-slate-950 shadow-sm hover:bg-white/90 hover:text-slate-950 dark:bg-white dark:text-slate-950 dark:hover:bg-white/90 dark:hover:text-slate-950"
                  >
                    Cancelar
                  </Button>
                  <Button
                    onClick={handlePlayNow}
                    className="flex-1 bg-accent hover:bg-accent/90 text-accent-foreground"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Assistir agora
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
