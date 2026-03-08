import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { Sparkles, Crown, Star } from "lucide-react";
import heroBg from "@/assets/plans-hero-bg.jpg";

export function PlansHero() {
  return (
    <section className="relative min-h-[85vh] md:min-h-[90vh] flex items-center justify-center overflow-hidden">
      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src={heroBg}
          alt=""
          className="w-full h-full object-cover"
          loading="eager"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/40 to-background" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/80" />
      </div>

      {/* Floating decorative elements */}
      <motion.div
        className="absolute top-20 left-[10%] w-2 h-2 rounded-full bg-accent/60"
        animate={{ y: [0, -20, 0], opacity: [0.4, 1, 0.4] }}
        transition={{ duration: 3, repeat: Infinity }}
      />
      <motion.div
        className="absolute top-40 right-[15%] w-3 h-3 rounded-full bg-badge-premium/40"
        animate={{ y: [0, -30, 0], opacity: [0.3, 0.8, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, delay: 1 }}
      />
      <motion.div
        className="absolute bottom-40 left-[20%] w-1.5 h-1.5 rounded-full bg-badge-pro/50"
        animate={{ y: [0, -15, 0], opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
      />

      {/* Content */}
      <div className="relative z-10 text-center max-w-4xl mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="space-y-6"
        >
          <Badge className="bg-accent/20 text-accent border-accent/30 backdrop-blur-sm px-4 py-1.5 text-sm">
            <Crown className="w-3.5 h-3.5 mr-1.5" />
            Classfy Premium
          </Badge>

          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
            <span className="text-foreground">Todo o Classfy.</span>
            <br />
            <span className="bg-gradient-to-r from-accent via-badge-premium to-accent bg-clip-text text-transparent">
              Sem interrupções.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Conteúdo premium, cursos completos, modo offline e reprodução em segundo plano. 
            Tudo o que você precisa para aprender mais.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4"
          >
            <Button
              size="lg"
              className="h-14 px-10 text-base font-semibold bg-accent hover:bg-accent/90 text-accent-foreground rounded-full shadow-lg shadow-accent/25"
              onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Começar agora
            </Button>
            <p className="text-sm text-muted-foreground">
              A partir de <span className="font-semibold text-foreground">R$ 29,90</span>/mês • Cancele quando quiser
            </p>
          </motion.div>

          {/* Social proof */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.6 }}
            className="flex items-center justify-center gap-1 pt-6"
          >
            <div className="flex -space-x-2">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-accent/40 to-badge-premium/40 border-2 border-background flex items-center justify-center"
                >
                  <Star className="w-3 h-3 text-badge-premium" />
                </div>
              ))}
            </div>
            <span className="text-sm text-muted-foreground ml-3">
              Milhares de assinantes satisfeitos
            </span>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
