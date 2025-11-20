import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Crown } from "lucide-react";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredPlan: "pro" | "premium";
}

export const UpgradeModal = ({ open, onOpenChange, requiredPlan }: UpgradeModalProps) => {
  const plans = [
    {
      name: "Pro",
      price: "R$ 29,90",
      period: "/mês",
      features: [
        "Acesso a todos os conteúdos PRO",
        "Suporte prioritário",
        "Downloads ilimitados",
        "Certificados de conclusão"
      ],
      highlighted: requiredPlan === "pro",
      color: "from-yellow-500 to-amber-600"
    },
    {
      name: "Premium",
      price: "R$ 49,90",
      period: "/mês",
      features: [
        "Tudo do plano Pro",
        "Acesso a conteúdos Premium exclusivos",
        "Mentoria em grupo mensal",
        "Acesso antecipado a novos conteúdos",
        "Badge Premium no perfil"
      ],
      highlighted: requiredPlan === "premium",
      color: "from-red-500 to-rose-600"
    }
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <Crown className="w-6 h-6 text-primary" />
            Upgrade Necessário
          </DialogTitle>
          <DialogDescription>
            Este conteúdo requer o plano {requiredPlan === "pro" ? "Pro" : "Premium"}. 
            Escolha o plano ideal para você:
          </DialogDescription>
        </DialogHeader>
        
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`p-6 relative overflow-hidden ${
                plan.highlighted ? "ring-2 ring-primary" : ""
              }`}
            >
              {plan.highlighted && (
                <div className="absolute top-0 right-0 bg-primary text-primary-foreground text-xs px-3 py-1 rounded-bl-lg font-semibold">
                  Recomendado
                </div>
              )}
              
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold mb-1">{plan.name}</h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold">{plan.price}</span>
                    <span className="text-muted-foreground">{plan.period}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  {plan.features.map((feature, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <span className="text-sm">{feature}</span>
                    </div>
                  ))}
                </div>

                <Button 
                  className={`w-full bg-gradient-to-r ${plan.color} hover:opacity-90`}
                  onClick={() => {
                    // TODO: Implementar integração de pagamento
                    console.log(`Upgrade to ${plan.name}`);
                  }}
                >
                  Assinar {plan.name}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
