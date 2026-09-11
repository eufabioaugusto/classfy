import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageWidth = "narrow" | "default" | "wide" | "full";

export function PageContainer({
  className,
  width = "default",
  ...props
}: HTMLAttributes<HTMLDivElement> & { width?: PageWidth }) {
  return <div className={cn("cf2-page-container", `cf2-page-container--${width}`, className)} {...props} />;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("cf2-page-header", className)}>
      <div className="cf2-page-header__copy">
        {eyebrow && <span className="cf2-page-header__eyebrow">{eyebrow}</span>}
        <h1 className="cf2-page-header__title">{title}</h1>
        {description && <p className="cf2-page-header__description">{description}</p>}
      </div>
      {action && <div className="cf2-page-header__action">{action}</div>}
    </header>
  );
}
