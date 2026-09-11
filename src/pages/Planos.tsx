import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AppShell } from "@/components/layout";
import { PlansHero } from "@/components/plans/PlansHero";
import { PlanCards } from "@/components/plans/PlanCards";
import { PlansFeatures } from "@/components/plans/PlansFeatures";
import { PlansComparison } from "@/components/plans/PlansComparison";
import { PlansFAQ } from "@/components/plans/PlansFAQ";
import { PlansCTA } from "@/components/plans/PlansCTA";

export default function Planos() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const currentPlan = (profile?.plan || "free") as "free" | "pro" | "premium";

  const handleSubscribe = async (planType: "pro" | "premium") => {
    if (!user) {
      navigate("/auth");
      return;
    }

    // If user already has this plan, open customer portal to manage
    if (currentPlan === planType) {
      try {
        const { data, error } = await supabase.functions.invoke("customer-portal", {});
        if (error) throw error;
        if (data?.url) window.open(data.url, "_blank");
      } catch (error) {
        console.error("Error opening portal:", error);
        toast.error("Erro ao abrir gerenciamento da assinatura");
      }
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
        body: { plan: planType },
      });

      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (error) {
      console.error("Error creating checkout:", error);
      toast.error("Erro ao processar assinatura");
    }
  };

  return (
    <AppShell variant="home" title="Planos">
            <PlansHero />
            <PlanCards onSubscribe={handleSubscribe} currentPlan={currentPlan} />
            <PlansFeatures />
            <PlansComparison onSubscribe={handleSubscribe} />
            <PlansFAQ />
            <PlansCTA />
    </AppShell>
  );
}
