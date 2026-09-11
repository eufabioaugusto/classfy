import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TableHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

type Theme = "dark" | "light";

export function ClassfyV2Scope({
  children,
  className,
  theme,
  ...props
}: HTMLAttributes<HTMLDivElement> & { theme?: Theme }) {
  return (
    <div className={cn("cf-v2", className)} data-theme={theme} {...props}>
      {children}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
type ButtonSize = "sm" | "md" | "lg" | "icon";

export const V2Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    leadingIcon?: ReactNode;
    trailingIcon?: ReactNode;
  }
>(({ className, variant = "primary", size = "md", leadingIcon, trailingIcon, children, type = "button", ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn("cf2-button", `cf2-button--${variant}`, size !== "md" && `cf2-button--${size}`, className)}
    {...props}
  >
    {leadingIcon}
    {children}
    {trailingIcon}
  </button>
));
V2Button.displayName = "V2Button";

type BadgeVariant = "neutral" | "accent" | "premium" | "success" | "warning" | "danger";

export function V2Badge({
  children,
  variant = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return (
    <span className={cn("cf2-badge", variant !== "neutral" && `cf2-badge--${variant}`, className)} {...props}>
      {children}
    </span>
  );
}

type CardElevation = "flat" | "raised" | "panel";

export function V2Card({
  children,
  elevation = "flat",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { elevation?: CardElevation }) {
  return (
    <article className={cn("cf2-card", elevation !== "flat" && `cf2-card--${elevation}`, className)} {...props}>
      {children}
    </article>
  );
}

export function V2CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cf2-card__header", className)} {...props} />;
}

export function V2CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cf2-card__content", className)} {...props} />;
}

export function V2CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cf2-card__footer", className)} {...props} />;
}

type FieldCopy = {
  label?: string;
  hint?: string;
  error?: string;
};

export const V2Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldCopy>(
  ({ className, id, label, hint, error, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helpId = hint || error ? `${inputId}-help` : undefined;

    return (
      <label className="cf2-field" htmlFor={inputId}>
        {label && <span className="cf2-field__label">{label}</span>}
        <input
          ref={ref}
          id={inputId}
          className={cn("cf2-input", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={helpId}
          {...props}
        />
        {(error || hint) && <span className="cf2-field__hint" id={helpId}>{error ?? hint}</span>}
      </label>
    );
  },
);
V2Input.displayName = "V2Input";

export const V2Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & FieldCopy>(
  ({ className, id, label, hint, error, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? generatedId;
    const helpId = hint || error ? `${inputId}-help` : undefined;

    return (
      <label className="cf2-field" htmlFor={inputId}>
        {label && <span className="cf2-field__label">{label}</span>}
        <textarea
          ref={ref}
          id={inputId}
          className={cn("cf2-input", className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={helpId}
          {...props}
        />
        {(error || hint) && <span className="cf2-field__hint" id={helpId}>{error ?? hint}</span>}
      </label>
    );
  },
);
V2Textarea.displayName = "V2Textarea";

export function V2SectionHeader({
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
    <header className={cn("cf2-section-header", className)}>
      <div>
        {eyebrow && <span className="cf2-section-header__eyebrow">{eyebrow}</span>}
        <h2 className="cf2-section-header__title">{title}</h2>
        {description && <p className="cf2-section-header__description">{description}</p>}
      </div>
      {action}
    </header>
  );
}

export function V2Metric({
  label,
  value,
  detail,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <article className={cn("cf2-metric", className)} {...props}>
      <span className="cf2-metric__label">{label}</span>
      <strong className="cf2-metric__value">{value}</strong>
      {detail && <span className="cf2-metric__detail">{detail}</span>}
    </article>
  );
}

export function V2TableWrap({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cf2-table-wrap", className)} {...props} />;
}

export const V2Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => <table ref={ref} className={cn("cf2-table", className)} {...props} />,
);
V2Table.displayName = "V2Table";

export function V2EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cf2-empty", className)}>
      {icon && <span className="cf2-empty__icon">{icon}</span>}
      <h3 className="cf2-empty__title">{title}</h3>
      {description && <p className="cf2-empty__description">{description}</p>}
      {action}
    </div>
  );
}

export function V2Skeleton({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("cf2-skeleton", className)} aria-hidden="true" {...props} />;
}

export function V2DialogSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cf2-dialog-surface", className)} {...props} />;
}

export function V2SheetSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cf2-sheet-surface", className)} {...props} />;
}

export function V2MediaFrame({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return <figure className={cn("cf2-media", className)} {...props}>{children}</figure>;
}

export function V2CreatorIdentity({ className, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return <img className={cn("cf2-creator-identity", className)} alt={alt} {...props} />;
}
