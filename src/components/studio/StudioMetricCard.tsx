import type { ComponentType, SVGProps } from "react";
import { V2Card } from "@/components/v2";
import { cn } from "@/lib/utils";

type StudioMetricCardProps = {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  value: string | number;
  detail: string;
  tone?: "accent" | "success" | "warning" | "neutral";
  trend?: string;
};

export function StudioMetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
  trend,
}: StudioMetricCardProps) {
  return (
    <V2Card className={cn("studio-metric", `studio-metric--${tone}`)}>
      <div className="studio-metric__top">
        <span className="studio-icon" data-tone={tone}>
          <Icon aria-hidden="true" />
        </span>
        {trend && <span className="studio-metric__trend">{trend}</span>}
      </div>
      <span className="studio-metric__label">{label}</span>
      <strong className="studio-metric__value">{value}</strong>
      <span className="studio-metric__detail">{detail}</span>
    </V2Card>
  );
}

