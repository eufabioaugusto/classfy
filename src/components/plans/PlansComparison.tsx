import { Check, Minus } from "lucide-react";

interface PlansComparisonProps {
  onSubscribe: (plan: "pro" | "premium") => void;
  currentPlan?: "free" | "pro" | "premium";
}

const comparisonFeatures = [
  { name: "Conteúdos gratuitos", free: true, pro: true, premium: true },
  { name: "Vídeos sem anúncios", free: false, pro: true, premium: true },
  { name: "Estudos com a Classy", free: "Até 5", pro: "Até 50", premium: "Ilimitados" },
  { name: "Mensagens por estudo", free: "Até 5", pro: "Até 30", premium: "Ilimitadas" },
  { name: "Downloads ilimitados", free: false, pro: true, premium: true },
  { name: "Suporte prioritário", free: false, pro: true, premium: true },
  { name: "Cursos completos", free: false, pro: false, premium: true },
  { name: "Certificados", free: false, pro: false, premium: true },
  { name: "Modo offline", free: false, pro: false, premium: true },
  { name: "Segundo plano", free: false, pro: false, premium: true },
];

function CellValue({ value }: { value: boolean | string }) {
  if (typeof value === "string") return <span className="plans-compare__value">{value}</span>;
  return value ? <Check size={17} strokeWidth={2.5} className="plans-compare__check" aria-label="Incluído" /> : <Minus size={15} className="plans-compare__minus" aria-label="Não incluído" />;
}

export function PlansComparison({ onSubscribe, currentPlan = "free" }: PlansComparisonProps) {
  return <section className="plans-compare" aria-labelledby="plans-compare-title"><div className="plans-container"><div className="plans-section-heading"><span className="plans-eyebrow">TODOS OS DETALHES</span><h2 id="plans-compare-title">Compare com clareza.</h2><p>Veja o que acompanha cada escolha.</p></div><div className="plans-compare__scroll"><table><thead><tr><th scope="col">Benefícios</th><th scope="col">Free</th><th scope="col">Pro <small>R$ 29,90/mês</small></th><th scope="col">Premium <small>R$ 49,90/mês</small></th></tr></thead><tbody>{comparisonFeatures.map((feature) => <tr key={feature.name}><th scope="row">{feature.name}</th><td><CellValue value={feature.free} /></td><td><CellValue value={feature.pro} /></td><td><CellValue value={feature.premium} /></td></tr>)}</tbody><tfoot><tr><td /><td>Seu ponto de partida</td><td><button type="button" onClick={() => onSubscribe("pro")}>{currentPlan === "pro" ? "Gerenciar" : "Escolher Pro"}</button></td><td><button type="button" onClick={() => onSubscribe("premium")}>{currentPlan === "premium" ? "Gerenciar" : "Escolher Premium"}</button></td></tr></tfoot></table></div></div></section>;
}
