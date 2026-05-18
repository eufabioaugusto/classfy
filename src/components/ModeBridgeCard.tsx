import { ArrowRight, Compass, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UserPlan = "free" | "pro" | "premium";

interface ModeBridgeCardProps {
  variant: "explore-to-focus" | "focus-to-explore";
  isLoggedIn: boolean;
  plan: UserPlan;
  onAction: () => void;
  className?: string;
}

type BridgeContent = {
  badge: string;
  planLabel: string;
  title: string;
  description: string;
  cta: string;
  icon: typeof Sparkles;
};

const socialProofAvatars = [
  "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=face",
  "https://images.unsplash.com/photo-1573497019940-1c28c88b4f3e?w=100&h=100&fit=crop&crop=face",
];

function getBridgeContent(
  variant: ModeBridgeCardProps["variant"],
  isLoggedIn: boolean,
  plan: UserPlan,
): BridgeContent {
  if (variant === "explore-to-focus") {
    if (!isLoggedIn) {
      return {
        badge: "Classy personalizada",
        planLabel: "Comece grátis e evolua quando quiser",
        title: "Quer parar de só explorar e já sair com um estudo pronto?",
        description: "Diga o tema e a Classy monta um caminho de aprendizado guiado para você em segundos.",
        cta: "Criar meu estudo",
        icon: Sparkles,
      };
    }

    if (plan === "premium") {
      return {
        badge: "Modo foco premium",
        planLabel: "Você já tem estudos ilimitados e contexto contínuo",
        title: "Ative a Classy e transforme qualquer tema em um estudo com memória e direção.",
        description: "Você já tem acesso total. Saia da navegação e entre em uma jornada estratégica com próximos passos claros.",
        cta: "Abrir modo foco",
        icon: Target,
      };
    }

    if (plan === "pro") {
      return {
        badge: "Estude com estratégia",
        planLabel: "Mais profundidade no Premium, sem perder velocidade",
        title: "Escolha um tema e deixe a Classy organizar o que estudar agora.",
        description: "Em vez de procurar tudo manualmente, gere um estudo guiado com contexto, foco e continuidade.",
        cta: "Começar estudo",
        icon: Sparkles,
      };
    }

    return {
      badge: "Da descoberta para o progresso",
      planLabel: "Você pode começar agora e destravar estudos ilimitados depois",
      title: "Encontrou um tema interessante? A Classy pode virar isso em estudo na hora.",
      description: "Crie um estudo personalizado e troque a busca solta por uma trilha clara de aprendizado.",
      cta: "Quero estudar",
      icon: Sparkles,
    };
  }

  if (!isLoggedIn) {
    return {
      badge: "Explorar também ensina",
      planLabel: "Comece grátis explorando creators, aulas e formatos",
      title: "Antes de abrir um estudo, veja creators, aulas e formatos que podem ampliar sua visão.",
      description: "Explore o que está em alta e descubra temas, vozes e conteúdos que você talvez nem estivesse procurando.",
      cta: "Explorar conteúdos",
      icon: Compass,
    };
  }

  if (plan === "premium") {
    return {
      badge: "Curadoria + repertório",
      planLabel: "Premium também é repertório ilimitado, não só estudo guiado",
      title: "Seu próximo grande insight pode estar no catálogo que você ainda não explorou.",
      description: "Descubra creators, aulas, podcasts e shorts para enriquecer o estudo que a Classy vai aprofundar depois.",
      cta: "Ver o explorar",
      icon: Compass,
    };
  }

  if (plan === "pro") {
    return {
      badge: "Não fique só no prompt",
      planLabel: "Veja o catálogo antes de decidir onde aprofundar",
      title: "Explore creators e conteúdos em alta antes de definir o próximo foco.",
      description: "A navegação ajuda você a encontrar repertório, referências e atalhos melhores para o estudo guiado.",
      cta: "Quero explorar",
      icon: Compass,
    };
  }

  return {
    badge: "Veja o que está rolando",
    planLabel: "Do catálogo ao estudo guiado, no seu ritmo",
    title: "Talvez o melhor próximo estudo comece descobrindo o que já está em alta na Classfy.",
    description: "Explore creators e conteúdos antes de decidir o tema que a Classy vai organizar para você.",
    cta: "Explorar agora",
    icon: Compass,
  };
}

export function ModeBridgeCard({
  variant,
  isLoggedIn,
  plan,
  onAction,
  className,
}: ModeBridgeCardProps) {
  const content = getBridgeContent(variant, isLoggedIn, plan);
  const Icon = content.icon;
  const isExploreVariant = variant === "explore-to-focus";

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[24px] border shadow-[0_20px_60px_-36px_rgba(0,0,0,0.65)]",
        "bg-gradient-to-r backdrop-blur-sm",
        isExploreVariant
          ? "border-cinematic-accent/20 from-cinematic-accent/[0.14] via-background to-background"
          : "border-primary/20 from-primary/[0.08] via-background to-background",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0",
          isExploreVariant
            ? "bg-[radial-gradient(circle_at_12%_20%,rgba(239,68,68,0.18),transparent_24%),radial-gradient(circle_at_88%_50%,rgba(239,68,68,0.08),transparent_22%)]"
            : "bg-[radial-gradient(circle_at_12%_20%,rgba(99,102,241,0.16),transparent_24%),radial-gradient(circle_at_88%_50%,rgba(16,185,129,0.08),transparent_22%)]",
        )}
      />

      <div className="relative flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-4.5 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex min-w-0 items-center gap-3.5">
          {isExploreVariant ? (
            <div
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border text-foreground shadow-inner",
                "border-cinematic-accent/20 bg-cinematic-accent/12",
              )}
            >
              <Icon className="h-5 w-5 text-cinematic-accent" />
            </div>
          ) : (
            <div className="flex shrink-0 items-center">
              <div className="flex -space-x-2.5">
                {socialProofAvatars.map((src, index) => (
                  <img
                    key={src}
                    src={src}
                    alt={`Creator ${index + 1}`}
                    className="h-10 w-10 rounded-full border-2 border-background object-cover shadow-sm"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-border/40 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {content.badge}
              </span>
              <span className="text-[11px] font-medium text-muted-foreground/90 sm:text-xs">
                {content.planLabel}
              </span>
            </div>
            <h2 className="max-w-4xl text-[15px] font-semibold leading-tight text-foreground sm:text-lg lg:text-[1.35rem]">
              {content.title}
            </h2>
            <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground sm:text-sm">
              {content.description}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            onClick={onAction}
            className={cn(
              "h-10 rounded-2xl px-4 text-sm font-semibold shadow-lg transition-all sm:h-11 sm:px-5",
              isExploreVariant
                ? "bg-cinematic-accent text-white hover:bg-cinematic-accent/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {content.cta}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </section>
  );
}
