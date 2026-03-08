import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { PlayCircle, Download, Smartphone, Brain, Shield, Wifi } from "lucide-react";
import deviceMockup from "@/assets/plans-device-mockup.png";
import offlineStudy from "@/assets/plans-offline-study.jpg";

const features = [
  {
    icon: PlayCircle,
    title: "Zero anúncios, zero distrações",
    description: "Assista a todos os conteúdos sem nenhuma interrupção. Foque apenas no que importa: seu aprendizado.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: Download,
    title: "Baixe e assista offline",
    description: "Salve conteúdos no seu dispositivo e estude em qualquer lugar, mesmo sem conexão com a internet.",
    color: "text-badge-premium",
    bg: "bg-badge-premium/10",
  },
  {
    icon: Smartphone,
    title: "Ouça em segundo plano",
    description: "Continue ouvindo aulas mesmo com a tela desligada ou enquanto usa outros aplicativos.",
    color: "text-badge-pro",
    bg: "bg-badge-pro/10",
  },
  {
    icon: Brain,
    title: "IA que aprende com você",
    description: "O Classy Chat cria quizzes, resumos e planos de estudo personalizados com base no seu progresso.",
    color: "text-badge-free",
    bg: "bg-badge-free/10",
  },
  {
    icon: Shield,
    title: "Cursos com certificado",
    description: "Complete cursos inteiros e receba certificados para comprovar suas conquistas.",
    color: "text-badge-hot",
    bg: "bg-badge-hot/10",
  },
  {
    icon: Wifi,
    title: "Acesso antecipado",
    description: "Seja o primeiro a experimentar novos recursos e conteúdos exclusivos da plataforma.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
];

export function PlansFeatures() {
  return (
    <section className="py-20 md:py-28 overflow-hidden">
      <div className="container mx-auto px-4">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <Badge variant="outline" className="mb-4 px-3 py-1">
            Recursos exclusivos
          </Badge>
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Tudo que você precisa para{" "}
            <span className="bg-gradient-to-r from-accent to-badge-premium bg-clip-text text-transparent">
              aprender mais
            </span>
          </h2>
        </motion.div>

        {/* Feature spotlight with image */}
        <div className="grid lg:grid-cols-2 gap-16 items-center mb-24">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="space-y-8"
          >
            <div className="space-y-6">
              {features.slice(0, 3).map((feature, idx) => {
                const Icon = feature.icon;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: idx * 0.1 }}
                    className="flex gap-4 p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover:border-accent/30 transition-colors"
                  >
                    <div className={`w-12 h-12 rounded-xl ${feature.bg} flex items-center justify-center shrink-0`}>
                      <Icon className={`w-6 h-6 ${feature.color}`} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative flex justify-center"
          >
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-accent/20 to-badge-premium/20 blur-3xl rounded-full" />
              <img
                src={deviceMockup}
                alt="Classfy no seu dispositivo"
                className="relative w-80 md:w-96 drop-shadow-2xl"
                loading="lazy"
              />
            </div>
          </motion.div>
        </div>

        {/* Second row with reversed layout */}
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="relative order-2 lg:order-1"
          >
            <div className="relative rounded-2xl overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 to-transparent z-10" />
              <img
                src={offlineStudy}
                alt="Estude em qualquer lugar"
                className="w-full aspect-video object-cover"
                loading="lazy"
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="space-y-6 order-1 lg:order-2"
          >
            {features.slice(3).map((feature, idx) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: idx * 0.1 }}
                  className="flex gap-4 p-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm hover:border-accent/30 transition-colors"
                >
                  <div className={`w-12 h-12 rounded-xl ${feature.bg} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-6 h-6 ${feature.color}`} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{feature.description}</p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
