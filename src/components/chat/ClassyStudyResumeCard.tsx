import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { AlertCircle, CheckCircle2, Clock3, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { ClassyStudyState } from "@/components/chat/ClassyStudyStateBar";

interface ClassyStudyResumeCardProps {
  state: ClassyStudyState | null;
  compact?: boolean;
  onSuggestionClick?: (suggestion: string) => void;
}

const checkpointLabel: Record<NonNullable<ClassyStudyState["checkpointStatus"]>, string> = {
  fresh: "Checkpoint recente",
  due: "Checkpoint pendente",
  recommended: "Checkpoint recomendado",
};

const checkpointTone: Record<NonNullable<ClassyStudyState["checkpointStatus"]>, string> = {
  fresh: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20",
  due: "bg-amber-500/10 text-amber-700 border-amber-500/20",
  recommended: "bg-sky-500/10 text-sky-700 border-sky-500/20",
};

export function ClassyStudyResumeCard({
  state,
  compact = false,
  onSuggestionClick,
}: ClassyStudyResumeCardProps) {
  if (!state) return null;

  const hasSummary = Boolean(state.sessionSummary);
  const hasTopics = (state.masteredTopics?.length || 0) > 0 || (state.weakTopics?.length || 0) > 0;
  const hasQuestions = (state.openQuestions?.length || 0) > 0;

  if (!hasSummary && !hasTopics && !hasQuestions && !state.lastCheckpointAt) {
    return null;
  }

  return (
    <div className={cn("px-3 pb-3", !compact && "px-6 pb-4")}>
      <div className="rounded-2xl border border-border/60 bg-card/80 shadow-sm">
        <div className={cn("space-y-4 p-4", compact && "space-y-3 p-3")}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              Onde paramos
            </div>
            {state.checkpointStatus && (
              <Badge
                variant="outline"
                className={cn("border", checkpointTone[state.checkpointStatus])}
              >
                {checkpointLabel[state.checkpointStatus]}
              </Badge>
            )}
            {typeof state.lastQuizScore === "number" && typeof state.lastQuizTotal === "number" && (
              <Badge variant="secondary">
                Último quiz: {state.lastQuizScore}/{state.lastQuizTotal}
              </Badge>
            )}
            {state.lastCheckpointAt && (
              <Badge variant="outline" className="gap-1.5">
                <Clock3 className="h-3.5 w-3.5" />
                {formatDistanceToNow(new Date(state.lastCheckpointAt), {
                  addSuffix: true,
                  locale: ptBR,
                })}
              </Badge>
            )}
          </div>

          {state.sessionSummary && (
            <p className={cn("text-sm leading-6 text-muted-foreground", compact && "text-[13px] leading-5")}>
              {state.sessionSummary}
            </p>
          )}

          {hasTopics && (
            <div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
              {(state.masteredTopics?.length || 0) > 0 && (
                <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    O que já está firme
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state.masteredTopics?.slice(0, 4).map((topic) => (
                      <Badge key={topic} variant="secondary">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {(state.weakTopics?.length || 0) > 0 && (
                <div className="rounded-xl border border-amber-500/15 bg-amber-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Pontos para revisar
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {state.weakTopics?.slice(0, 4).map((topic) => (
                      <Badge key={topic} variant="secondary">
                        {topic}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {hasQuestions && (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Próximas perguntas úteis
              </div>
              <div className="flex flex-wrap gap-2">
                {state.openQuestions?.slice(0, compact ? 2 : 4).map((question) => (
                  <Button
                    key={question}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-full text-xs"
                    onClick={() => onSuggestionClick?.(question)}
                  >
                    {question}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
