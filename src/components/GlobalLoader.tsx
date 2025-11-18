import { motion } from "framer-motion";

export function GlobalLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="relative">
        {/* Letra C */}
        <svg
          width="120"
          height="120"
          viewBox="0 0 120 120"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative z-10"
        >
          <defs>
            {/* Gradiente que simula o efeito de luz acendendo */}
            <linearGradient id="lightGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <motion.stop
                offset="0%"
                stopColor="hsl(var(--primary))"
                stopOpacity="1"
                animate={{
                  offset: ["0%", "100%"],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <motion.stop
                offset="0%"
                stopColor="hsl(var(--primary) / 0.3)"
                stopOpacity="0.3"
                animate={{
                  offset: ["0%", "100%"],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
              <motion.stop
                offset="100%"
                stopColor="hsl(var(--muted-foreground) / 0.1)"
                stopOpacity="0.1"
              />
            </linearGradient>

            {/* Filtro de blur para efeito de brilho */}
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Letra C com stroke */}
          <motion.path
            d="M90 30 C100 30, 110 40, 110 60 C110 80, 100 90, 80 90 C50 90, 30 70, 30 60 C30 40, 50 30, 80 30"
            stroke="url(#lightGradient)"
            strokeWidth="12"
            strokeLinecap="round"
            fill="none"
            filter="url(#glow)"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ 
              pathLength: [0, 1, 1, 0],
              opacity: [0, 1, 1, 0]
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
              times: [0, 0.4, 0.6, 1]
            }}
          />
        </svg>

        {/* Efeito de brilho adicional */}
        <motion.div
          className="absolute inset-0 rounded-full blur-xl"
          style={{
            background: "radial-gradient(circle, hsl(var(--primary) / 0.4) 0%, transparent 70%)",
          }}
          animate={{
            opacity: [0.3, 0.7, 0.3],
            scale: [0.8, 1.1, 0.8],
          }}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </div>
    </div>
  );
}
