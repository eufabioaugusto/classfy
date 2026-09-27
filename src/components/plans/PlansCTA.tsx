import { ArrowRight, Sparkles } from "lucide-react";

export function PlansCTA() {
  return <section className="plans-cta"><div className="plans-container"><div className="plans-cta__inner"><span className="plans-cta__mark"><Sparkles size={23} /></span><span className="plans-eyebrow">A SUA PRÓXIMA DESCOBERTA</span><h2>Tem muito mais para viver aqui.</h2><p>Encontre seu plano e continue explorando o que move a sua curiosidade.</p><button type="button" className="plans-button plans-button--red" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>Ver planos <ArrowRight size={17} /></button></div></div></section>;
}
