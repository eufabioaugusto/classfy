import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Header } from "@/components/Header";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PlansHero } from "@/components/plans/PlansHero";
import { PlanCards } from "@/components/plans/PlanCards";
import { PlansFeatures } from "@/components/plans/PlansFeatures";
import { PlansComparison } from "@/components/plans/PlansComparison";
import { PlansFAQ } from "@/components/plans/PlansFAQ";
import { PlansCTA } from "@/components/plans/PlansCTA";

export default function Planos() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async (planType: "pro" | "premium") => {
    if (!user) {
      navigate("/auth");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
        body: { planType },
      });

      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
    } catch (error) {
      console.error("Error creating checkout:", error);
      toast.error("Erro ao processar assinatura");
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header variant="home" title="Planos" />
          <main className="flex-1">
            <PlansHero />
            <PlanCards onSubscribe={handleSubscribe} />
            <PlansFeatures />
            <PlansComparison onSubscribe={handleSubscribe} />
            <PlansFAQ />
            <PlansCTA />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
