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
}

/**
 * Registra progresso real de uma aula de curso. Cursos possuem contrato proprio:
 * as aulas alimentam course_enrollments e somente a conclusao integral gera a
 * recompensa COMPLETE_COURSE.
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

  const persist = useCallback(async () => {
    if (!enabled || !user || !courseId || !lessonId || duration <= 0) return;
    if (!persistPromiseRef.current) {
      persistPromiseRef.current = (async () => {
        while (true) {
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

            const result = data as CourseProgressResult | null;
            const acceptedDelta = Math.max(0, Number(result?.accepted_watched_delta || 0));
            lastPersistedSecondRef.current += acceptedDelta;
            if (result?.course_completed && !completionRequestedRef.current) {
              completionRequestedRef.current = true;
              await processReward({
                actionKey: "COMPLETE_COURSE",
                userId: user.id,
                contentId: courseId,
                metadata: { source: "course_lesson_progress_v1" },
              });
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
        persistPromiseRef.current = null;
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
    accumulatedRef.current = 0;
    previousTimeRef.current = 0;
    lastPersistedSecondRef.current = 0;
    persistPromiseRef.current = null;
    completionRequestedRef.current = false;
  }, []);

  const persistCurrent = useCallback(() => persist(), [persist]);

  return { handleTimeUpdate, completeLesson, persistCurrent, reset };
}
