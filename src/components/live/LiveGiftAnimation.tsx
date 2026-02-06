import { useEffect, useState } from "react";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { LiveGift } from "@/hooks/useLiveChat";

interface GiftEvent {
  id: string;
  gift: LiveGift;
  senderName: string;
  quantity: number;
  timestamp: number;
}

interface LiveGiftAnimationProps {
  events: GiftEvent[];
  className?: string;
}

const animationVariants: Record<string, Variants> = {
  float: {
    initial: { opacity: 0, y: 100, scale: 0.5 },
    animate: { opacity: 1, y: -200, scale: 1 },
    exit: { opacity: 0, scale: 0 },
  },
  sparkle: {
    initial: { opacity: 0, scale: 0, rotate: -180 },
    animate: { opacity: 1, scale: [0, 1.5, 1], rotate: 0 },
    exit: { opacity: 0, scale: 0, rotate: 180 },
  },
  explosion: {
    initial: { opacity: 0, scale: 0 },
    animate: { opacity: [0, 1, 1, 0], scale: [0, 2, 2.5, 3] },
    exit: { opacity: 0 },
  },
  fly: {
    initial: { opacity: 0, x: -100, y: 50 },
    animate: { opacity: 1, x: 400, y: -100 },
    exit: { opacity: 0 },
  },
  rain: {
    initial: { opacity: 0, y: -100 },
    animate: { opacity: [0, 1, 1, 0], y: [0, 100, 200, 300] },
    exit: { opacity: 0 },
  },
  fullscreen: {
    initial: { opacity: 0, scale: 0 },
    animate: { opacity: [0, 1, 1, 0], scale: [0, 5, 5, 8] },
    exit: { opacity: 0 },
  },
  default: {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: -50 },
    exit: { opacity: 0 },
  },
};

export function LiveGiftAnimation({ events, className }: LiveGiftAnimationProps) {
  const [activeEvents, setActiveEvents] = useState<GiftEvent[]>([]);

  useEffect(() => {
    // Add new events
    const newEvents = events.filter(
      (e) => !activeEvents.some((ae) => ae.id === e.id)
    );
    
    if (newEvents.length > 0) {
      setActiveEvents((prev) => [...prev, ...newEvents]);
      
      // Remove after animation duration
      setTimeout(() => {
        setActiveEvents((prev) =>
          prev.filter((e) => !newEvents.some((ne) => ne.id === e.id))
        );
      }, 4000);
    }
  }, [events, activeEvents]);

  return (
    <div className={`fixed inset-0 pointer-events-none z-50 ${className || ""}`}>
      <AnimatePresence>
        {activeEvents.map((event) => {
          const variants = animationVariants[event.gift.animation_type] || animationVariants.default;
          
          return (
            <motion.div
              key={event.id}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
              variants={variants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 3 }}
            >
              {/* Gift Icon */}
              <span className="text-8xl drop-shadow-2xl">
                {event.gift.icon}
              </span>
              
              {/* Quantity badge */}
              {event.quantity > 1 && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute -top-2 -right-2 bg-accent text-accent-foreground text-lg font-bold rounded-full w-8 h-8 flex items-center justify-center"
                >
                  x{event.quantity}
                </motion.span>
              )}
              
              {/* Sender name */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="mt-4 px-4 py-2 bg-black/60 backdrop-blur-sm rounded-full"
              >
                <span className="text-white font-medium">
                  {event.senderName} enviou {event.gift.name}!
                </span>
              </motion.div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
