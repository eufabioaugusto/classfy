export type ContentVisibility = "free" | "pro" | "premium" | "paid";
export type ViewerPlan = "free" | "pro" | "premium";
export type AccessBlockReason = "auth" | "plan" | "purchase" | null;

export interface ContentEntitlementInput {
  visibility?: ContentVisibility | null;
  userPlan?: string | null;
  isAuthenticated: boolean;
  isOwner?: boolean;
  isAdmin?: boolean;
  isModerationPreview?: boolean;
  isPurchased?: boolean;
}

export interface ContentEntitlement {
  hasAccess: boolean;
  reason: AccessBlockReason;
  requiredPlan: "pro" | "premium";
}

const normalizePlan = (plan?: string | null): ViewerPlan => {
  if (plan === "premium") return "premium";
  if (plan === "pro") return "pro";
  return "free";
};

export const evaluateContentEntitlement = ({
  visibility = "free",
  userPlan,
  isAuthenticated,
  isOwner = false,
  isAdmin = false,
  isModerationPreview = false,
  isPurchased = false,
}: ContentEntitlementInput): ContentEntitlement => {
  const requiredPlan = visibility === "premium" ? "premium" : "pro";

  if (!isAuthenticated) {
    return { hasAccess: false, reason: "auth", requiredPlan };
  }

  if (isOwner || (isAdmin && isModerationPreview)) {
    return { hasAccess: true, reason: null, requiredPlan };
  }

  if (visibility === "paid") {
    return {
      hasAccess: isPurchased,
      reason: isPurchased ? null : "purchase",
      requiredPlan,
    };
  }

  const plan = normalizePlan(userPlan);
  const hasAccess =
    visibility === "free" ||
    (visibility === "pro" && (plan === "pro" || plan === "premium")) ||
    (visibility === "premium" && plan === "premium");

  return {
    hasAccess,
    reason: hasAccess ? null : "plan",
    requiredPlan,
  };
};
