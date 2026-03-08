import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Check, X, Users, User, GraduationCap, Sparkles, Download, PlayCircle, Smartphone, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { STRIPE_PRODUCTS } from "@/config/stripe";
import { Header } from "@/components/Header";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

export default function Planos() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleSubscribe = async (planType: "pro" | "premium") => {
    if (!user) {
      navigate("/auth");
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
        body: { planType },
      });

      if (error) throw error;
      if (data?.url) window.open(data.url, "_blank");
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
      highlighted: false,
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
      highlighted: true,
      badge: "Recomendado",
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
      description: "Baixe seus vídeos favoritos para assistir quando quiser, com ou sem Internet.",
    },
    {
      icon: Smartphone,
      title: "Curta o Classfy em segundo plano",
      description: "Continue acompanhando os vídeos, mesmo com a tela desligada ou enquanto usa outros apps.",
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
    {
      question: "Como faço para reproduzir vídeos em segundo plano?",
      answer: "Com o Premium ativo, os vídeos continuarão reproduzindo mesmo quando você minimizar o app ou desligar a tela.",
    },
  ];

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col">
          <Header variant="home" title="Planos" />
      {/* Hero Section */}
        <div className="container mx-auto px-4 py-20 md:py-32">
          <div className="text-center max-w-4xl mx-auto space-y-6">
            <Badge className="bg-primary text-primary-foreground mb-4">
              Classfy Premium
            </Badge>
            <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
              Todo o Classfy sem interrupções.
            </h1>
            <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
              Conteúdo premium off-line, sem anúncios e em segundo plano
            </p>
            <div className="pt-4 space-y-2">
              <p className="text-sm text-muted-foreground">
                Planos a partir de R$ 29,90/mês • Cancele a qualquer momento
              </p>
              <Button size="lg" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>
                Escolha seu plano
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Plans Section */}
      <section id="plans" className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Junte-se aos milhares de assinantes Premium
            </h2>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => {
              const Icon = plan.icon;
              return (
                <Card 
                  key={plan.id}
                  className={`relative ${plan.highlighted ? "border-primary shadow-lg" : ""}`}
                >
                  {plan.badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground">
                        {plan.badge}
                      </Badge>
                    </div>
                  )}
                  <CardHeader>
                    <div className="flex items-center gap-3 mb-2">
                      <Icon className="w-6 h-6" />
                      <CardTitle className="text-2xl">{plan.title}</CardTitle>
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
        </div>
      </section>

      {/* Exclusive Features */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">
              Recursos exclusivos — somente no Premium
            </h2>
          </div>

          <div className="space-y-20 max-w-6xl mx-auto">
            {exclusiveFeatures.map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <div 
                  key={idx}
                  className={`grid md:grid-cols-2 gap-12 items-center ${
                    idx % 2 === 1 ? "md:flex-row-reverse" : ""
                  }`}
                >
                  <div className={idx % 2 === 1 ? "md:order-2" : ""}>
                    <Icon className="w-12 h-12 text-primary mb-4" />
                    <h3 className="text-2xl font-bold mb-4">{feature.title}</h3>
                    <p className="text-muted-foreground text-lg">{feature.description}</p>
                  </div>
                  <div className={idx % 2 === 1 ? "md:order-1" : ""}>
                    <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 rounded-lg flex items-center justify-center">
                      <Icon className="w-24 h-24 text-primary/40" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
            Comparar assinaturas
          </h2>

          <div className="max-w-4xl mx-auto overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-4 px-4 pt-10"></th>
                  <th className="text-center py-4 px-4 pt-10">
                    <div className="font-semibold">Gratuito</div>
                  </th>
                  <th className="text-center py-4 px-4 pt-10">
                    <div className="space-y-2">
                      <div className="font-bold text-lg">Pro</div>
                      <div className="text-xl font-bold text-primary">R$ 29,90/mês</div>
                      <Button size="sm" variant="outline" onClick={() => handleSubscribe("pro")}>
                        Assinar
                      </Button>
                    </div>
                  </th>
                  <th className="text-center py-4 px-4 pt-10 relative">
                    <Badge className="absolute top-2 left-1/2 -translate-x-1/2 bg-primary">
                      Recomendado
                    </Badge>
                    <div className="space-y-2">
                      <div className="font-bold text-lg">Premium</div>
                      <div className="text-xl font-bold text-primary">R$ 49,90/mês</div>
                      <Button size="sm" onClick={() => handleSubscribe("premium")}>
                        Assinar
                      </Button>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparisonFeatures.map((feature, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="py-4 px-4">{feature.name}</td>
                    <td className="text-center py-4 px-4">
                      {feature.free ? (
                        <Check className="w-5 h-5 text-primary inline-block" />
                      ) : (
                        <X className="w-5 h-5 text-muted-foreground inline-block" />
                      )}
                    </td>
                    <td className="text-center py-4 px-4">
                      {feature.pro ? (
                        <Check className="w-5 h-5 text-primary inline-block" />
                      ) : (
                        <X className="w-5 h-5 text-muted-foreground inline-block" />
                      )}
                    </td>
                    <td className="text-center py-4 px-4">
                      {feature.premium ? (
                        <Check className="w-5 h-5 text-primary inline-block" />
                      ) : (
                        <X className="w-5 h-5 text-muted-foreground inline-block" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-12">
            As respostas para suas perguntas
          </h2>

          <div className="max-w-3xl mx-auto">
            <Accordion type="single" collapsible className="space-y-4">
              {faqs.map((faq, idx) => (
                <AccordionItem key={idx} value={`item-${idx}`} className="border rounded-lg px-6">
                  <AccordionTrigger className="text-left hover:no-underline">
                    {faq.question}
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    {faq.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-20 bg-primary/10">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Quer testar o Premium?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            Cancele a qualquer momento
          </p>
          <Button size="lg" onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}>
            Escolha seu plano
          </Button>
        </div>
      </section>
    </div>
  );
}
