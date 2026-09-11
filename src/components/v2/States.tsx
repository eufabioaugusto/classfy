import type { HTMLAttributes, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingState({
  label = "Carregando",
  description,
  compact = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: string; description?: string; compact?: boolean }) {
  return (
    <div
      className={cn("cf2-state", compact && "cf2-state--compact", className)}
      role="status"
      aria-live="polite"
      {...props}
    >
      <span className="cf2-state__spinner" aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        {description && <p>{description}</p>}
      </div>
    </div>
  );
}

export function ErrorState({
  title = "Não foi possível carregar",
  description,
  action,
  compact = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={cn("cf2-state cf2-state--error", compact && "cf2-state--compact", className)}
      role="alert"
      {...props}
    >
      <span className="cf2-state__icon" aria-hidden="true"><AlertCircle /></span>
      <div>
        <strong>{title}</strong>
        {description && <p>{description}</p>}
        {action && <div className="cf2-state__action">{action}</div>}
      </div>
    </div>
  );
}
