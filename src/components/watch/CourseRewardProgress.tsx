import { useCallback, useEffect, useState } from "react";
import { BookOpen, CheckCircle2, Eye, PlayCircle, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeToRewardEarned } from "@/lib/rewards/events";
import { Progress } from "@/components/ui/progress";
import { buildCourseRewardSummary, COURSE_ACTIONS, LESSON_ACTIONS } from "@/lib/rewards/courseSummary";

interface Props {
  courseId: string;
  creatorId: string;
  lessonId: string;
  lessonIds: string[];
  hasAccess: boolean;
  refreshTrigger: number;
}

type Summary = ReturnType<typeof buildCourseRewardSummary>;

export function CourseRewardProgress({ courseId, creatorId, lessonId, lessonIds, hasAccess, refreshTrigger }: Props) {
  const { user, profile } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const lessonKey = lessonIds.join(",");
  const isOwnCourse = creatorId === user?.id;
  const refresh = useCallback(() => setRevision((n) => n + 1), []);

  useEffect(() => {
    if (!user) return;
    return subscribeToRewardEarned((event) => {
      if (event.userId === user.id && event.pointType !== "creator" &&
        (event.contentId === courseId || lessonKey.split(",").includes(event.contentId || ""))) refresh();
    });
  }, [courseId, lessonKey, refresh, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    async function load() {
      try {
        const [events, progress, config, settings] = await Promise.all([
          supabase.from("reward_events").select("action_key,points,metadata")
            .eq("user_id", user!.id).eq("point_type", "user").contains("metadata", { course_id: courseId }),
          supabase.from("course_lesson_progress").select("lesson_id,progress_percent,completed,watched_seconds")
            .eq("user_id", user!.id).eq("course_id", courseId),
          supabase.from("reward_actions_config").select("action_key,points_user")
            .eq("active", true).in("action_key", [...LESSON_ACTIONS, ...COURSE_ACTIONS]),
          supabase.rpc("get_economic_v1_settings"),
        ]);
        for (const result of [events, progress, config, settings]) if (result.error) throw result.error;
        const economicSettings = settings.data as { user_points_multipliers?: Record<string, number> } | null;
        const multiplier = Number(economicSettings?.user_points_multipliers?.[profile?.plan || "free"] ?? 1);
        if (!cancelled) {
          setSummary(buildCourseRewardSummary({
            events: events.data || [], progress: progress.data || [], configs: config.data || [],
            lessonId, lessonIds: lessonKey.split(",").filter(Boolean), multiplier,
            hasAccess, isOwnCourse,
          }));
          setError(false);
        }
      } catch (cause) {
        console.error("Error loading course rewards:", cause);
        if (!cancelled) setError(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [courseId, lessonId, lessonKey, hasAccess, isOwnCourse, profile?.plan, refreshTrigger, revision, user]);

  if (!user) return null;
  if (error) return <div className="rounded-lg border border-border p-3 text-sm text-muted-foreground">Não foi possível carregar os Points do curso. <button className="text-brand underline" onClick={refresh}>Tentar novamente</button></div>;
  if (!summary) return <div className="h-24 animate-pulse rounded-lg bg-muted/40" aria-label="Carregando Points do curso" />;

  const icons = [Eye, PlayCircle, CheckCircle2];
  return (
    <div className="rounded-lg border border-border/40 bg-card/60 p-3 space-y-3" aria-label="Points da aula e do curso">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-brand"><Zap className="h-4 w-4" /> +{summary.lessonPoints} Points <span className="font-normal text-muted-foreground">nesta aula</span></span>
        <div className="flex items-center gap-2">
          {summary.milestones.map((milestone, index) => {
            const Icon = icons[index];
            return <span key={milestone.key} title={`${milestone.label} · ${milestone.awarded ? "Conquistado" : "Disponível"} · +${milestone.points} Points`} className={`flex h-6 w-6 items-center justify-center rounded-full ${milestone.awarded ? "bg-brand/15 text-brand" : "bg-muted text-muted-foreground/50"}`}><Icon className="h-3.5 w-3.5" /></span>;
          })}
        </div>
        {!isOwnCourse && <span className="ml-auto text-xs text-muted-foreground">Ainda disponíveis: +{summary.lessonAvailable} Points</span>}
      </div>
      <div className="border-t border-border/40 pt-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-1.5 font-medium"><BookOpen className="h-3.5 w-3.5 text-brand" /> Curso: {summary.completedLessons}/{lessonIds.length} aulas concluídas</span>
          <span className="text-brand font-semibold">+{summary.totalPoints} Points no curso</span>
        </div>
        <Progress value={summary.coursePercent} className="h-1.5" indicatorClassName="bg-brand" />
        <p className="text-xs text-muted-foreground">{isOwnCourse ? "Seu próprio curso não gera recompensas. O progresso das aulas continua registrado." : !hasAccess ? "Aula de preview: os Points são desta aula. O bônus do curso exige acesso completo e todas as aulas concluídas." : summary.courseBonusAwarded ? `Bônus de conclusão conquistado: +${summary.courseBonusPoints} Points.` : `Conclua todas as aulas para conquistar o bônus de +${summary.courseBonusPoints} Points.`}</p>
        {!isOwnCourse && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer hover:text-foreground">Detalhes dos Points</summary><div className="mt-2 space-y-1"><p>Aulas do curso: +{summary.allLessonPoints} Points conquistados.</p><p>Ações do curso e bônus: +{summary.coursePoints} Points conquistados.</p>{hasAccess && <p>Ainda disponíveis no curso: +{summary.totalAvailable} Points, incluindo aulas, ações e bônus final.</p>}<p>Cada marco de cada aula e o bônus final são recompensados uma única vez.</p></div></details>}
      </div>
    </div>
  );
}
