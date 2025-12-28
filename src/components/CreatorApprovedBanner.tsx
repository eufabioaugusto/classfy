import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sparkles, Upload, X, PartyPopper } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function CreatorApprovedBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Check if banner was already dismissed (stored in localStorage)
    const dismissedKey = `creator_banner_dismissed_${user.id}`;
    if (localStorage.getItem(dismissedKey)) {
      setDismissed(true);
      return;
    }

    // Check for creator_approved notification directly from database
    const checkCreatorStatus = async () => {
      // First check if user has the notification
      const { data: notification } = await supabase
        .from("notifications")
        .select("id, is_read, created_at")
        .eq("user_id", user.id)
        .eq("type", "creator_approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!notification) return;

      // Also verify user is actually an approved creator
      const { data: profile } = await supabase
        .from("profiles")
        .select("creator_status")
        .eq("id", user.id)
        .single();

      if (profile?.creator_status === "approved") {
        setShowBanner(true);
      }
    };

    checkCreatorStatus();
  }, [user]);

  const handleDismiss = () => {
    setDismissed(true);
    if (user) {
      localStorage.setItem(`creator_banner_dismissed_${user.id}`, "true");
    }
  };

  const handleGoToStudio = () => {
    handleDismiss();
    navigate("/studio");
  };

  if (!showBanner || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="w-full max-w-7xl mb-6"
      >
        <Card className="relative overflow-hidden border-0 bg-gradient-to-r from-[#e21d48] via-[#ff4d6d] to-[#e21d48] p-6 md:p-8">
          {/* Background decoration */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 left-0 w-32 h-32 bg-white rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-40 h-40 bg-white rounded-full blur-3xl" />
          </div>

          {/* Dismiss button */}
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="relative flex flex-col md:flex-row items-center gap-6">
            {/* Icon */}
            <div className="flex-shrink-0">
              <div className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                <PartyPopper className="w-10 h-10 text-white" />
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-white text-xs font-medium mb-3">
                <Sparkles className="w-3 h-3" />
                <span>Novidade</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                Parabéns! Você agora é Creator! 🎉
              </h2>
              <p className="text-white/90 text-sm md:text-base max-w-xl">
                Sua solicitação foi aprovada! Acesse o Studio para começar a enviar seus conteúdos e
                ganhar dinheiro com suas criações.
              </p>
            </div>

            {/* CTA */}
            <div className="flex-shrink-0">
              <Button
                onClick={handleGoToStudio}
                size="lg"
                className="bg-white text-[#e21d48] hover:bg-white/90 font-semibold shadow-lg"
              >
                <Upload className="w-4 h-4 mr-2" />
                Acessar Studio
              </Button>
            </div>
          </div>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}
