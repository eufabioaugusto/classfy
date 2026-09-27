import type { ReactNode } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { PLAN_OFFERS, type PaidPlan } from "@/config/planOffers";
import "@/styles/plans-v2.css";

interface PlanOfferCardProps {
  plan: PaidPlan;
  current?: boolean;
  compact?: boolean;
  action?: ReactNode;
}

export function PlanOfferCard({ plan, current = false, compact = false, action }: PlanOfferCardProps) {
  const offer = PLAN_OFFERS[plan];
  const Icon = offer.icon;

  return (
    <article className={`plans-price-card plans-price-card--${plan} plan-offer-card${compact ? " plan-offer-card--compact" : ""}`}>
      <div className="plans-price-card__topline">
        <span className="plans-price-card__icon"><Icon size={19} /></span>
        <span>{current ? "SEU PLANO" : offer.label}</span>
      </div>
      <div className="plans-price-card__head">
        <div><h3>{offer.title}</h3><p>{offer.description}</p></div>
        {plan === "premium" && <Sparkles size={26} strokeWidth={1.4} aria-hidden="true" />}
      </div>
      {!compact && <p className="plans-price-card__intro">{offer.intro}</p>}
      <div className="plans-price-card__price"><span>R$</span><strong>{offer.price}</strong><span>/ mês</span></div>
      {action && <div className="plan-offer-card__action">{action}</div>}
      <div className="plans-price-card__divider" />
      <p className="plans-price-card__includes">O que está incluído</p>
      <ul>{offer.features.map((feature) => <li key={feature}><Check size={16} strokeWidth={2.4} /><span>{feature}</span></li>)}</ul>
      {compact && !action && <ArrowRight className="plan-offer-card__arrow" size={17} aria-hidden="true" />}
    </article>
  );
}
