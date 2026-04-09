import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, X, Download, PlayCircle, Smartphone, Crown, Sparkles, Zap, Brain } from "lucide-react";
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
        body: { plan: planType },
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

  const exclusiveFeatures = [
    { icon: PlayCircle, title: "Sem interrupções", description: "Curta mais do seu conteúdo favorito sem nenhum anúncio." },
    { icon: Download, title: "Modo off-line", description: "Baixe seus vídeos favoritos e assista quando e onde quiser." },
    { icon: Smartphone, title: "Segundo plano", description: "Continue acompanhando vídeos com a tela desligada." },
    { icon: Brain, title: "IA Avançada", description: "Sessões de estudo personalizadas com o Classy Chat." },
    { icon: Zap, title: "Cursos completos", description: "Acesso a trilhas de aprendizado estruturadas do início ao fim." },
    { icon: Sparkles, title: "Suporte prioritário", description: "Atendimento dedicado sempre que você precisar." },
  ];

  const comparisonFeatures = [
    { name: "Vídeos sem anúncios", free: false, pro: true, premium: true },
    { name: "Acesso ao Classy Chat", free: true, pro: true, premium: true },
    { name: "Downloads ilimitados", free: false, pro: true, premium: true },
    { name: "Cursos completos", free: false, pro: false, premium: true },
    { name: "Reprodução offline", free: false, pro: false, premium: true },
    { name: "Segundo plano", free: false, pro: false, premium: true },
    { name: "IA Avançada", free: false, pro: false, premium: true },
  ];

  const faqs = [
    { question: "Quais são os benefícios do Premium?", answer: "O Premium oferece acesso completo a todos os conteúdos sem anúncios, downloads ilimitados para assistir offline, reprodução em segundo plano e acesso exclusivo a cursos completos." },
    { question: "Qual é a diferença entre Pro e Premium?", answer: "O Pro oferece acesso aos conteúdos premium e downloads, enquanto o Premium adiciona cursos completos, reprodução offline e em segundo plano, além de recursos avançados de IA." },
    { question: "Posso cancelar a qualquer momento?", answer: "Sim, você pode cancelar sua assinatura quando quiser. O acesso continuará até o fim do período já pago." },
    { question: "Como faço download de vídeos?", answer: "Com a assinatura ativa, um botão de download aparecerá em cada vídeo. Basta clicar para salvar e assistir offline." },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[85%] sm:max-w-[1100px] p-0 overflow-hidden border-l border-border"
      >
        <ScrollArea className="h-full">

          {/* ── Hero Header — works in both themes ── */}
          <div className="relative overflow-hidden border-b border-border bg-gradient-to-b from-red-50 to-background dark:from-red-950/30 dark:to-background px-8 py-12 text-center">
            {/* Subtle dot grid */}
            <div
              className="absolute inset-0 opacity-[0.06] dark:opacity-[0.05]"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
                backgroundSize: "28px 28px",
              }}
            />
            {/* Top red accent bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-red-600" />

            <div className="relative z-10 space-y-4 max-w-2xl mx-auto">
              <div className="flex items-center justify-center gap-2">
                <Crown className="w-4 h-4 text-red-600" />
                <span className="text-xs font-bold uppercase tracking-widest text-red-600 bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800/50 px-3 py-1 rounded-full">
                  Classfy Premium
                </span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground leading-tight">
                Você tem as ideias,{" "}
                <span className="text-red-600">nós temos os planos</span>
              </h1>
              <p className="text-muted-foreground text-base">
                Todo o Classfy sem interrupções. Conteúdo premium off-line, sem anúncios e em segundo plano.
              </p>
            </div>
          </div>

          <div className="px-6 md:px-10 py-10 space-y-16">

            {/* ── Plan Cards ── */}
            <div className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto">

              {/* Pro */}
              <div className={`relative rounded-2xl border p-7 flex flex-col gap-6 transition-all bg-card ${
                requiredPlan === "pro"
                  ? "border-red-500/60 shadow-[0_0_24px_rgba(220,38,38,0.10)] dark:shadow-[0_0_30px_rgba(220,38,38,0.15)]"
                  : "border-border"
              }`}>
                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Zap className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <span className="font-bold text-lg">Pro</span>
                  </div>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-3xl font-bold">R$ 29,90</span>
                    <span className="text-muted-foreground text-sm">/mês</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Acesso completo ao conteúdo premium</p>
                </div>
                <ul className="space-y-2.5 flex-1">
                  {["Conteúdos exclusivos sem anúncios", "Acesso ao Classy Chat (IA)", "Downloads ilimitados", "Suporte prioritário"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="w-4 h-4 text-red-600 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="space-y-2 text-center">
                  <Button size="lg" className="w-full" variant="outline" onClick={() => handleSubscribe("pro")}>
                    Assinar Pro
                  </Button>
                  <p className="text-xs text-muted-foreground">Cancele a qualquer momento</p>
                </div>
              </div>

              {/* Premium */}
              <div className="relative rounded-2xl border border-red-500/70 bg-red-50 dark:bg-red-950/20 p-7 flex flex-col gap-6 shadow-[0_4px_32px_rgba(220,38,38,0.12)] dark:shadow-[0_4px_32px_rgba(220,38,38,0.18)]">
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="text-[11px] font-bold uppercase tracking-wider bg-red-600 text-white px-3 py-1 rounded-full shadow">
                    Mais Popular
                  </span>
                </div>
                <div className="text-center space-y-1">
                  <div className="flex items-center justify-center gap-2 mb-3">
                    <div className="p-2 rounded-lg bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800/50">
                      <Crown className="w-4 h-4 text-red-600" />
                    </div>
                    <span className="font-bold text-lg">Premium</span>
                  </div>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-3xl font-bold">R$ 49,90</span>
                    <span className="text-muted-foreground text-sm">/mês</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Todos os recursos + benefícios exclusivos</p>
                </div>
                <ul className="space-y-2.5 flex-1">
                  {["Tudo do plano Pro", "Acesso a cursos completos", "Assistir offline", "Reprodução em segundo plano", "Sessões de estudo com IA avançada"].map((f) => (
                    <li key={f} className="flex items-center gap-2.5 text-sm">
                      <Check className="w-4 h-4 text-red-600 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="space-y-2 text-center">
                  <Button
                    size="lg"
                    className="w-full bg-red-600 hover:bg-red-700 text-white font-semibold shadow-[0_4px_16px_rgba(220,38,38,0.35)]"
                    onClick={() => handleSubscribe("premium")}
                  >
                    Assinar Premium
                  </Button>
                  <p className="text-xs text-muted-foreground">Cancele a qualquer momento</p>
                </div>
              </div>
            </div>

            {/* ── Exclusive Features ── */}
            <div className="text-center space-y-8">
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-red-600">Somente no Premium</p>
                <h2 className="text-2xl font-bold">Recursos exclusivos</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
                {exclusiveFeatures.map((feature, idx) => {
                  const Icon = feature.icon;
                  return (
                    <div key={idx} className="text-center p-5 rounded-xl border border-border bg-card hover:border-red-400/50 hover:bg-red-50 dark:hover:bg-red-950/10 transition-all group">
                      <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/50 border border-red-200 dark:border-red-900/50 flex items-center justify-center mx-auto mb-3 group-hover:bg-red-200 dark:group-hover:bg-red-900/60 transition-colors">
                        <Icon className="w-5 h-5 text-red-600" />
                      </div>
                      <h4 className="font-semibold text-sm mb-1">{feature.title}</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">{feature.description}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Comparison Table ── */}
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-red-600">Comparativo</p>
                <h2 className="text-2xl font-bold">Escolha seu plano</h2>
              </div>
              <div className="max-w-3xl mx-auto rounded-2xl border border-border overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left py-4 px-5 text-sm text-muted-foreground font-medium">Recurso</th>
                      <th className="text-center py-4 px-4">
                        <div className="text-sm font-semibold">Gratuito</div>
                        <div className="text-xs text-muted-foreground">R$ 0</div>
                      </th>
                      <th className="text-center py-4 px-4">
                        <div className="text-sm font-bold">Pro</div>
                        <div className="text-xs text-red-600 font-semibold">R$ 29,90/mês</div>
                      </th>
                      <th className="text-center py-4 px-4 bg-red-50 dark:bg-red-950/20">
                        <div className="text-xs font-bold uppercase tracking-wider text-red-600 mb-1">Recomendado</div>
                        <div className="text-sm font-bold">Premium</div>
                        <div className="text-xs text-red-600 font-semibold">R$ 49,90/mês</div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonFeatures.map((feature, idx) => (
                      <tr key={idx} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="py-3.5 px-5 text-sm">{feature.name}</td>
                        <td className="text-center py-3.5 px-4">
                          {feature.free
                            ? <Check className="w-4 h-4 text-red-600 inline-block" />
                            : <X className="w-4 h-4 text-muted-foreground/30 inline-block" />}
                        </td>
                        <td className="text-center py-3.5 px-4">
                          {feature.pro
                            ? <Check className="w-4 h-4 text-red-600 inline-block" />
                            : <X className="w-4 h-4 text-muted-foreground/30 inline-block" />}
                        </td>
                        <td className="text-center py-3.5 px-4 bg-red-50/60 dark:bg-red-950/10">
                          {feature.premium
                            ? <Check className="w-4 h-4 text-red-600 inline-block" />
                            : <X className="w-4 h-4 text-muted-foreground/30 inline-block" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-muted/30">
                      <td className="py-4 px-5" />
                      <td className="text-center py-4 px-4">
                        <Button variant="ghost" size="sm" disabled className="text-xs">Plano atual</Button>
                      </td>
                      <td className="text-center py-4 px-4">
                        <Button variant="outline" size="sm" className="text-xs" onClick={() => handleSubscribe("pro")}>Assinar</Button>
                      </td>
                      <td className="text-center py-4 px-4 bg-red-50/60 dark:bg-red-950/10">
                        <Button size="sm" className="text-xs bg-red-600 hover:bg-red-700 text-white" onClick={() => handleSubscribe("premium")}>Assinar</Button>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* ── FAQ ── */}
            <div className="max-w-2xl mx-auto space-y-6 pb-4">
              <div className="text-center space-y-2">
                <p className="text-xs font-bold uppercase tracking-widest text-red-600">Dúvidas</p>
                <h2 className="text-2xl font-bold">Perguntas frequentes</h2>
              </div>
              <Accordion type="single" collapsible className="space-y-2">
                {faqs.map((faq, idx) => (
                  <AccordionItem
                    key={idx}
                    value={`item-${idx}`}
                    className="border border-border rounded-xl px-5 bg-card hover:bg-muted/30 transition-colors data-[state=open]:border-red-400/50 data-[state=open]:bg-red-50 dark:data-[state=open]:bg-red-950/10"
                  >
                    <AccordionTrigger className="text-left hover:no-underline text-sm py-4 font-medium">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-muted-foreground text-sm pb-4 leading-relaxed">
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
