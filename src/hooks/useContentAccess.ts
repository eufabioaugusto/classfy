import { useAuth } from "@/contexts/AuthContext";
import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ContentAccessParams {
  visibility?: "free" | "pro" | "premium" | "paid";
  contentId?: string;
  isPurchased?: boolean;
}

export function useContentAccess() {
  const { user, profile, role } = useAuth();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredPlan, setRequiredPlan] = useState<"pro" | "premium">("pro");
  const [pendingContentId, setPendingContentId] = useState<string | null>(null);
  const [pendingContentPrice, setPendingContentPrice] = useState<number>(0);

  const userPlan = profile?.plan || "free";

  const checkAccess = useCallback(
    async ({
      visibility = "free",
      contentId,
      isPurchased = false,
    }: ContentAccessParams): Promise<boolean> => {
      // Admins always have access
      if (role === "admin") {
        return true;
      }

      // Check if content is paid
      if (visibility === "paid") {
        // If already marked as purchased, allow
        if (isPurchased) return true;

        // If user is logged in, check purchase in database
        if (user && contentId) {
          const { data: purchase } = await supabase
            .from("purchased_contents")
            .select("id")
            .eq("user_id", user.id)
            .eq("content_id", contentId)
            .maybeSingle();

          if (purchase) return true;
        }

        return false;
      }

      // Check plan-based access
      if (visibility === "free") {
        return true;
      } else if (visibility === "pro") {
        return ["pro", "premium"].includes(userPlan);
      } else if (visibility === "premium") {
        return userPlan === "premium";
      }

      return true;
    },
    [user, userPlan, role]
  );

  const checkAndHandleAccess = useCallback(
    async ({
      visibility = "free",
      contentId,
      isPurchased = false,
      price = 0,
    }: ContentAccessParams & { price?: number }): Promise<boolean> => {
      const hasAccess = await checkAccess({ visibility, contentId, isPurchased });

      if (!hasAccess) {
        setPendingContentId(contentId || null);
        setPendingContentPrice(price);

        if (visibility === "paid") {
          setShowPurchaseModal(true);
        } else if (visibility === "pro") {
          setRequiredPlan("pro");
          setShowUpgradeModal(true);
        } else if (visibility === "premium") {
          setRequiredPlan("premium");
          setShowUpgradeModal(true);
        }
        return false;
      }

      return true;
    },
    [checkAccess]
  );

  const closeModals = useCallback(() => {
    setShowUpgradeModal(false);
    setShowPurchaseModal(false);
    setPendingContentId(null);
  }, []);

  return {
    userPlan,
    checkAccess,
    checkAndHandleAccess,
    showUpgradeModal,
    setShowUpgradeModal,
    showPurchaseModal,
    setShowPurchaseModal,
    requiredPlan,
    pendingContentId,
    pendingContentPrice,
    closeModals,
  };
}
