import { Button } from "@/components/ui/button";
import { Zap, Crown, Check, Sparkles } from "lucide-react";
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

  const plans = [
    {
      id: 'pro',
      name: 'Pro',
      icon: Zap,
      price: 29.90,
      originalPrice: 49.90,
      messages: 30,
      color: 'from-amber-500 to-yellow-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      iconBg: 'bg-gradient-to-br from-amber-500 to-yellow-500',
      features: ['30 mensagens por estudo', '50 estudos ativos', 'Desvios ilimitados'],
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: Crown,
      price: 59.90,
      originalPrice: 99.90,
      messages: Infinity,
      color: 'from-[#e21d48] to-rose-600',
      bgColor: 'bg-[#e21d48]/10',
      borderColor: 'border-[#e21d48]/30',
      iconBg: 'bg-gradient-to-br from-[#e21d48] to-rose-600',
      popular: true,
      features: ['Mensagens ilimitadas', 'Estudos ilimitados', 'Conteúdo exclusivo'],
    }
  ];

  return (
    <div className="w-full">
      <div className="relative overflow-hidden rounded-[30px] border border-zinc-700/40 bg-gradient-to-r from-zinc-950 via-zinc-900 to-[#151214] shadow-[0_20px_60px_rgba(0,0,0,0.24)]">
        {/* Decorative gradient orbs */}
        <div className="absolute -top-20 right-0 h-40 w-40 rounded-full bg-[#e21d48]/18 blur-3xl" />
        <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-primary/0 via-primary/70 to-primary/0" />
        
        <div className="relative grid gap-5 p-6 lg:grid-cols-[1.1fr_1fr_220px] lg:items-center">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[#e21d48]/15 px-3 py-1.5 text-xs font-medium text-[#ff6b85]">
              <Sparkles className="h-3.5 w-3.5" />
              Limite atingido
            </div>
            <h3 className="max-w-sm text-2xl font-semibold leading-tight text-white">
              Continue sua jornada de aprendizado, {userName.split(' ')[0]}.
            </h3>
            <p className="max-w-sm text-sm leading-7 text-zinc-400">
              Você usou <span className="font-semibold text-white">{messageCount}/{maxMessages}</span> mensagens neste estudo. Libere mais profundidade sem interromper sua evolução.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => (
              <div 
                key={plan.id}
                className={`relative rounded-[24px] p-4 border ${plan.borderColor} ${plan.bgColor} transition-all hover:scale-[1.01] cursor-pointer min-h-[180px]`}
                onClick={() => navigate('/planos')}
              >
                {plan.popular && (
                  <div className="absolute -top-2.5 left-4 rounded-full bg-gradient-to-r from-[#e21d48] to-rose-600 px-2.5 py-1 text-[10px] font-bold text-white shadow-lg shadow-[#e21d48]/20">
                    MAIS POPULAR
                  </div>
                )}
                
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-xl p-2 ${plan.iconBg}`}>
                      <plan.icon className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-base font-bold text-white">{plan.name}</span>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] text-zinc-500 line-through">R$ {plan.originalPrice.toFixed(2).replace('.', ',')}</span>
                    <span className="text-[2rem] font-bold text-white">R$ {plan.price.toFixed(2).replace('.', ',')}</span>
                    <span className="text-xs text-zinc-400">/mês</span>
                  </div>

                  <div className="space-y-1.5">
                    {plan.features.slice(0, 3).map((feature, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs text-zinc-300">
                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-4 rounded-[24px] border border-white/8 bg-white/4 p-5">
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">Desbloqueio imediato</p>
              <p className="text-sm leading-7 text-zinc-300">
                Continue a conversa sem travas e aproveite trilhas e aprofundamento com mais fôlego.
              </p>
            </div>
            <Button 
              className="h-12 w-full border-0 bg-gradient-to-r from-[#e21d48] to-rose-600 text-sm font-semibold shadow-lg shadow-[#e21d48]/25 hover:from-[#c91a3d] hover:to-rose-700"
              onClick={() => navigate('/planos')}
            >
              <Zap className="mr-2 h-4 w-4" />
              Fazer Upgrade Agora
            </Button>
            <p className="text-[11px] text-zinc-500">
              Oferta por tempo limitado • Cancele quando quiser
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
