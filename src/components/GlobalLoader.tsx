import { useEffect } from "react";

export function GlobalLoader() {
  useEffect(() => {
    console.log("🔄 GlobalLoader mounted");
    return () => {
      console.log("✅ GlobalLoader unmounted");
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="relative w-16 h-16">
        {/* Anel girando ao redor - CSS puro para compatibilidade */}
        <div
          className="absolute inset-0 rounded-full animate-spin"
          style={{
            border: "2px solid transparent",
            borderTopColor: "hsl(var(--primary))",
            borderRightColor: "hsl(var(--primary) / 0.3)",
            animationDuration: "1s",
          }}
        />

        {/* Anel secundário (mais lento, direção oposta) */}
        <div
          className="absolute inset-1 rounded-full animate-spin"
          style={{
            border: "2px solid transparent",
            borderBottomColor: "hsl(var(--primary) / 0.5)",
            borderLeftColor: "hsl(var(--primary) / 0.2)",
            animationDirection: "reverse",
            animationDuration: "1.5s",
          }}
        />

        {/* Letra C com efeito de pulso suave via CSS */}
        <div
          className="absolute inset-0 flex items-center justify-center text-primary font-bold text-2xl animate-pulse"
        >
          C
        </div>
      </div>
    </div>
  );
}
