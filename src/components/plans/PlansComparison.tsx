import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, Crown } from "lucide-react";
import { motion } from "framer-motion";

interface PlansComparisonProps {
  onSubscribe: (plan: "pro" | "premium") => void;
}

const comparisonFeatures = [
  { name: "Acesso a conteúdos gratuitos", free: true, pro: true, premium: true },
  { name: "Vídeos sem anúncios", free: false, pro: true, premium: true },
  { name: "Acesso ao Classy Chat (IA)", free: "Limitado", pro: true, premium: true },
  { name: "Downloads ilimitados", free: false, pro: true, premium: true },
  { name: "Suporte prioritário", free: false, pro: true, premium: true },
  { name: "Badge exclusivo no perfil", free: false, pro: true, premium: true },
  { name: "Cursos completos", free: false, pro: false, premium: true },
  { name: "Certificados de conclusão", free: false, pro: false, premium: true },
  { name: "Reprodução offline", free: false, pro: false, premium: true },
  { name: "Reprodução em segundo plano", free: false, pro: false, premium: true },
  { name: "Sessões de estudo com IA", free: false, pro: false, premium: true },
  { name: "Acesso antecipado", free: false, pro: false, premium: true },
];

function CellValue({ value }: { value: boolean | string }) {
  if (typeof value === "string") {
    return <span className="text-xs text-muted-foreground font-medium">{value}</span>;
  }
  return value ? (
    <div className="w-6 h-6 rounded-full bg-accent/15 flex items-center justify-center mx-auto">
      <Check className="w-3.5 h-3.5 text-accent" />
    </div>
  ) : (
    <X className="w-4 h-4 text-muted-foreground/40 mx-auto" />
  );
}

export function PlansComparison({ onSubscribe }: PlansComparisonProps) {
  return (
    <section className="py-20 md:py-28 bg-muted/30">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Compare os planos
          </h2>
          <p className="text-muted-foreground text-lg">
            Encontre o plano perfeito para o seu ritmo de aprendizado
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto overflow-x-auto"
        >
          <table className="w-full min-w-[600px]">
            <thead>
              <tr>
                <th className="text-left py-4 px-4 w-[40%]" />
                <th className="text-center py-4 px-4 w-[20%]">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-muted-foreground">Gratuito</div>
                    <div className="text-lg font-bold text-foreground">R$ 0</div>
                  </div>
                </th>
                <th className="text-center py-4 px-4 w-[20%]">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-badge-pro">Pro</div>
                    <div className="text-lg font-bold text-foreground">R$ 29,90</div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-1 rounded-full text-xs"
                      onClick={() => onSubscribe("pro")}
                    >
                      Assinar
                    </Button>
                  </div>
                </th>
                <th className="text-center py-4 px-4 w-[20%] relative">
                  <Badge className="absolute -top-1 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground text-[10px] px-2">
                    <Crown className="w-2.5 h-2.5 mr-1" />
                    Recomendado
                  </Badge>
                  <div className="space-y-1 pt-4">
                    <div className="text-sm font-medium text-accent">Premium</div>
                    <div className="text-lg font-bold text-foreground">R$ 49,90</div>
                    <Button
                      size="sm"
                      className="mt-1 rounded-full text-xs bg-accent hover:bg-accent/90 text-accent-foreground"
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
                <tr key={idx} className="border-t border-border/50 hover:bg-muted/50 transition-colors">
                  <td className="py-3.5 px-4 text-sm text-foreground/80">{feature.name}</td>
                  <td className="text-center py-3.5 px-4"><CellValue value={feature.free} /></td>
                  <td className="text-center py-3.5 px-4"><CellValue value={feature.pro} /></td>
                  <td className="text-center py-3.5 px-4"><CellValue value={feature.premium} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      </div>
    </section>
  );
}
