import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Check, X } from "lucide-react";
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
        className="cf-v2 cf2-creator-approved"
      >
        <div className="cf2-creator-approved__surface">
          <span className="cf2-creator-approved__status" aria-hidden="true"><Check /></span>
          <div className="cf2-creator-approved__copy">
            <span>Perfil aprovado</span>
            <h2>Seu Studio está pronto.</h2>
            <p>Publique seu primeiro conteúdo e comece sua jornada como Creator Classfy.</p>
          </div>

          <button type="button" onClick={handleGoToStudio} className="cf2-creator-approved__action">
            Acessar Studio <ArrowRight aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={handleDismiss}
            className="cf2-creator-approved__dismiss"
            aria-label="Fechar aviso"
          >
            <X />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
