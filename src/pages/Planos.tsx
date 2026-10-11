import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useSubscriptionCheckout } from "@/components/billing/SubscriptionCheckoutProvider";
import { hasCurrentPaidPlan } from "@/lib/billing/subscriptionCheckout";
import { AppShell } from "@/components/layout";
import { PlansHero } from "@/components/plans/PlansHero";
import { PlanCards } from "@/components/plans/PlanCards";
import { PlansFeatures } from "@/components/plans/PlansFeatures";
import { PlansComparison } from "@/components/plans/PlansComparison";
import { PlansFAQ } from "@/components/plans/PlansFAQ";
import { PlansCTA } from "@/components/plans/PlansCTA";
import "@/styles/plans-v2.css";

export default function Planos() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { startSubscription } = useSubscriptionCheckout();
  const currentPlan = (hasCurrentPaidPlan(profile) ? profile!.plan : "free") as "free" | "pro" | "premium";

  const handleSubscribe = async (planType: "pro" | "premium") => {
    if (!user) {
      navigate("/auth");
      return;
    }

    if (currentPlan === planType || (currentPlan === "premium" && planType === "pro")) {
      navigate("/conta?tab=plan");
      return;
    }
    startSubscription(planType);
  };

  return (
    <AppShell variant="home" title="Planos">
      <div className="plans-v2">
        <PlansHero />
        <PlanCards onSubscribe={handleSubscribe} currentPlan={currentPlan} />
        <PlansFeatures />
        <PlansComparison onSubscribe={handleSubscribe} currentPlan={currentPlan} />
        <PlansFAQ />
        <PlansCTA />
      </div>
    </AppShell>
  );
}
