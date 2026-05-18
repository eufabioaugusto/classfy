import { Brain, Compass, Target } from "lucide-react";

export interface ClassyStudyState {
  activeMode: "onboard" | "explain" | "recommend" | "practice" | "review" | "plan";
  currentFocus: string | null;
  learnerLevel: "beginner" | "intermediate" | "advanced" | "unknown";
  nextBestAction: string | null;
  userGoal?: string | null;
  sessionSummary?: string | null;
  masteredTopics?: string[];
  weakTopics?: string[];
  openQuestions?: string[];
  lastCheckpointAt?: string | null;
  lastQuizScore?: number | null;
  lastQuizTotal?: number | null;
  checkpointStatus?: "fresh" | "due" | "recommended";
  livePlanSteps?: string[];
  lastCelebration?: string | null;
  celebrationCount?: number;
}

interface ClassyStudyStateBarProps {
  state: ClassyStudyState | null;
  compact?: boolean;
}

const modeLabels: Record<ClassyStudyState["activeMode"], string> = {
  onboard: "Onboarding",
  explain: "Explicando",
  recommend: "Curadoria",
  practice: "Prática",
  review: "Revisão",
  plan: "Plano",
};

const levelLabels: Record<ClassyStudyState["learnerLevel"], string> = {
  beginner: "Iniciante",
  intermediate: "Intermediário",
  advanced: "Avançado",
  unknown: "Em avaliação",
};

export function ClassyStudyStateBar({ state, compact = false }: ClassyStudyStateBarProps) {
  if (!state) return null;

  const items = [
    {
      icon: Target,
      label: "Objetivo atual",
      value: state.userGoal || state.currentFocus || "Definindo foco",
    },
    {
      icon: Brain,
      label: "Modo da Classy",
      value: `${modeLabels[state.activeMode]} • ${levelLabels[state.learnerLevel]}`,
    },
    {
      icon: Compass,
      label: "Próximo melhor passo",
      value: state.nextBestAction || "Continue a conversa para eu te guiar",
    },
  ];

  return (
    <div className={compact ? "grid grid-cols-1 gap-2 px-3 py-2" : "grid grid-cols-3 gap-3 px-6 py-3"}>
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 shadow-sm"
        >
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </div>
          <p className="mt-1 text-sm font-medium text-foreground line-clamp-2">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
