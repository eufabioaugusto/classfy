import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";

interface ParticleBurstProps {
  isActive: boolean;
  color?: "primary" | "pink" | "gold";
  particleCount?: number;
}

export function ParticleBurst({ 
  isActive, 
  color = "primary", 
  particleCount = 8 
}: ParticleBurstProps) {
  const particles = useMemo(() => {
    return Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      angle: (360 / particleCount) * i + Math.random() * 30 - 15,
      distance: 20 + Math.random() * 15,
      size: 4 + Math.random() * 3,
      delay: Math.random() * 0.1,
    }));
  }, [particleCount]);

  const colorClasses = {
    primary: "bg-primary",
    pink: "bg-pink-500",
    gold: "bg-yellow-400",
  };

  return (
    <AnimatePresence>
      {isActive && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-visible">
          {particles.map((particle) => {
            const radians = (particle.angle * Math.PI) / 180;
            const x = Math.cos(radians) * particle.distance;
            const y = Math.sin(radians) * particle.distance;

            return (
              <motion.div
                key={particle.id}
                className={`absolute rounded-full ${colorClasses[color]}`}
                style={{
                  width: particle.size,
                  height: particle.size,
                }}
                initial={{ 
                  scale: 0, 
                  x: 0, 
                  y: 0, 
                  opacity: 1 
                }}
                animate={{ 
                  scale: [0, 1.2, 0.8],
                  x: x,
                  y: y,
                  opacity: [1, 1, 0],
                }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: 0.5,
                  delay: particle.delay,
                  ease: "easeOut",
                }}
              />
            );
          })}
        </div>
      )}
    </AnimatePresence>
  );
}
