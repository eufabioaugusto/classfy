import { Button } from "@/components/ui/button";
import { PlayCircle, Download, Smartphone, Brain } from "lucide-react";

const quickFeatures = [
  {
    icon: PlayCircle,
    text: "Sem anúncios, para que você assista seus conteúdos favoritos sem interrupção",
  },
  {
    icon: Download,
    text: "Baixe os vídeos para assistir depois, off-line ou onde estiver",
  },
  {
    icon: Smartphone,
    text: "Assista vídeos em segundo plano com a tela bloqueada ou usando outros apps",
  },
  {
    icon: Brain,
    text: "IA que cria quizzes, resumos e planos de estudo personalizados para você",
  },
];

export function PlansHero() {
  return (
    <section className="pt-12 pb-16 md:pt-20 md:pb-24">
      <div className="container mx-auto px-4">
        {/* Hero content - centered, clean */}
        <div className="text-center max-w-3xl mx-auto mb-16 md:mb-24">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <PlayCircle className="w-5 h-5 text-accent-foreground" />
            </div>
            <span className="text-lg font-semibold text-accent">Classfy Premium</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
            Todo o Classfy{"\n"}
            <br />
            sem interrupções
          </h1>

          <p className="text-lg text-muted-foreground mb-2 max-w-xl mx-auto">
            Classfy off-line, sem anúncios e em segundo plano
          </p>

          <p className="text-sm text-muted-foreground mb-8">
            Planos a partir de R$ 29,90/mês. Cancele a qualquer momento.
          </p>

          <Button
            size="lg"
            className="h-12 px-10 rounded-full text-base font-medium bg-accent hover:bg-accent/90 text-accent-foreground"
            onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}
          >
            Ver planos
          </Button>
        </div>

        {/* 4-feature grid - like YouTube Premium */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-12 max-w-4xl mx-auto">
          {quickFeatures.map((feature, idx) => {
            const Icon = feature.icon;
            return (
              <div key={idx} className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
                  <Icon className="w-7 h-7 text-accent" />
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {feature.text}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
