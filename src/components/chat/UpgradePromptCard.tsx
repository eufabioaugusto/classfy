import { Button } from "@/components/ui/button";
import { Crown, Check, Sparkles, LockOpen } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface UpgradePromptCardProps {
  userName?: string;
  currentPlan: 'free' | 'pro' | 'premium';
  messageCount: number;
  maxMessages: number;
}

export function UpgradePromptCard({
  userName = "você",
  currentPlan,
  messageCount,
  maxMessages
}: UpgradePromptCardProps) {
  const navigate = useNavigate();
  const firstName = userName.split(' ')[0];

  const plans = [
    {
      id: 'pro',
      name: 'Pro',
      icon: Crown,
      price: 29.90,
      originalPrice: 49.90,
      messages: 30,
      color: 'from-amber-500 to-yellow-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      iconBg: 'bg-gradient-to-br from-amber-500 to-yellow-500',
      features: ['Conteúdos sem anúncios', 'Classy Chat (IA) ilimitado', 'Downloads ilimitados', 'Suporte prioritário', 'Badge Pro no perfil'],
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: Crown,
      price: 49.90,
      originalPrice: 99.90,
      messages: Infinity,
      color: 'from-[#e21d48] to-rose-600',
      bgColor: 'bg-[#e21d48]/10',
      borderColor: 'border-[#e21d48]/30',
      iconBg: 'bg-gradient-to-br from-[#e21d48] to-rose-600',
      popular: true,
      features: ['Tudo do plano Pro', 'Cursos completos com certificado', 'Modo offline', 'Reprodução em segundo plano', 'Sessões de estudo com IA avançada', 'Acesso antecipado a novidades'],
    }
  ];

  return (
    <div className="w-full">
      <div className="relative overflow-hidden rounded-[28px] border border-border/70 bg-card shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/8 dark:bg-gradient-to-br dark:from-[#121216] dark:via-[#141218] dark:to-[#110f14] dark:shadow-[0_20px_60px_rgba(0,0,0,0.34)]">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/0 via-primary/45 to-primary/0" />
        <div className="absolute inset-y-0 left-0 hidden w-px bg-gradient-to-b from-primary/0 via-primary/55 to-primary/0 dark:block" />
        <div className="absolute right-0 top-0 h-40 w-40 rounded-full bg-primary/8 blur-3xl dark:bg-primary/15" />

        <div className="relative space-y-5 p-5 lg:p-6">
          <div className="space-y-3">
            <div className="space-y-2">
              <h3 className="max-w-2xl text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-foreground dark:text-white">
                Continue sua jornada de aprendizado, {firstName}.
              </h3>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground dark:text-zinc-300">
                Você usou <span className="font-semibold text-foreground dark:text-white">{messageCount}/{maxMessages}</span> mensagens neste estudo. Libere mais profundidade sem interromper sua evolução.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-stretch">
            <div className="grid gap-3 sm:grid-cols-2">
              {plans.map((plan) => (
                <button
                  type="button"
                  key={plan.id}
                  className={`relative rounded-[24px] border p-4 text-left transition-all hover:-translate-y-0.5 ${plan.id === "premium"
                    ? "border-primary/20 bg-primary/8 dark:border-primary/25 dark:bg-primary/10"
                    : "border-amber-500/20 bg-amber-500/8 dark:border-amber-500/25 dark:bg-amber-500/10"
                    }`}
                  onClick={() => navigate('/planos')}
                >
                  {plan.popular && (
                    <div className="absolute -top-2 right-4 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-foreground shadow-sm">
                      MAIS POPULAR
                    </div>
                  )}

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <div className={`rounded-xl p-2 ${plan.iconBg}`}>
                        <plan.icon className="h-4 w-4 text-white" />
                      </div>
                      <span className="text-base font-semibold text-foreground dark:text-white">{plan.name}</span>
                    </div>

                    <div className="flex items-end gap-2">
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-muted-foreground line-through dark:text-zinc-500">
                          R$ {plan.originalPrice.toFixed(2).replace('.', ',')}
                        </div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[2rem] font-semibold leading-none tracking-[-0.03em] text-foreground dark:text-white">
                            R$ {plan.price.toFixed(2).replace('.', ',')}
                          </span>
                          <span className="text-xs text-muted-foreground dark:text-zinc-400">/mês</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {plan.features.map((feature, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground dark:text-zinc-300">
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex flex-col justify-between rounded-[24px] border border-border/70 bg-background/70 p-5 dark:border-white/8 dark:bg-white/[0.04]">
              <div className="space-y-3">
                <p className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground dark:text-white/45">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500/15">
                    <LockOpen className="h-3 w-3 text-green-500" strokeWidth={3} />
                  </span>
                  Desbloqueio imediato
                </p>
                <p className="text-sm leading-7 text-foreground/85 dark:text-zinc-200">
                  Continue a conversa sem travas e aproveite trilhas e aprofundamento com mais fôlego.
                </p>
              </div>
              <div className="mt-5 space-y-3">
                <Button
                  className="h-12 w-full border-0 bg-[#e21d48] text-sm font-semibold text-white shadow-lg shadow-[#e21d48]/20 hover:bg-[#c91a3d]"
                  onClick={() => navigate('/planos')}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Fazer Upgrade Agora
                </Button>
                <p className="whitespace-nowrap text-[9px] mx-auto text-center text-muted-foreground dark:text-zinc-500">
                  Oferta por tempo limitado • Cancele quando quiser
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
