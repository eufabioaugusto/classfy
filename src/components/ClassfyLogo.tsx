import { cn } from "@/lib/utils";

interface ClassfyLogoProps {
  compact?: boolean;
  className?: string;
  symbolClassName?: string;
}

export function ClassfyLogo({ compact = false, className, symbolClassName }: ClassfyLogoProps) {
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-3", className)}>
      <img
        src="/brand/classfy-simbolo-vermelho.svg"
        alt=""
        width={28}
        height={28}
        className={cn("h-7 w-7 shrink-0 object-contain", symbolClassName)}
      />
      <span className={compact ? "sr-only" : "classfy-wordmark text-xl text-foreground"}>
        Classfy
      </span>
    </span>
  );
}
