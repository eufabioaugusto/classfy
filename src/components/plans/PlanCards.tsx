import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Crown } from "lucide-react";
import { motion } from "framer-motion";

interface PlanCardsProps {
  onSubscribe: (plan: "pro" | "premium") => void;
}

const plans = [
  {
    id: "pro" as const,
    icon: Zap,
    title: "Pro",
    price: "R$ 29,90",
    period: "/mês",
    description: "Para quem quer mais do Classfy",
    features: [
      "Conteúdos sem anúncios",
      "Classy Chat (IA) ilimitado",
      "Downloads ilimitados",
      "Suporte prioritário",
      "Badge Pro no perfil",
    ],
    highlighted: false,
  },
  {
    id: "premium" as const,
    icon: Crown,
    title: "Premium",
    price: "R$ 49,90",
    period: "/mês",
    description: "A experiência completa do Classfy",
    badge: "Recomendado",
    features: [
      "Tudo do plano Pro",
      "Cursos completos com certificado",
      "Modo offline",
      "Reprodução em segundo plano",
      "Sessões de estudo com IA avançada",
      "Acesso antecipado a novidades",
    ],
    highlighted: true,
  },
];

export function PlanCards({ onSubscribe }: PlanCardsProps) {
  return (
    <section id="plans" className="py-16 md:py-24 bg-muted/40">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">
            Escolha seu plano
          </h2>
          <p className="text-muted-foreground">
            Cancele a qualquer momento
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {plans.map((plan, index) => {
            const Icon = plan.icon;
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className={`relative rounded-2xl border bg-card p-8 ${
                  plan.highlighted
                    ? "border-accent shadow-sm"
                    : "border-border"
                }`}
              >
                {plan.badge && (
                  <Badge className="absolute -top-3 left-6 bg-accent text-accent-foreground text-xs px-3">
                    {plan.badge}
                  </Badge>
                )}

                <div className="flex items-center gap-2 mb-4">
                  <Icon className={`w-5 h-5 ${plan.highlighted ? "text-accent" : "text-foreground"}`} />
                  <h3 className="text-lg font-semibold text-foreground">{plan.title}</h3>
                </div>

                <p className="text-sm text-muted-foreground mb-5">{plan.description}</p>

                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-3xl font-bold text-foreground">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>

                <ul className="space-y-3 mb-8">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-center gap-2.5">
                      <Check className={`w-4 h-4 shrink-0 ${plan.highlighted ? "text-accent" : "text-foreground"}`} />
                      <span className="text-sm text-foreground/80">{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className={`w-full rounded-full h-11 font-medium ${
                    plan.highlighted
                      ? "bg-accent hover:bg-accent/90 text-accent-foreground"
                      : ""
                  }`}
                  variant={plan.highlighted ? "default" : "outline"}
                  onClick={() => onSubscribe(plan.id)}
                >
                  Assinar {plan.title}
                </Button>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
