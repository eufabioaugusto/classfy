import { ArrowRight } from "lucide-react";
import { PlanOfferCard } from "./PlanOfferCard";
import type { PaidPlan } from "@/config/planOffers";

interface PlanCardsProps {
  onSubscribe: (plan: PaidPlan) => void;
  currentPlan?: "free" | PaidPlan;
}

export function PlanCards({ onSubscribe, currentPlan = "free" }: PlanCardsProps) {
  return (
    <section id="plans" className="plans-pricing" aria-labelledby="plans-pricing-title">
      <div className="plans-container">
        <div className="plans-section-heading plans-section-heading--center">
          <span className="plans-eyebrow">ESCOLHA SEU RITMO</span>
          <h2 id="plans-pricing-title">Um plano para cada jornada.</h2>
          <p>Comece pelo que faz sentido para você. Mude ou cancele quando quiser.</p>
        </div>
        <div className="plans-pricing__grid">
          {(["pro", "premium"] as const).map((plan) => (
            <PlanOfferCard
              key={plan}
              plan={plan}
              current={currentPlan === plan}
              action={<button type="button" className={`plans-button ${plan === "premium" ? "plans-button--red" : "plans-button--dark"}`} onClick={() => onSubscribe(plan)}>{currentPlan === plan ? "Gerenciar assinatura" : `${currentPlan === "free" ? "Escolher" : "Mudar para"} ${plan === "pro" ? "Pro" : "Premium"}`} <ArrowRight size={17} /></button>}
            />
          ))}
        </div>
        <p className="plans-pricing__note">Os preços são mensais. Você poderá conferir os detalhes antes de concluir a assinatura.</p>
      </div>
    </section>
  );
}
