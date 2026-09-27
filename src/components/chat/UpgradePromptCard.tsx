import { ArrowRight, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PlanOfferCard } from "@/components/plans/PlanOfferCard";

interface UpgradePromptCardProps {
  userName?: string;
  currentPlan: "free" | "pro" | "premium";
  messageCount: number;
  maxMessages: number;
}

export function UpgradePromptCard({ userName = "você", currentPlan, messageCount, maxMessages }: UpgradePromptCardProps) {
  const navigate = useNavigate();
  const firstName = userName.trim().split(" ")[0] || "você";
  const plans = currentPlan === "free" ? (["pro", "premium"] as const) : (["premium"] as const);

  return (
    <section className="study-upgrade" aria-labelledby="study-upgrade-title">
      <div className="study-upgrade__intro">
        <span className="study-upgrade__mark"><Sparkles size={18} /></span>
        <div>
          <span className="study-upgrade__eyebrow">CONTINUE SEU ESTUDO</span>
          <h3 id="study-upgrade-title">A conversa pode continuar, {firstName}.</h3>
          <p>Você usou {messageCount} de {maxMessages} mensagens neste estudo. Escolha o espaço que precisa para aprofundar o tema.</p>
        </div>
      </div>
      <div className={`study-upgrade__cards${plans.length === 1 ? " study-upgrade__cards--single" : ""}`}>
        {plans.map((plan) => <PlanOfferCard key={plan} plan={plan} compact action={<button type="button" className={`plans-button ${plan === "premium" ? "plans-button--red" : "plans-button--dark"}`} onClick={() => navigate("/planos")}>Ver plano {plan === "pro" ? "Pro" : "Premium"} <ArrowRight size={16} /></button>} />)}
      </div>
      <p className="study-upgrade__footnote">Valores mensais · Cancele quando quiser</p>
    </section>
  );
}
