import { ArrowRight, Compass, Sparkles, Target } from "lucide-react";
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
        "cf-v2 cf2-mode-bridge",
        isExploreVariant ? "cf2-mode-bridge--focus" : "cf2-mode-bridge--explore",
        className,
      )}
    >
      <div className="cf2-mode-bridge__mark" aria-hidden="true">
        <Icon />
      </div>

      <div className="cf2-mode-bridge__copy">
        <span>{isExploreVariant ? "Modo Estudo" : "Modo Explorar"}</span>
        <strong>{content.title}</strong>
        <small>{content.planLabel}</small>
      </div>

      <button type="button" onClick={onAction} className="cf2-mode-bridge__action">
        {content.cta}
        <ArrowRight aria-hidden="true" />
      </button>
    </section>
  );
}
