import { useState, useCallback, useRef } from "react";

export function useParticleBurst(duration = 500) {
  const [isBursting, setIsBursting] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const triggerBurst = useCallback(() => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    setIsBursting(true);

    timeoutRef.current = setTimeout(() => {
      setIsBursting(false);
    }, duration);
  }, [duration]);

  return { isBursting, triggerBurst };
}
