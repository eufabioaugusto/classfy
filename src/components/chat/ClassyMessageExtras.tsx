import { cn } from "@/lib/utils";
import { ChevronDown, FileText } from "lucide-react";

export interface ClassyCitation {
  source: "transcript" | "note" | "quiz";
  label: string;
  timestampSeconds?: number;
}

export interface ClassyUiBlock {
  type:
    | "goal"
    | "checkpoint"
    | "practice"
    | "next_step"
    | "resume"
    | "trail"
    | "celebration"
    | "sources";
  title: string;
  body?: string;
  bullets?: string[];
  prompt?: string;
  action?: string;
}

export interface ClassyMessageMetadata {
  active_mode?: string;
  citations?: ClassyCitation[];
  checkpoint_generated?: boolean;
  content_strategy?: string;
  follow_up_suggestions?: string[];
  intent?: string;
  next_best_action?: string;
  source_transparency?: string;
  quality?: {
    grounding?: "transcript" | "study_context" | "general_knowledge" | "mixed";
    confidence?: "high" | "medium" | "low";
  };
  ui_blocks?: ClassyUiBlock[];
}

interface ClassyMessageExtrasProps {
  metadata?: ClassyMessageMetadata | null;
  onCitationClick?: (seconds: number) => void;
  compact?: boolean;
}

const sourceLabel: Record<ClassyCitation["source"], string> = {
  transcript: "Transcrição",
  note: "Anotação",
  quiz: "Quiz",
};

const groundingLabel: Record<string, string> = {
  transcript: "Transcrição deste conteúdo",
  study_context: "Contexto deste estudo",
  mixed: "Conteúdo e contexto do estudo",
  general_knowledge: "Conhecimento geral",
  grounded: "Conteúdo atual",
  recommendation: "Conteúdos recomendados",
};

export function ClassyMessageExtras({
  metadata,
  onCitationClick,
  compact = false,
}: ClassyMessageExtrasProps) {
  if (!metadata) return null;

  const citations = metadata.citations || [];
  const sourceDescription = metadata.source_transparency;
  const sourceKind =
    metadata.quality?.grounding || metadata.content_strategy || "";
  const sourceSummary = groundingLabel[sourceKind] || "Sobre esta resposta";
  const hasSourceDetails = Boolean(sourceDescription || citations.length > 0);

  if (!hasSourceDetails) return null;

  return (
    <div className={cn("space-y-2.5", compact && "space-y-2")}>
      {hasSourceDetails && (
        <details className="group w-fit max-w-full text-xs text-muted-foreground">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md py-1 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{sourceSummary}</span>
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>

          <div className="mt-1.5 max-w-2xl space-y-2 border-l border-border pl-3 leading-5">
            {sourceDescription && <p>{sourceDescription}</p>}

            {citations.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {citations.map((citation, index) => {
                  const clickable =
                    typeof citation.timestampSeconds === "number" &&
                    onCitationClick;

                  return (
                    <button
                      key={`${citation.source}-${index}`}
                      type="button"
                      disabled={!clickable}
                      className={cn(
                        "text-left text-xs text-muted-foreground",
                        clickable &&
                          "underline decoration-border underline-offset-4 hover:text-foreground",
                      )}
                      onClick={
                        clickable
                          ? () => onCitationClick?.(citation.timestampSeconds!)
                          : undefined
                      }
                    >
                      {sourceLabel[citation.source]}: {citation.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
