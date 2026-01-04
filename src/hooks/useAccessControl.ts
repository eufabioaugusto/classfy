import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type Visibility = "free" | "pro" | "premium" | "paid";
type BlockReason = "plan" | "purchase" | null;

interface AccessState {
  hasAccess: boolean;
  blockReason: BlockReason;
  requiredPlan: "pro" | "premium";
  isPurchased: boolean;
}

interface UseAccessControlProps {
  contentId?: string;
  visibility?: Visibility;
  price?: number;
  isCourse?: boolean;
}

export function useAccessControl() {
  const { user, profile, role } = useAuth();
  const [accessState, setAccessState] = useState<AccessState>({
    hasAccess: false,
    blockReason: null,
    requiredPlan: "pro",
    isPurchased: false,
  });
  const [loading, setLoading] = useState(false);

  const checkAccess = useCallback(async ({
    contentId,
    visibility = "free",
    price = 0,
    isCourse = false,
  }: UseAccessControlProps): Promise<AccessState> => {
    setLoading(true);

    try {
      // Default to blocked for safety
      let newState: AccessState = {
        hasAccess: false,
        blockReason: null,
        requiredPlan: "pro",
        isPurchased: false,
      };

      // Admins always have access
      if (role === "admin") {
        newState = {
          hasAccess: true,
          blockReason: null,
          requiredPlan: "pro",
          isPurchased: false,
        };
        setAccessState(newState);
        return newState;
      }

      // Not logged in
      if (!user || !profile) {
        if (visibility === "free") {
          newState = { hasAccess: true, blockReason: null, requiredPlan: "pro", isPurchased: false };
        } else if (visibility === "paid") {
          newState = { hasAccess: false, blockReason: "purchase", requiredPlan: "pro", isPurchased: false };
        } else {
          const requiredPlan = visibility === "premium" ? "premium" : "pro";
          newState = { hasAccess: false, blockReason: "plan", requiredPlan, isPurchased: false };
        }
        setAccessState(newState);
        return newState;
      }

      const userPlan = profile.plan || "free";

      // Handle paid content
      if (visibility === "paid" && contentId) {
        const { data: purchase } = await supabase
          .from("purchased_contents")
          .select("id")
          .eq("user_id", user.id)
          .eq("content_id", contentId)
          .maybeSingle();

        if (purchase) {
          newState = { hasAccess: true, blockReason: null, requiredPlan: "pro", isPurchased: true };
        } else {
          newState = { hasAccess: false, blockReason: "purchase", requiredPlan: "pro", isPurchased: false };
        }
        setAccessState(newState);
        return newState;
      }

      // Handle plan-based access
      if (visibility === "free") {
        newState = { hasAccess: true, blockReason: null, requiredPlan: "pro", isPurchased: false };
      } else if (visibility === "pro") {
        if (["pro", "premium"].includes(userPlan)) {
          newState = { hasAccess: true, blockReason: null, requiredPlan: "pro", isPurchased: false };
        } else {
          newState = { hasAccess: false, blockReason: "plan", requiredPlan: "pro", isPurchased: false };
        }
      } else if (visibility === "premium") {
        if (userPlan === "premium") {
          newState = { hasAccess: true, blockReason: null, requiredPlan: "premium", isPurchased: false };
        } else {
          newState = { hasAccess: false, blockReason: "plan", requiredPlan: "premium", isPurchased: false };
        }
      }

      setAccessState(newState);
      return newState;
    } finally {
      setLoading(false);
    }
  }, [user, profile, role]);

  const checkCourseEnrollment = useCallback(async (courseId: string): Promise<boolean> => {
    if (!user) return false;

    const { data } = await supabase
      .from("course_enrollments")
      .select("id")
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .maybeSingle();

    return !!data;
  }, [user]);

  return {
    ...accessState,
    loading,
    checkAccess,
    checkCourseEnrollment,
    userPlan: profile?.plan || "free",
  };
}
