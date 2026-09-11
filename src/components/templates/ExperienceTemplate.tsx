import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ExperienceFamily =
  | "exploration"
  | "consumption"
  | "library"
  | "economy"
  | "creator"
  | "admin";

export type ExperienceDensity = "immersive" | "relaxed" | "comfortable" | "compact";
export type ExperienceWidth = "contained" | "wide" | "full";

export interface ExperienceTemplateProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  children: ReactNode;
  header?: ReactNode;
  lead?: ReactNode;
  toolbar?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  density?: ExperienceDensity;
  width?: ExperienceWidth;
}

type TemplateDefinition = {
  family: ExperienceFamily;
  density: ExperienceDensity;
  width: ExperienceWidth;
};

function ExperienceTemplate({
  family,
  defaultDensity,
  defaultWidth,
  children,
  header,
  lead,
  toolbar,
  aside,
  footer,
  density = defaultDensity,
  width = defaultWidth,
  className,
  ...props
}: ExperienceTemplateProps & {
  family: ExperienceFamily;
  defaultDensity: ExperienceDensity;
  defaultWidth: ExperienceWidth;
}) {
  return (
    <div
      className={cn("cf2-template", aside && "cf2-template--with-aside", className)}
      data-experience={family}
      data-density={density}
      data-width={width}
      {...props}
    >
      {header && <div className="cf2-template__header">{header}</div>}
      {lead && <div className="cf2-template__lead">{lead}</div>}
      {toolbar && <div className="cf2-template__toolbar">{toolbar}</div>}
      <div className="cf2-template__body">
        <div className="cf2-template__content">{children}</div>
        {aside && <aside className="cf2-template__aside">{aside}</aside>}
      </div>
      {footer && <div className="cf2-template__footer">{footer}</div>}
    </div>
  );
}

function withDefinition(definition: TemplateDefinition, props: ExperienceTemplateProps) {
  return (
    <ExperienceTemplate
      {...props}
      family={definition.family}
      defaultDensity={definition.density}
      defaultWidth={definition.width}
    />
  );
}

export function ExplorationTemplate(props: ExperienceTemplateProps) {
  return withDefinition({ family: "exploration", density: "relaxed", width: "wide" }, props);
}

export function ConsumptionTemplate(props: ExperienceTemplateProps) {
  return withDefinition({ family: "consumption", density: "immersive", width: "full" }, props);
}

export function LibraryTemplate(props: ExperienceTemplateProps) {
  return withDefinition({ family: "library", density: "comfortable", width: "wide" }, props);
}

export function EconomyTemplate(props: ExperienceTemplateProps) {
  return withDefinition({ family: "economy", density: "comfortable", width: "contained" }, props);
}

export function CreatorTemplate(props: ExperienceTemplateProps) {
  return withDefinition({ family: "creator", density: "compact", width: "wide" }, props);
}

export function AdminTemplate(props: ExperienceTemplateProps) {
  return withDefinition({ family: "admin", density: "compact", width: "full" }, props);
}
