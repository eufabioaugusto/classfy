import { motion } from "framer-motion";

export function GlobalLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="relative w-32 h-32">
        {/* Efeito de brilho de fundo */}
        <motion.div
          className="absolute inset-0 rounded-full blur-2xl"
          style={{
            background: "radial-gradient(circle, hsl(var(--primary) / 0.3) 0%, transparent 70%)",
          }}
          animate={{
            opacity: [0.4, 0.8, 0.4],
            scale: [0.9, 1.2, 0.9],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />

        {/* Letra C usando texto */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "96px",
            color: "hsl(var(--primary))",
            textShadow: "0 0 20px hsl(var(--primary) / 0.5)",
          }}
          animate={{
            opacity: [0.6, 1, 0.6],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        >
          C
        </motion.div>

        {/* Overlay de luz que pulsa */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            fontFamily: "Inter, system-ui, sans-serif",
            fontWeight: 700,
            fontSize: "96px",
            background: "linear-gradient(180deg, hsl(var(--primary)) 0%, transparent 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
          animate={{
            opacity: [0, 0.5, 0],
          }}
          transition={{
            duration: 2,
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
