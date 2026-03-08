import { Button } from "@/components/ui/button";
import { Crown, Sparkles } from "lucide-react";
import { motion } from "framer-motion";

export function PlansCTA() {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-accent/10 to-accent/5" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-accent/10 blur-[120px] rounded-full" />

      <div className="relative container mx-auto px-4 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto space-y-6"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/15 mb-2">
            <Crown className="w-8 h-8 text-accent" />
          </div>

          <h2 className="text-3xl md:text-5xl font-bold">
            Pronto para começar?
          </h2>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Junte-se a milhares de assinantes e tenha acesso a tudo que o Classfy tem a oferecer.
          </p>

          <div className="pt-2">
            <Button
              size="lg"
              className="h-14 px-10 text-base font-semibold bg-accent hover:bg-accent/90 text-accent-foreground rounded-full shadow-lg shadow-accent/25"
              onClick={() => document.getElementById("plans")?.scrollIntoView({ behavior: "smooth" })}
            >
              <Sparkles className="w-5 h-5 mr-2" />
              Escolher meu plano
            </Button>
            <p className="text-sm text-muted-foreground mt-4">
              Sem fidelidade • Cancele quando quiser
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
