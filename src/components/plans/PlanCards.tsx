import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, User, Crown, Sparkles, Zap } from "lucide-react";
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
    description: "Para quem quer mais do Classfy sem limites",
    features: [
      "Conteúdos exclusivos sem anúncios",
      "Acesso ilimitado ao Classy Chat (IA)",
      "Downloads ilimitados de conteúdos",
      "Suporte prioritário 24/7",
      "Badge Pro no perfil",
    ],
    highlighted: false,
    gradient: "from-badge-pro/10 to-badge-pro/5",
    borderColor: "border-badge-pro/30",
    iconBg: "bg-badge-pro/15",
    iconColor: "text-badge-pro",
    btnVariant: "outline" as const,
  },
  {
    id: "premium" as const,
    icon: Crown,
    title: "Premium",
    price: "R$ 49,90",
    period: "/mês",
    description: "A experiência completa — tudo do Classfy é seu",
    features: [
      "Tudo do plano Pro incluso",
      "Cursos completos com certificado",
      "Modo offline — assista sem internet",
      "Reprodução em segundo plano",
      "Sessões de estudo com IA avançada",
      "Acesso antecipado a novos recursos",
    ],
    highlighted: true,
    badge: "Mais popular",
    gradient: "from-accent/15 to-badge-premium/10",
    borderColor: "border-accent/40",
    iconBg: "bg-accent/15",
    iconColor: "text-accent",
    btnVariant: "default" as const,
  },
];

export function PlanCards({ onSubscribe }: PlanCardsProps) {
  return (
    <section id="plans" className="py-20 md:py-28">
      <div className="container mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <Badge variant="outline" className="mb-4 px-3 py-1">
            <Sparkles className="w-3 h-3 mr-1.5" />
            Planos
          </Badge>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Escolha seu plano ideal
          </h2>
          <p className="text-muted-foreground text-lg max-w-xl mx-auto">
            Invista no seu aprendizado com as melhores ferramentas e conteúdos
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6 md:gap-8 max-w-5xl mx-auto">
          {plans.map((plan, index) => {
            const Icon = plan.icon;
            return (
              <motion.div
                key={plan.id}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15 }}
                className="relative"
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                    <Badge className="bg-accent text-accent-foreground shadow-lg shadow-accent/25 px-4 py-1">
                      {plan.badge}
                    </Badge>
                  </div>
                )}

                <div
                  className={`relative h-full rounded-2xl border ${plan.borderColor} bg-gradient-to-b ${plan.gradient} backdrop-blur-sm p-8 md:p-10 transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${
                    plan.highlighted ? "shadow-lg shadow-accent/10" : ""
                  }`}
                >
                  {/* Plan icon & name */}
                  <div className="flex items-center gap-3 mb-6">
                    <div className={`w-12 h-12 rounded-xl ${plan.iconBg} flex items-center justify-center`}>
                      <Icon className={`w-6 h-6 ${plan.iconColor}`} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-foreground">{plan.title}</h3>
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl md:text-5xl font-bold text-foreground">{plan.price}</span>
                      <span className="text-muted-foreground text-lg">{plan.period}</span>
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="space-y-4 mb-10">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-3">
                        <div className={`w-5 h-5 rounded-full ${plan.iconBg} flex items-center justify-center shrink-0 mt-0.5`}>
                          <Check className={`w-3 h-3 ${plan.iconColor}`} />
                        </div>
                        <span className="text-sm text-foreground/80">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Button
                    size="lg"
                    className={`w-full h-13 text-base font-semibold rounded-xl ${
                      plan.highlighted
                        ? "bg-accent hover:bg-accent/90 text-accent-foreground shadow-lg shadow-accent/20"
                        : ""
                    }`}
                    variant={plan.btnVariant}
                    onClick={() => onSubscribe(plan.id)}
                  >
                    Assinar {plan.title}
                  </Button>
                  <p className="text-xs text-center text-muted-foreground mt-3">
                    Sem fidelidade • Cancele a qualquer momento
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
