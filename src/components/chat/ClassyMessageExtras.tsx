import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ClassyCitation {
  source: "transcript" | "note" | "quiz";
  label: string;
  timestampSeconds?: number;
}

export interface ClassyUiBlock {
  type: "goal" | "checkpoint" | "practice" | "next_step";
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

export function ClassyMessageExtras({
  metadata,
  onSuggestionClick,
  onCitationClick,
  compact = false,
}: ClassyMessageExtrasProps) {
  if (!metadata) return null;

  const blocks = metadata.ui_blocks || [];
  const suggestions = metadata.follow_up_suggestions || [];
  const citations = metadata.citations || [];

  if (blocks.length === 0 && suggestions.length === 0 && citations.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", compact && "space-y-2")}>
      {blocks.length > 0 && (
        <div className="space-y-2">
          {blocks.map((block, index) => (
            <div
              key={`${block.type}-${index}`}
              className="rounded-xl border border-border/50 bg-card/70 px-3 py-3"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">{block.title}</p>
              {block.body && <p className="mt-1 text-sm text-foreground">{block.body}</p>}
              {block.prompt && <p className="mt-1 text-sm text-foreground">{block.prompt}</p>}
              {block.action && <p className="mt-1 text-sm text-foreground">{block.action}</p>}
              {block.bullets && block.bullets.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-foreground">
                  {block.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
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
