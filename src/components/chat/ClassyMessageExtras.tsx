import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ClassyCitation {
  source: "transcript" | "note" | "quiz";
  label: string;
  timestampSeconds?: number;
}

export interface ClassyUiBlock {
  type: "goal" | "checkpoint" | "practice" | "next_step" | "resume" | "trail" | "celebration" | "sources";
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
  ui_blocks?: ClassyUiBlock[];
}

interface ClassyMessageExtrasProps {
  metadata?: ClassyMessageMetadata | null;
  onSuggestionClick: (suggestion: string) => void;
  onCitationClick?: (seconds: number) => void;
  compact?: boolean;
}

const sourceLabel: Record<ClassyCitation["source"], string> = {
  transcript: "Transcrição",
  note: "Notas",
  quiz: "Quiz",
};

const contentStrategyLabel: Record<string, string> = {
  grounded: "Baseado no conteúdo atual",
  recommendation: "Baseado na trilha recomendada",
  mixed: "Baseado em memória e contexto do estudo",
};

export function ClassyMessageExtras({
  metadata,
  onSuggestionClick,
  onCitationClick,
  compact = false,
}: ClassyMessageExtrasProps) {
  if (!metadata) return null;

  const blocks = (metadata.ui_blocks || []).filter((block) => !["resume", "checkpoint"].includes(block.type));
  const suggestions = metadata.follow_up_suggestions || [];
  const citations = metadata.citations || [];
  const contentStrategy = metadata.content_strategy;
  const sourceTransparency = metadata.source_transparency;
  const suggestionFriendlyIntents = new Set(["onboard", "clarify", "plan", "recommend", "practice"]);
  const shouldShowSuggestions =
    suggestions.length > 0 &&
    !compact &&
    (suggestionFriendlyIntents.has(metadata.intent || "") ||
      metadata.active_mode === "onboard" ||
      blocks.some((block) => ["practice", "trail"].includes(block.type)));
  const visibleSuggestions = shouldShowSuggestions ? suggestions.slice(0, 3) : [];

  if (blocks.length === 0 && visibleSuggestions.length === 0 && citations.length === 0 && !contentStrategy && !sourceTransparency) {
    return null;
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {blocks.length > 0 && (
        <div className="space-y-2">
          {blocks.slice(0, 1).map((block, index) => (
            <div
              key={`${block.type}-${index}`}
              className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-4 py-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                {block.type === "trail"
                  ? "Rota sugerida"
                  : block.type === "next_step"
                  ? "Próximo passo"
                  : block.type === "practice"
                  ? "Prática guiada"
                  : block.type === "celebration"
                  ? "Sinal de progresso"
                  : block.title}
              </p>
              {block.body && <p className="mt-1.5 text-sm leading-6 text-foreground">{block.body}</p>}
              {block.prompt && <p className="mt-1.5 text-sm leading-6 text-foreground">{block.prompt}</p>}
              {block.action && <p className="mt-1.5 text-sm leading-6 text-foreground">{block.action}</p>}
              {block.bullets && block.bullets.length > 0 && (
                <ul className="mt-2.5 space-y-1.5 text-sm text-foreground">
                  {block.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {visibleSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleSuggestions.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-full text-xs"
              onClick={() => onSuggestionClick(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      )}

      {citations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {citations.map((citation, index) => {
            const clickable = typeof citation.timestampSeconds === "number" && onCitationClick;
            return (
              <Badge
                key={`${citation.source}-${index}`}
                variant="secondary"
                className={cn("gap-1.5 px-2.5 py-1 text-[11px]", clickable && "cursor-pointer hover:bg-secondary/80")}
                onClick={clickable ? () => onCitationClick?.(citation.timestampSeconds!) : undefined}
              >
                <span className="font-medium">{sourceLabel[citation.source]}:</span>
                <span>{citation.label}</span>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
