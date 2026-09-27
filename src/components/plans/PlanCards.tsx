import { ArrowRight, Check, Crown, Sparkles, Zap } from "lucide-react";

interface PlanCardsProps {
  onSubscribe: (plan: "pro" | "premium") => void;
  currentPlan?: "free" | "pro" | "premium";
}

const plans = [
  {
    id: "pro" as const,
    icon: Zap,
    title: "Pro",
    price: "29,90",
    description: "Mais liberdade para assistir e estudar.",
    intro: "Para quem já encontrou o que gosta e quer ir além.",
    features: ["Vídeos sem anúncios", "Até 50 estudos com a Classy", "30 mensagens por estudo", "Downloads ilimitados", "Suporte prioritário"],
  },
  {
    id: "premium" as const,
    icon: Crown,
    title: "Premium",
    price: "49,90",
    description: "O seu jeito mais completo de aprender.",
    intro: "Para quem quer explorar sem limites.",
    features: ["Tudo do plano Pro", "Estudos e mensagens ilimitados", "Cursos completos com certificado", "Modo offline e segundo plano", "Acesso antecipado a novidades"],
  },
];

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
          {plans.map((plan) => {
            const Icon = plan.icon;
            const isCurrent = currentPlan === plan.id;
            return (
              <article className={`plans-price-card plans-price-card--${plan.id}`} key={plan.id}>
                <div className="plans-price-card__topline"><span className="plans-price-card__icon"><Icon size={19} /></span><span>{isCurrent ? "SEU PLANO" : plan.id === "premium" ? "EXPERIÊNCIA COMPLETA" : "MAIS LIBERDADE"}</span></div>
                <div className="plans-price-card__head"><div><h3>{plan.title}</h3><p>{plan.description}</p></div>{plan.id === "premium" && <Sparkles size={26} strokeWidth={1.4} />}</div>
                <p className="plans-price-card__intro">{plan.intro}</p>
                <div className="plans-price-card__price"><span>R$</span><strong>{plan.price}</strong><span>/ mês</span></div>
                <button type="button" className={`plans-button ${plan.id === "premium" ? "plans-button--red" : "plans-button--dark"}`} onClick={() => onSubscribe(plan.id)}>
                  {isCurrent ? "Gerenciar assinatura" : `Escolher ${plan.title}`} <ArrowRight size={17} />
                </button>
                <div className="plans-price-card__divider" />
                <p className="plans-price-card__includes">O que está incluído</p>
                <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} strokeWidth={2.4} /><span>{feature}</span></li>)}</ul>
              </article>
            );
          })}
        </div>
        <p className="plans-pricing__note">Os preços são mensais. Você poderá conferir os detalhes antes de concluir a assinatura.</p>
      </div>
    </section>
  );
}
