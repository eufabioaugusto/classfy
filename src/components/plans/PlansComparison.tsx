import { Button } from "@/components/ui/button";
import { Check, X, Crown } from "lucide-react";
import { motion } from "framer-motion";

interface PlansComparisonProps {
  onSubscribe: (plan: "pro" | "premium") => void;
}

const comparisonFeatures = [
  { name: "Conteúdos gratuitos", free: true, pro: true, premium: true },
  { name: "Vídeos sem anúncios", free: false, pro: true, premium: true },
  { name: "Classy Chat (IA)", free: "Limitado", pro: true, premium: true },
  { name: "Downloads ilimitados", free: false, pro: true, premium: true },
  { name: "Suporte prioritário", free: false, pro: true, premium: true },
  { name: "Cursos completos", free: false, pro: false, premium: true },
  { name: "Certificados", free: false, pro: false, premium: true },
  { name: "Modo offline", free: false, pro: false, premium: true },
  { name: "Segundo plano", free: false, pro: false, premium: true },
  { name: "Estudo com IA avançada", free: false, pro: false, premium: true },
];

function CellValue({ value }: { value: boolean | string }) {
  if (typeof value === "string") {
    return <span className="text-xs text-muted-foreground">{value}</span>;
  }
  return value ? (
    <Check className="w-5 h-5 text-accent mx-auto" />
  ) : (
    <X className="w-4 h-4 text-muted-foreground/30 mx-auto" />
  );
}

export function PlansComparison({ onSubscribe }: PlansComparisonProps) {
  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-bold text-center text-foreground mb-12"
        >
          Compare os planos
        </motion.h2>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-3xl mx-auto overflow-x-auto"
        >
          <table className="w-full min-w-[500px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-4 px-3 w-[40%]" />
                <th className="text-center py-4 px-3">
                  <span className="text-sm text-muted-foreground">Gratuito</span>
                </th>
                <th className="text-center py-4 px-3">
                  <div className="space-y-1">
                    <span className="text-sm font-semibold text-foreground">Pro</span>
                    <div className="text-xs text-muted-foreground">R$ 29,90/mês</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-full text-xs h-7 mt-1"
                      onClick={() => onSubscribe("pro")}
                    >
                      Assinar
                    </Button>
                  </div>
                </th>
                <th className="text-center py-4 px-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-center gap-1">
                      <Crown className="w-3.5 h-3.5 text-accent" />
                      <span className="text-sm font-semibold text-foreground">Premium</span>
                    </div>
                    <div className="text-xs text-muted-foreground">R$ 49,90/mês</div>
                    <Button
                      size="sm"
                      className="rounded-full text-xs h-7 mt-1 bg-accent hover:bg-accent/90 text-accent-foreground"
                      onClick={() => onSubscribe("premium")}
                    >
                      Assinar
                    </Button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {comparisonFeatures.map((feature, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  <td className="py-3.5 px-3 text-sm text-foreground">{feature.name}</td>
                  <td className="text-center py-3.5 px-3"><CellValue value={feature.free} /></td>
                  <td className="text-center py-3.5 px-3"><CellValue value={feature.pro} /></td>
                  <td className="text-center py-3.5 px-3"><CellValue value={feature.premium} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}
