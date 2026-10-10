import { Crown, type LucideProps } from "lucide-react";
import type { PaidPlan } from "@/config/planOffers";

const PLAN_CROWN_COLORS: Record<PaidPlan, string> = {
  pro: "#e5aa25",
  premium: "var(--brand-red)",
};

type PlanCrownProps = Omit<LucideProps, "color"> & { plan: PaidPlan };

export function PlanCrown({ plan, style, ...props }: PlanCrownProps) {
  return (
    <Crown
      aria-hidden="true"
      fill="currentColor"
      strokeWidth={1.8}
      {...props}
      style={{ ...style, color: PLAN_CROWN_COLORS[plan] }}
    />
  );
}
