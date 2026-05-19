import { Button } from "@/components/ui/button";
import { Zap, Crown, Check, Sparkles, Users } from "lucide-react";
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

  // Fake avatars for social proof
  const avatars = [
    "https://i.pravatar.cc/40?img=1",
    "https://i.pravatar.cc/40?img=2",
    "https://i.pravatar.cc/40?img=3",
    "https://i.pravatar.cc/40?img=4",
  ];

  return (
    <div className="w-full">
      <div className="relative overflow-hidden rounded-3xl border border-zinc-700/40 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-900 shadow-2xl">
        {/* Decorative gradient orbs */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#e21d48]/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl" />
        
        <div className="relative grid gap-5 p-5 lg:grid-cols-[1.15fr_1.25fr_220px] lg:items-center">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {avatars.map((avatar, i) => (
                  <div 
                    key={i} 
                    className="h-7 w-7 overflow-hidden rounded-full border-2 border-zinc-900"
                  >
                    <img src={avatar} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <Users className="h-3.5 w-3.5" />
                <span>+500 alunos já assinaram</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[#e21d48]/15 px-3 py-1 text-xs font-medium text-[#ff6b85]">
                <Sparkles className="h-3 w-3" />
                Limite atingido
              </div>
              <h3 className="text-xl font-bold text-white">
                Continue sua jornada de aprendizado, {userName.split(' ')[0]}.
              </h3>
              <p className="max-w-md text-sm leading-6 text-zinc-400">
                Você usou <span className="font-semibold text-white">{messageCount}/{maxMessages}</span> mensagens neste estudo. Desbloqueie mais profundidade sem interromper sua evolução.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((plan) => (
              <div 
                key={plan.id}
                className={`relative rounded-2xl p-4 border ${plan.borderColor} ${plan.bgColor} transition-all hover:scale-[1.01] cursor-pointer`}
                onClick={() => navigate('/planos')}
              >
                {plan.popular && (
                  <div className="absolute -top-2 left-4 rounded-full bg-gradient-to-r from-[#e21d48] to-rose-600 px-2 py-0.5 text-[10px] font-bold text-white">
                    MAIS POPULAR
                  </div>
                )}
                
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`rounded-lg p-1.5 ${plan.iconBg}`}>
                      <plan.icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="text-sm font-bold text-white">{plan.name}</span>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] text-zinc-500 line-through">R$ {plan.originalPrice.toFixed(2).replace('.', ',')}</span>
                    <span className="text-lg font-bold text-white">R$ {plan.price.toFixed(2).replace('.', ',')}</span>
                    <span className="text-[10px] text-zinc-400">/mês</span>
                  </div>

                  <div className="space-y-1.5">
                    {plan.features.map((feature, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                        <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <Button 
              className="h-11 w-full border-0 bg-gradient-to-r from-[#e21d48] to-rose-600 text-sm font-semibold shadow-lg shadow-[#e21d48]/25 hover:from-[#c91a3d] hover:to-rose-700"
              onClick={() => navigate('/planos')}
            >
              <Zap className="mr-2 h-4 w-4" />
              Fazer Upgrade Agora
            </Button>
            <p className="text-center text-[11px] text-zinc-500 lg:text-left">
              Oferta por tempo limitado • Cancele quando quiser
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
