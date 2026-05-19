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
      label: "Objetivo",
      value: state.userGoal || state.currentFocus || "Definindo foco",
    },
    {
      icon: Brain,
      label: "Modo",
      value: `${modeLabels[state.activeMode]}${state.learnerLevel !== "unknown" ? ` • ${levelLabels[state.learnerLevel]}` : ""}`,
    },
    {
      icon: Compass,
      label: "Próximo passo",
      value: state.nextBestAction || "Continue a conversa para eu te guiar",
    },
  ];

  if (compact) {
    return (
      <div className="flex flex-wrap gap-2 px-3 py-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/35 px-3 py-1.5 text-[12px] text-muted-foreground"
          >
            <item.icon className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium text-foreground">{item.label}:</span>
            <span className="truncate">{item.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 px-6 py-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/35 px-3 py-2 text-sm text-muted-foreground"
        >
          <item.icon className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium text-foreground">{item.label}:</span>
          <span className="truncate">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
