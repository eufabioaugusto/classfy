import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PlanOfferCard } from "@/components/plans/PlanOfferCard";
import type { PaidPlan } from "@/config/planOffers";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredPlan?: PaidPlan;
}

export const UpgradeModal = ({ open, onOpenChange, requiredPlan = "pro" }: UpgradeModalProps) => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const currentPlan = profile?.plan || "free";

  const handleSubscribe = async (planType: PaidPlan) => {
    if (!user) {
      onOpenChange(false);
      navigate("/auth");
      return;
    }
    if (currentPlan === "premium" && planType === "pro" && !window.confirm("Deseja mudar para o Pro ao fim do período atual?")) return;
    try {
      const samePlan = currentPlan === planType;
      const changingPaidPlan = currentPlan !== "free" && !samePlan;
      const functionName = samePlan ? "customer-portal" : changingPaidPlan ? "manage-subscription" : "create-subscription-checkout";
      const options = samePlan ? {} : changingPaidPlan
        ? { body: { action: planType === "premium" ? "upgrade" : "downgrade", newPlan: planType } }
        : { body: { plan: planType } };
      const { data, error } = await supabase.functions.invoke(functionName, options);
      if (error) throw error;
      if (changingPaidPlan) toast.success(data?.message || "Solicitação recebida");
      if (data?.url) {
        window.open(data.url, "_blank");
      }
      if (changingPaidPlan || data?.url) onOpenChange(false);
    } catch (error) {
      console.error("Error opening subscription flow:", error);
      toast.error("Erro ao abrir assinatura");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="upgrade-sheet w-full sm:w-[85%] sm:max-w-[900px] p-0 overflow-hidden border-l border-border">
        <ScrollArea className="h-full">
          <div className="upgrade-sheet__inner">
            <div className="upgrade-sheet__intro">
              <span className="upgrade-sheet__icon"><Sparkles size={20} /></span>
              <span className="upgrade-sheet__eyebrow">ESCOLHA SEU RITMO</span>
              <h2>Continue de onde sua curiosidade levou você.</h2>
              <p>{requiredPlan === "premium" ? "Este conteúdo pede Premium. Veja o que o plano libera antes de escolher." : "Assista com mais liberdade e aprofunde seus estudos com a Classy."}</p>
              <span className="upgrade-sheet__requirement"><LockKeyhole size={14} /> {requiredPlan === "premium" ? "Acesso necessário: Premium" : "Acesso necessário: Pro ou Premium"}</span>
            </div>
            <div className="upgrade-sheet__cards">
              {(["pro", "premium"] as const).map((plan) => (
                <div className={requiredPlan === "premium" && plan === "pro" ? "upgrade-sheet__lower-plan" : ""} key={plan}>
                  <PlanOfferCard
                    plan={plan}
                    compact
                    current={currentPlan === plan}
                    action={<button type="button" className={`plans-button ${plan === "premium" ? "plans-button--red" : "plans-button--dark"}`} disabled={requiredPlan === "premium" && plan === "pro" && currentPlan !== "pro"} onClick={() => handleSubscribe(plan)}>{requiredPlan === "premium" && plan === "pro" && currentPlan !== "pro" ? "Não libera este conteúdo" : currentPlan === plan ? "Gerenciar assinatura" : `${currentPlan === "free" ? "Escolher" : "Mudar para"} ${plan === "pro" ? "Pro" : "Premium"}`} <ArrowRight size={17} /></button>}
                  />
                  {requiredPlan === "premium" && plan === "pro" && <p className="upgrade-sheet__note">Pro não libera este conteúdo.</p>}
                </div>
              ))}
            </div>
            <p className="upgrade-sheet__footer">Cancele quando quiser. <button type="button" onClick={() => { onOpenChange(false); navigate("/planos"); }}>Compare todos os benefícios <ArrowRight size={14} /></button></p>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
