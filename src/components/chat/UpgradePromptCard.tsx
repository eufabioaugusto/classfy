import { Button } from "@/components/ui/button";
import { Zap, Crown, Check, Sparkles, Users, MessageSquare, Infinity, Archive } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface UpgradePromptCardProps {
  userName?: string;
  currentPlan: 'free' | 'pro' | 'premium';
  messageCount: number;
  maxMessages: number;
  onArchiveAndNew?: () => void;
}

export function UpgradePromptCard({ 
  userName = "você",
  currentPlan,
  messageCount,
  maxMessages,
  onArchiveAndNew
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
      color: 'from-blue-500 to-cyan-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      features: ['30 mensagens por estudo', '50 estudos ativos', 'Desvios ilimitados'],
    },
    {
      id: 'premium',
      name: 'Premium',
      icon: Crown,
      price: 59.90,
      originalPrice: 99.90,
      messages: Infinity,
      color: 'from-amber-500 to-orange-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
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
    <div className="w-full max-w-xl mx-auto">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-900 to-zinc-800 border border-zinc-700/50 shadow-2xl">
        {/* Decorative gradient orbs */}
        <div className="absolute -top-20 -right-20 w-40 h-40 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-amber-500/10 rounded-full blur-3xl" />
        
        <div className="relative p-6 space-y-5">
          {/* Social proof */}
          <div className="flex items-center justify-center gap-2">
            <div className="flex -space-x-2">
              {avatars.map((avatar, i) => (
                <div 
                  key={i} 
                  className="w-8 h-8 rounded-full border-2 border-zinc-900 overflow-hidden"
                >
                  <img src={avatar} alt="" className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-zinc-400">
              <Users className="w-4 h-4" />
              <span>+500 alunos já assinaram</span>
            </div>
          </div>

          {/* Header */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
              <Sparkles className="w-3 h-3" />
              Limite atingido
            </div>
            <h3 className="text-xl md:text-2xl font-bold text-white">
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
                className={`relative rounded-xl p-4 border ${plan.borderColor} ${plan.bgColor} transition-all hover:scale-[1.02] cursor-pointer`}
                onClick={() => navigate('/planos')}
              >
                {plan.popular && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-full text-[10px] font-bold text-white">
                    MAIS POPULAR
                  </div>
                )}
                
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg bg-gradient-to-br ${plan.color}`}>
                      <plan.icon className="w-4 h-4 text-white" />
                    </div>
                    <span className="font-bold text-white">{plan.name}</span>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-xs text-zinc-500 line-through">R$ {plan.originalPrice.toFixed(2).replace('.', ',')}</span>
                    <span className="text-lg font-bold text-white">R$ {plan.price.toFixed(2).replace('.', ',')}</span>
                    <span className="text-xs text-zinc-400">/mês</span>
                  </div>

                  <div className="space-y-1.5">
                    {plan.features.map((feature, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs text-zinc-300">
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
            className="w-full h-12 text-base font-semibold bg-gradient-to-r from-primary to-primary/80 hover:from-primary/90 hover:to-primary/70 shadow-lg shadow-primary/25"
            onClick={() => navigate('/planos')}
          >
            <Zap className="w-5 h-5 mr-2" />
            Fazer Upgrade Agora
          </Button>

          {/* Archive option */}
          {onArchiveAndNew && (
            <button 
              onClick={onArchiveAndNew}
              className="w-full flex items-center justify-center gap-2 py-2 text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
            >
              <Archive className="w-4 h-4" />
              Ou arquivar este estudo e criar um novo
            </button>
          )}

          {/* Urgency text */}
          <p className="text-center text-xs text-zinc-500">
            ⏰ Oferta por tempo limitado • Cancele quando quiser
          </p>
        </div>
      </div>
    </div>
  );
}