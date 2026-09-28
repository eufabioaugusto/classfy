import { useEffect } from "react";

/** A short tsParticles confetti burst, loaded only on the final screen. */
export function OnboardingCelebration() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let container: { destroy: () => void } | undefined;
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    void import("@tsparticles/confetti")
      .then(async ({ confetti }) => {
        if (disposed) return;
        container = await confetti("onboarding-celebration", {
          count: 160,
          spread: 100,
          angle: 90,
          position: { x: 50, y: 55 },
          startVelocity: 42,
          gravity: 1,
          decay: 0.92,
          ticks: 220,
          scalar: 1.1,
          shapes: ["square", "circle"],
          colors: ["#ed174c", "#ffba38", "#ffdf8f", "#ff799e", "#ffffff"],
          disableForReducedMotion: true,
          zIndex: 90,
        });
        if (disposed) container?.destroy();
        else cleanupTimer = setTimeout(() => container?.destroy(), 5500);
      })
      .catch(() => { /* Celebration must never block completion. */ });
    return () => {
      disposed = true;
      if (cleanupTimer) clearTimeout(cleanupTimer);
      container?.destroy();
    };
  }, []);
  return null;
}
