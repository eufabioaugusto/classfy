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
    <div className="w-full max-w-lg mx-auto">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-zinc-700/50 shadow-2xl">
        {/* Decorative gradient orbs */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#e21d48]/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl" />
        
        <div className="relative p-5 space-y-4">
          {/* Social proof */}
          <div className="flex items-center justify-center gap-2">
            <div className="flex -space-x-2">
              {avatars.map((avatar, i) => (
                <div 
                  key={i} 
                  className="w-7 h-7 rounded-full border-2 border-zinc-900 overflow-hidden"
                >
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Users className="w-3.5 h-3.5" />
              <span>+500 alunos já assinaram</span>
            </div>
          </div>

          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e21d48]/20 text-[#e21d48] text-xs font-medium">
              <Sparkles className="w-3 h-3" />
              Limite atingido
            </div>
            <h3 className="text-lg md:text-xl font-bold text-white">
              Continue sua jornada de aprendizado, {userName.split(' ')[0]}!
            </h3>
            <p className="text-sm text-zinc-400">
              Você usou <span className="text-white font-semibold">{messageCount}/{maxMessages}</span> mensagens. 
              Desbloqueie acesso ilimitado para aprender sem limites.
            </p>
          </div>

          {/* Plans */}
          <div className="grid grid-cols-2 gap-3">
            {plans.map((plan) => (
              <div 
                key={plan.id}
                className={`relative rounded-xl p-3 border ${plan.borderColor} ${plan.bgColor} transition-all hover:scale-[1.02] cursor-pointer`}
                onClick={() => navigate('/planos')}
              >
                {plan.popular && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gradient-to-r from-[#e21d48] to-rose-600 rounded-full text-[10px] font-bold text-white whitespace-nowrap">
                    MAIS POPULAR
                  </div>
                )}
                
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${plan.iconBg}`}>
                      <plan.icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <span className="font-bold text-white text-sm">{plan.name}</span>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] text-zinc-500 line-through">R$ {plan.originalPrice.toFixed(2).replace('.', ',')}</span>
                    <span className="text-base font-bold text-white">R$ {plan.price.toFixed(2).replace('.', ',')}</span>
                    <span className="text-[10px] text-zinc-400">/mês</span>
                  </div>

                  <div className="space-y-1">
                    {plan.features.map((feature, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-300">
                        <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* CTA Button */}
          <Button 
            className="w-full h-11 text-sm font-semibold bg-gradient-to-r from-[#e21d48] to-rose-600 hover:from-[#c91a3d] hover:to-rose-700 shadow-lg shadow-[#e21d48]/25 border-0"
            onClick={() => navigate('/planos')}
          >
            <Zap className="w-4 h-4 mr-2" />
            Fazer Upgrade Agora
          </Button>

          {/* Urgency text */}
          <p className="text-center text-[11px] text-zinc-500">
            ⏰ Oferta por tempo limitado • Cancele quando quiser
          </p>
        </div>
      </div>
    </div>
  );
}