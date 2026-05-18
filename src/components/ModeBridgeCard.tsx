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
  title: string;
  description: string;
  cta: string;
  icon: typeof Sparkles;
};

function getBridgeContent(
  variant: ModeBridgeCardProps["variant"],
  isLoggedIn: boolean,
  plan: UserPlan,
): BridgeContent {
  if (variant === "explore-to-focus") {
    if (!isLoggedIn) {
      return {
        badge: "Classy personalizada",
        title: "Quer parar de só explorar e já sair com um estudo pronto?",
        description: "Diga o tema e a Classy monta um caminho de aprendizado guiado para você em segundos.",
        cta: "Criar meu estudo",
        icon: Sparkles,
      };
    }

    if (plan === "premium") {
      return {
        badge: "Modo foco premium",
        title: "Ative a Classy e transforme qualquer tema em um estudo com memória e direção.",
        description: "Você já tem acesso total. Saia da navegação e entre em uma jornada estratégica com próximos passos claros.",
        cta: "Abrir modo foco",
        icon: Target,
      };
    }

    if (plan === "pro") {
      return {
        badge: "Estude com estratégia",
        title: "Escolha um tema e deixe a Classy organizar o que estudar agora.",
        description: "Em vez de procurar tudo manualmente, gere um estudo guiado com contexto, foco e continuidade.",
        cta: "Começar estudo",
        icon: Sparkles,
      };
    }

    return {
      badge: "Da descoberta para o progresso",
      title: "Encontrou um tema interessante? A Classy pode virar isso em estudo na hora.",
      description: "Crie um estudo personalizado e troque a busca solta por uma trilha clara de aprendizado.",
      cta: "Quero estudar",
      icon: Sparkles,
    };
  }

  if (!isLoggedIn) {
    return {
      badge: "Explorar também ensina",
      title: "Antes de abrir um estudo, veja creators, aulas e formatos que podem ampliar sua visão.",
      description: "Explore o que está em alta e descubra temas, vozes e conteúdos que você talvez nem estivesse procurando.",
      cta: "Explorar conteúdos",
      icon: Compass,
    };
  }

  if (plan === "premium") {
    return {
      badge: "Curadoria + repertório",
      title: "Seu próximo grande insight pode estar no catálogo que você ainda não explorou.",
      description: "Descubra creators, aulas, podcasts e shorts para enriquecer o estudo que a Classy vai aprofundar depois.",
      cta: "Ver o explorar",
      icon: Compass,
    };
  }

  if (plan === "pro") {
    return {
      badge: "Não fique só no prompt",
      title: "Explore creators e conteúdos em alta antes de definir o próximo foco.",
      description: "A navegação ajuda você a encontrar repertório, referências e atalhos melhores para o estudo guiado.",
      cta: "Quero explorar",
      icon: Compass,
    };
  }

  return {
    badge: "Veja o que está rolando",
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
        "relative overflow-hidden rounded-[28px] border shadow-[0_20px_60px_-32px_rgba(0,0,0,0.65)]",
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

      <div className="relative flex flex-col gap-5 px-5 py-5 sm:px-7 sm:py-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 items-start gap-4 sm:gap-5">
          <div
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border text-foreground shadow-inner",
              isExploreVariant
                ? "border-cinematic-accent/20 bg-cinematic-accent/12"
                : "border-primary/20 bg-primary/10",
            )}
          >
            <Icon
              className={cn(
                "h-7 w-7",
                isExploreVariant ? "text-cinematic-accent" : "text-primary",
              )}
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <div className="inline-flex items-center rounded-full border border-border/40 bg-background/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {content.badge}
            </div>
            <h2 className="max-w-4xl text-lg font-semibold leading-tight text-foreground sm:text-2xl">
              {content.title}
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
              {content.description}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            onClick={onAction}
            size="lg"
            className={cn(
              "h-12 rounded-2xl px-5 text-sm font-semibold shadow-lg transition-all sm:h-14 sm:px-6 sm:text-base",
              isExploreVariant
                ? "bg-cinematic-accent text-white hover:bg-cinematic-accent/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {content.cta}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
