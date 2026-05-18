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
  planLabel: string;
  title: string;
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
        planLabel: "Comece grátis e evolua quando quiser",
        title: "Crie um estudo com a Classy em segundos.",
        cta: "Criar meu estudo",
        icon: Sparkles,
      };
    }

    if (plan === "premium") {
      return {
        planLabel: "Estudos ilimitados com contexto contínuo",
        title: "Transforme qualquer tema em estudo com direção.",
        cta: "Abrir modo foco",
        icon: Target,
      };
    }

    if (plan === "pro") {
      return {
        planLabel: "Plano Premium com mais profundidade",
        title: "Deixe a Classy montar seu foco de estudo.",
        cta: "Começar estudo",
        icon: Sparkles,
      };
    }

    return {
      planLabel: "Você pode destravar estudos ilimitados depois",
      title: "Achou um tema? A Classy vira isso em estudo na hora.",
      cta: "Quero estudar",
      icon: Sparkles,
    };
  }

  if (!isLoggedIn) {
    return {
      planLabel: "Plano Pro R$ 29,90/mês",
      title: "Explore a vitrine de creators e conteúdos.",
      cta: "Explorar conteúdos",
      icon: Compass,
    };
  }

  if (plan === "premium") {
    return {
      planLabel: "Premium também é repertório ilimitado",
      title: "Seu próximo insight pode estar no catálogo que você ainda não viu.",
      cta: "Ver o explorar",
      icon: Compass,
    };
  }

  if (plan === "pro") {
    return {
      planLabel: "Veja o catálogo antes de aprofundar",
      title: "Explore creators e conteúdos antes de definir o foco.",
      cta: "Quero explorar",
      icon: Compass,
    };
  }

  return {
    planLabel: "Do catálogo ao estudo guiado, no seu ritmo",
    title: "O melhor próximo estudo pode começar no que já está em alta.",
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
        "relative overflow-hidden rounded-[22px] border shadow-[0_20px_60px_-38px_rgba(0,0,0,0.65)]",
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

      <div className="relative flex flex-col gap-3 px-4 py-3.5 sm:px-5 sm:py-3.5 lg:flex-row lg:items-center lg:justify-between lg:gap-5">
        <div className="flex min-w-0 items-center gap-3">
          {isExploreVariant ? (
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-foreground shadow-inner",
                "border-cinematic-accent/20 bg-cinematic-accent/12",
              )}
            >
              <Icon className="h-4.5 w-4.5 text-cinematic-accent" />
            </div>
          ) : (
            <div className="flex shrink-0 items-center">
              <div className="flex -space-x-2">
                {socialProofAvatars.map((src, index) => (
                  <img
                    key={src}
                    src={src}
                    alt={`Creator ${index + 1}`}
                    className="h-9 w-9 rounded-full border-2 border-background object-cover shadow-sm"
                  />
                ))}
              </div>
            </div>
          )}

          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground/85 sm:text-xs">
              <span className="font-medium">
                {content.planLabel}
              </span>
            </div>
            <h2 className="max-w-4xl text-sm font-semibold leading-tight text-foreground sm:text-[1.02rem] lg:text-[1.15rem]">
              {content.title}
            </h2>
          </div>
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            onClick={onAction}
            className={cn(
              "h-10 rounded-2xl px-4 text-sm font-semibold shadow-lg transition-all sm:h-10 sm:px-4.5",
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
