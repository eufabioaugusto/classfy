import { ArrowRight, BookOpen, Check, Compass, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ClassyStudyState } from "@/components/chat/ClassyStudyStateBar";
import type { StudyJourneySummary } from "@/lib/study/getStudyJourneySummary";

interface StudyMapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
  title: string;
  state: ClassyStudyState | null;
  summary: StudyJourneySummary | null;
  latestAssistantContent?: string | null;
}

const stageLabels: Record<ClassyStudyState["activeMode"], string> = {
  onboard: "Ponto de partida",
  explain: "Explorando o tema",
  recommend: "Escolhendo conteúdos",
  practice: "Colocando em prática",
  review: "Revisando",
  plan: "Organizando a trilha",
};

export function StudyMapDialog({ open, onOpenChange, onContinue, title, state, summary, latestAssistantContent }: StudyMapDialogProps) {
  const focus = state?.currentFocus || state?.userGoal || summary?.currentFocus || title;
  const stage = state?.activeMode ? stageLabels[state.activeMode] : summary?.stageLabel || "Ponto de partida";
  const question = state?.openQuestions?.find((item) => latestAssistantContent?.includes(item)) || null;
  const recommended = summary?.totalRecommendedContents || 0;
  const completed = summary?.completedContentsCount || 0;
  const contentProgress = recommended > 0 ? Math.round((completed / recommended) * 100) : null;
  const steps = state?.activeMode === "plan" || recommended > 0
    ? (state?.livePlanSteps || []).filter((step) => step !== state?.nextBestAction).slice(0, 3)
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,820px)] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-[28px] border-border/70 p-0 shadow-2xl sm:w-full">
        <div className="overflow-y-auto">
          <DialogHeader className="border-b border-border/60 bg-gradient-to-br from-rose-50 via-background to-background px-5 pb-6 pt-8 text-left dark:from-rose-950/25 sm:px-8">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Compass className="h-5 w-5" /></div>
            <p className="text-xs font-semibold text-primary">Seu estudo, em um só lugar</p>
            <DialogTitle className="text-2xl font-bold tracking-tight sm:text-3xl">Mapa do estudo</DialogTitle>
            <DialogDescription className="max-w-lg text-sm leading-6">Veja onde você está e qual é o próximo passo em {title}.</DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-5 py-6 sm:px-8">
            <section className="rounded-2xl border border-border/70 bg-muted/25 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">{stage}</span>
                {state?.learnerLevel && state.learnerLevel !== "unknown" && (
                  <span className="rounded-full border border-border/70 px-3 py-1 text-xs text-muted-foreground">Nível {state.learnerLevel === "beginner" ? "iniciante" : state.learnerLevel === "intermediate" ? "intermediário" : "avançado"}</span>
                )}
              </div>
              <p className="mt-4 text-xs text-muted-foreground">Seu foco</p>
              <h3 className="mt-1 text-lg font-semibold leading-snug text-foreground">{focus}</h3>
            </section>

            <section className="rounded-2xl border border-primary/20 bg-primary/[0.045] p-5">
              <div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /><h3 className="text-sm font-semibold">Próximo passo</h3></div>
              <p className="mt-3 text-sm leading-6 text-foreground">{question || (state?.activeMode === "onboard" ? "Conte à Classy o que você já sabe e o que quer alcançar. Sua trilha será ajustada a partir da conversa." : state?.nextBestAction || "Continue a conversa para construir sua trilha.")}</p>
              <Button onClick={onContinue} className="mt-5 rounded-full px-5">{question ? "Responder na conversa" : "Continuar estudo"}<ArrowRight className="ml-2 h-4 w-4" /></Button>
            </section>

            {contentProgress !== null ? (
              <section className="rounded-2xl border border-border/70 p-5">
                <div className="flex items-center justify-between gap-3 text-sm"><span className="font-semibold">Conteúdos da trilha</span><span className="text-muted-foreground">{completed} de {recommended} concluídos</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Progresso nos conteúdos" aria-valuenow={contentProgress} aria-valuemin={0} aria-valuemax={100}><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${contentProgress}%` }} /></div>
                <p className="mt-3 text-xs text-muted-foreground">{summary?.playlistsCount || 0} playlists · {summary?.videosCount || 0} vídeos</p>
              </section>
            ) : (
              <div className="flex items-start gap-3 rounded-2xl border border-dashed border-border/80 p-5 text-sm text-muted-foreground"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>A trilha de conteúdos aparece aqui quando a Classy encontrar materiais relevantes para seu objetivo.</p></div>
            )}

            {steps.length > 0 && <section className="space-y-3"><h3 className="text-sm font-semibold">Sua trilha</h3>{steps.map((step, index) => <div key={`${index}-${step}`} className="flex gap-3 rounded-xl border border-border/60 px-4 py-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{index + 1}</span><p className="text-sm leading-6">{step}</p></div>)}</section>}

            {(state?.masteredTopics?.length || 0) > 0 && <section><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-emerald-600" />Você já domina</h3><div className="flex flex-wrap gap-2">{state?.masteredTopics?.slice(0, 4).map((topic) => <span key={topic} className="rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs">{topic}</span>)}</div></section>}
            {(state?.weakTopics?.length || 0) > 0 && <section><h3 className="mb-3 text-sm font-semibold">Vale revisar</h3><div className="flex flex-wrap gap-2">{state?.weakTopics?.slice(0, 4).map((topic) => <span key={topic} className="rounded-full border border-amber-500/20 bg-amber-500/5 px-3 py-1.5 text-xs">{topic}</span>)}</div></section>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
