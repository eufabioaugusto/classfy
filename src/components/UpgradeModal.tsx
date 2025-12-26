import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, User, Sparkles, Download, PlayCircle, Smartphone, Crown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredPlan?: "pro" | "premium";
}

export const UpgradeModal = ({ open, onOpenChange, requiredPlan = "pro" }: UpgradeModalProps) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async (planType: "pro" | "premium") => {
    if (!user) {
      onOpenChange(false);
      navigate("/auth");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
        body: { planType },
      });

      if (error) throw error;
      if (data?.url) {
        window.open(data.url, "_blank");
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Error creating checkout:", error);
      toast.error("Erro ao processar assinatura");
    }
  };

  const plans = [
    {
      id: "pro",
      icon: User,
      title: "Pro",
      price: "R$ 29,90",
      period: "/mês",
      description: "Acesso completo ao conteúdo premium",
      features: [
        "Conteúdos exclusivos sem anúncios",
        "Acesso ao Classy Chat (IA)",
        "Downloads ilimitados",
        "Suporte prioritário",
      ],
      highlighted: requiredPlan === "pro",
    },
    {
      id: "premium",
      icon: Sparkles,
      title: "Premium",
      price: "R$ 49,90",
      period: "/mês",
      description: "Todos os recursos + benefícios exclusivos",
      features: [
        "Tudo do plano Pro",
        "Acesso a cursos completos",
        "Assistir offline",
        "Reprodução em segundo plano",
        "Sessões de estudo com IA avançada",
      ],
      highlighted: requiredPlan === "premium",
      badge: "Mais Popular",
    },
  ];

  const exclusiveFeatures = [
    {
      icon: PlayCircle,
      title: "Assista vídeos sem interrupções",
      description: "Curta mais do seu conteúdo favorito sem anúncios.",
    },
    {
      icon: Download,
      title: "Assista vídeos no modo off-line",
      description: "Baixe seus vídeos favoritos para assistir quando quiser.",
    },
    {
      icon: Smartphone,
      title: "Curta o Classfy em segundo plano",
      description: "Continue acompanhando os vídeos, mesmo com a tela desligada.",
    },
  ];

  const comparisonFeatures = [
    { name: "Vídeos sem anúncios", free: false, pro: true, premium: true },
    { name: "Acesso ao Classy Chat", free: true, pro: true, premium: true },
    { name: "Downloads ilimitados", free: false, pro: true, premium: true },
    { name: "Cursos completos", free: false, pro: false, premium: true },
    { name: "Reprodução offline", free: false, pro: false, premium: true },
    { name: "Segundo plano", free: false, pro: false, premium: true },
  ];

  const faqs = [
    {
      question: "Quais são os benefícios do Premium?",
      answer: "O Premium oferece acesso completo a todos os conteúdos sem anúncios, downloads ilimitados para assistir offline, reprodução em segundo plano e acesso exclusivo a cursos completos.",
    },
    {
      question: "Qual é a diferença entre o Pro e o Premium?",
      answer: "O Pro oferece acesso aos conteúdos premium e downloads, enquanto o Premium adiciona cursos completos, reprodução offline e em segundo plano, além de recursos avançados de IA.",
    },
    {
      question: "Posso cancelar minha assinatura a qualquer momento?",
      answer: "Sim, você pode cancelar sua assinatura quando quiser. O acesso continuará até o fim do período pago.",
    },
    {
      question: "Como faço o download de vídeos?",
      answer: "Com a assinatura ativa, você verá um botão de download em cada vídeo. Basta clicar para salvar e assistir offline.",
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:w-[85%] sm:max-w-[1200px] p-0 overflow-hidden"
      >
        <ScrollArea className="h-full">
          <div className="p-6 md:p-10">
            {/* Header */}
            <SheetHeader className="text-center mb-10">
              <div className="flex items-center justify-center gap-2 mb-4">
                <Crown className="w-8 h-8 text-primary" />
                <Badge className="bg-primary text-primary-foreground">
                  Classfy Premium
                </Badge>
              </div>
              <SheetTitle className="text-3xl md:text-4xl font-bold">
                Você tem as ideias, nós temos os planos
              </SheetTitle>
              <p className="text-muted-foreground text-lg mt-2">
                Todo o Classfy sem interrupções. Conteúdo premium off-line, sem anúncios e em segundo plano.
              </p>
            </SheetHeader>

            {/* Plans Cards */}
            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mb-16">
              {plans.map((plan) => {
                const Icon = plan.icon;
                return (
                  <Card 
                    key={plan.id}
                    className={`relative transition-all ${
                      plan.highlighted 
                        ? "border-primary shadow-lg ring-2 ring-primary/20" 
                        : "hover:border-muted-foreground/30"
                    }`}
                  >
                    {plan.badge && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <Badge className="bg-primary text-primary-foreground shadow-md">
                          {plan.badge}
                        </Badge>
                      </div>
                    )}
                    <CardHeader className="pt-8">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-lg ${plan.highlighted ? 'bg-primary/10' : 'bg-muted'}`}>
                          <Icon className={`w-5 h-5 ${plan.highlighted ? 'text-primary' : ''}`} />
                        </div>
                        <CardTitle className="text-xl">{plan.title}</CardTitle>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-baseline gap-1">
                          <span className="text-3xl font-bold">{plan.price}</span>
                          <span className="text-muted-foreground">{plan.period}</span>
                        </div>
                        <CardDescription>{plan.description}</CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <ul className="space-y-3">
                        {plan.features.map((feature, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                            <span className="text-sm">{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <Button 
                        size="lg" 
                        className="w-full"
                        variant={plan.highlighted ? "default" : "outline"}
                        onClick={() => handleSubscribe(plan.id as "pro" | "premium")}
                      >
                        Assinar {plan.title}
                      </Button>
                      <p className="text-xs text-center text-muted-foreground">
                        Cancele a qualquer momento
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Exclusive Features */}
            <div className="mb-16">
              <h3 className="text-2xl font-bold text-center mb-8">
                Recursos exclusivos — somente no Premium
              </h3>
              <div className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto">
                {exclusiveFeatures.map((feature, idx) => {
                  const Icon = feature.icon;
                  return (
                    <div key={idx} className="text-center p-6 rounded-xl bg-muted/50">
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                        <Icon className="w-6 h-6 text-primary" />
                      </div>
                      <h4 className="font-semibold mb-2">{feature.title}</h4>
                      <p className="text-sm text-muted-foreground">{feature.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Comparison Table */}
            <div className="mb-16">
              <h3 className="text-2xl font-bold text-center mb-8">
                Comparar assinaturas
              </h3>
              <div className="max-w-4xl mx-auto overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-4 px-4 font-medium text-muted-foreground"></th>
                      <th className="text-center py-4 px-4">
                        <div className="text-sm font-semibold">Gratuito</div>
                        <div className="text-xs text-muted-foreground">R$ 0</div>
                      </th>
                      <th className="text-center py-4 px-4">
                        <div className="text-sm font-bold">Pro</div>
                        <div className="text-xs text-primary font-semibold">R$ 29,90/mês</div>
                      </th>
                      <th className="text-center py-4 px-4 relative">
                        <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary text-[10px]">
                          Recomendado
                        </Badge>
                        <div className="text-sm font-bold mt-2">Premium</div>
                        <div className="text-xs text-primary font-semibold">R$ 49,90/mês</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonFeatures.map((feature, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-4 px-4 text-sm">{feature.name}</td>
                        <td className="text-center py-4 px-4">
                          {feature.free ? (
                            <Check className="w-5 h-5 text-primary inline-block" />
                          ) : (
                            <X className="w-5 h-5 text-muted-foreground/40 inline-block" />
                          )}
                        </td>
                        <td className="text-center py-4 px-4">
                          {feature.pro ? (
                            <Check className="w-5 h-5 text-primary inline-block" />
                          ) : (
                            <X className="w-5 h-5 text-muted-foreground/40 inline-block" />
                          )}
                        </td>
                        <td className="text-center py-4 px-4 bg-primary/5">
                          {feature.premium ? (
                            <Check className="w-5 h-5 text-primary inline-block" />
                          ) : (
                            <X className="w-5 h-5 text-muted-foreground/40 inline-block" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td></td>
                      <td className="text-center py-4 px-4">
                        <Button variant="ghost" size="sm" disabled>
                          Plano atual
                        </Button>
                      </td>
                      <td className="text-center py-4 px-4">
                        <Button variant="outline" size="sm" onClick={() => handleSubscribe("pro")}>
                          Assinar
                        </Button>
                      </td>
                      <td className="text-center py-4 px-4 bg-primary/5">
                        <Button size="sm" onClick={() => handleSubscribe("premium")}>
                          Assinar
                        </Button>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* FAQ */}
            <div className="max-w-3xl mx-auto mb-10">
              <h3 className="text-2xl font-bold text-center mb-8">
                Perguntas frequentes
              </h3>
              <Accordion type="single" collapsible className="space-y-3">
                {faqs.map((faq, idx) => (
                  <AccordionItem 
                    key={idx} 
                    value={`item-${idx}`} 
                    className="border rounded-lg px-4 bg-muted/30"
                  >
                    <AccordionTrigger className="text-left hover:no-underline text-sm py-4">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground text-sm pb-4">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};
