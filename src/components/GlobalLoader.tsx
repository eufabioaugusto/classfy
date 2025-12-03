import { motion } from "framer-motion";

export function GlobalLoader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="relative w-16 h-16">
        {/* Anel girando ao redor */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            border: "2px solid transparent",
            borderTopColor: "hsl(var(--primary))",
            borderRightColor: "hsl(var(--primary) / 0.3)",
          }}
          animate={{
            rotate: 360,
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Anel secundário (mais lento, direção oposta) */}
        <motion.div
          className="absolute inset-1 rounded-full"
          style={{
            border: "2px solid transparent",
            borderBottomColor: "hsl(var(--primary) / 0.5)",
            borderLeftColor: "hsl(var(--primary) / 0.2)",
          }}
          animate={{
            rotate: -360,
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "linear",
          }}
        />

        {/* Letra C com efeito de pulso suave */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center text-primary font-bold text-2xl"
          animate={{
            scale: [1, 1.05, 1],
            opacity: [0.7, 1, 0.7],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          C
        </motion.div>
      </div>
    </div>
  );
}
