import { motion } from "framer-motion";
import featureNoads from "@/assets/plans-feature-noads.png";
import featureOffline from "@/assets/plans-feature-offline.png";
import featureBackground from "@/assets/plans-feature-background.png";
import featureAi from "@/assets/plans-feature-ai.png";

const features = [
  {
    title: "Vídeos ilimitados sem anúncios",
    description:
      "Vá direto para seus conteúdos favoritos sem esperar os anúncios. Encontre aulas, tutoriais e aprenda com seus criadores favoritos sem interrupções.",
    image: featureNoads,
    imageStyle: "rounded-full border-4 border-accent/20 w-64 h-64 md:w-72 md:h-72 object-cover",
  },
  {
    title: "Curta vídeos off-line",
    description:
      "Assista a qualquer hora e em qualquer lugar. Faça download dos vídeos para assistir quando e onde quiser, sem se preocupar com dados móveis ou Wi-Fi.",
    image: featureOffline,
    imageStyle: "w-48 md:w-56",
  },
  {
    title: 'Recurso "Tocar em segundo plano"',
    description:
      "Continue acompanhando: você pode desligar a tela ou usar outros apps e manter o vídeo tocando em segundo plano sem interrupções.",
    image: featureBackground,
    imageStyle: "w-48 md:w-56",
  },
  {
    title: "Estudo turbinado com IA",
    description:
      "O Classy Chat cria quizzes, resumos e planos de estudo personalizados com base no seu progresso. Aprenda mais rápido e de forma inteligente.",
    image: featureAi,
    imageStyle: "w-48 md:w-56",
  },
];

export function PlansFeatures() {
  return (
    <section className="py-16 md:py-24">
      <div className="container mx-auto px-4">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-bold text-center text-foreground mb-20 md:mb-28"
        >
          Assista seus conteúdos preferidos
          <br />
          sem interrupções
        </motion.h2>

        <div className="space-y-24 md:space-y-32 max-w-5xl mx-auto">
          {features.map((feature, idx) => {
            const isReversed = idx % 2 === 1;
            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                className={`flex flex-col ${isReversed ? "md:flex-row-reverse" : "md:flex-row"} items-center gap-12 md:gap-20`}
              >
                {/* Text */}
                <div className="flex-1 space-y-4 text-center md:text-left">
                  <h3 className="text-2xl md:text-3xl font-bold text-foreground">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground leading-relaxed max-w-md">
                    {feature.description}
                  </p>
                </div>

                {/* Image */}
                <div className="flex-1 flex justify-center">
                  <img
                    src={feature.image}
                    alt={feature.title}
                    className={feature.imageStyle}
                    loading="lazy"
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
