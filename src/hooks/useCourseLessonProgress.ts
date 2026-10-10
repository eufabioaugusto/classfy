import { useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";

interface CourseLessonProgressProps {
  courseId?: string | null;
  lessonId?: string | null;
  duration: number;
  enabled?: boolean;
  onMilestone?: () => void;
}

interface CourseProgressResult {
  accepted_watched_delta?: number;
  course_completed?: boolean;
  course_progress_percent?: number;
  lesson_progress_percent?: number;
  lesson_completed?: boolean;
}

/**
 * Registra progresso real de uma aula de curso. Cursos possuem contrato proprio:
 * As aulas geram marcos proprios e alimentam course_enrollments; a conclusao
 * integral gera o bonus COMPLETE_COURSE, separado dos ganhos por aula.
 */
export function useCourseLessonProgress({
  courseId,
  lessonId,
  duration,
  enabled = true,
  onMilestone,
}: CourseLessonProgressProps) {
  const { user } = useAuth();
  const { processReward } = useRewardSystem();
  const accumulatedRef = useRef(0);
  const previousTimeRef = useRef(0);
  const lastPersistedSecondRef = useRef(0);
  const persistPromiseRef = useRef<Promise<void> | null>(null);
  const completionRequestedRef = useRef(false);
  const awardedMilestonesRef = useRef(new Set<string>());
  const generationRef = useRef(0);

  const persist = useCallback(async () => {
    if (!enabled || !user || !courseId || !lessonId || duration <= 0) return;
    if (!persistPromiseRef.current) {
      const generation = generationRef.current;
      persistPromiseRef.current = (async () => {
        while (true) {
          if (generation !== generationRef.current) break;
          const watchedFloor = Math.floor(accumulatedRef.current);
          const watchedDelta = watchedFloor - lastPersistedSecondRef.current;
          if (watchedDelta <= 0) break;

          try {
            const { data, error } = await supabase.rpc("record_course_lesson_progress_v1", {
              p_lesson_id: lessonId,
              p_watched_seconds: watchedDelta,
              p_last_position_seconds: Math.floor(previousTimeRef.current),
              // Mantido no contrato por compatibilidade. O servidor calcula o valor real.
              p_progress_percent: 0,
            });
            if (error) throw error;
            if (generation !== generationRef.current) break;

            const result = data as CourseProgressResult | null;
            const acceptedDelta = Math.max(0, Number(result?.accepted_watched_delta || 0));
            lastPersistedSecondRef.current += acceptedDelta;
            const milestones = [
              ...(Math.floor(accumulatedRef.current) >= 15 ? ["VIEW_15S"] : []),
              ...(Number(result?.lesson_progress_percent || 0) >= 50 ? ["WATCH_50"] : []),
              ...(result?.lesson_completed ? ["WATCH_100"] : []),
            ];
            for (const actionKey of milestones) {
              if (generation !== generationRef.current) break;
              if (awardedMilestonesRef.current.has(actionKey)) continue;
              const reward = await processReward({ actionKey, userId: user.id, contentId: lessonId });
              if (generation === generationRef.current && (reward?.success || reward?.alreadyTracked || reward?.selfInteractionBlocked)) {
                awardedMilestonesRef.current.add(actionKey);
              }
            }
            if (generation !== generationRef.current) break;
            if (result?.course_completed && !completionRequestedRef.current) {
              const reward = await processReward({
                actionKey: "COMPLETE_COURSE",
                userId: user.id,
                contentId: courseId,
                metadata: { source: "course_lesson_progress_v1" },
              });
              if (generation === generationRef.current) {
                completionRequestedRef.current = Boolean(reward?.success || reward?.alreadyTracked || reward?.selfInteractionBlocked);
              }
            }
            onMilestone?.();

            // O servidor recusou o delta por cadencia. Um proximo timeupdate
            // tentara novamente sem avancar o checkpoint local.
            if (acceptedDelta < watchedDelta) break;
          } catch (error) {
            console.error("Error recording course lesson progress:", error);
            break;
          }
        }
      })().finally(() => {
        if (generation === generationRef.current) persistPromiseRef.current = null;
      });
    }

    await persistPromiseRef.current;
  }, [courseId, duration, enabled, lessonId, onMilestone, processReward, user]);

  const handleTimeUpdate = useCallback((currentTime: number) => {
    if (!enabled || !user || !courseId || !lessonId || duration <= 0) return;

    const delta = currentTime - previousTimeRef.current;
    previousTimeRef.current = currentTime;
    if (delta > 0 && delta <= 3) accumulatedRef.current += delta;

    const watchedFloor = Math.floor(accumulatedRef.current);
    if (watchedFloor >= lastPersistedSecondRef.current + 5) {
      void persist();
    }
  }, [courseId, duration, enabled, lessonId, persist, user]);

  const completeLesson = useCallback(async () => {
    await persist();
  }, [persist]);

  const reset = useCallback(() => {
    generationRef.current += 1;
    accumulatedRef.current = 0;
    previousTimeRef.current = 0;
    lastPersistedSecondRef.current = 0;
    persistPromiseRef.current = null;
    completionRequestedRef.current = false;
    awardedMilestonesRef.current.clear();
  }, []);

  const persistCurrent = useCallback(() => persist(), [persist]);

  return { handleTimeUpdate, completeLesson, persistCurrent, reset };
}
