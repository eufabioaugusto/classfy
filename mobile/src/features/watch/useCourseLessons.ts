import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/authContext';

export type CourseLesson = {
  id: string;
  module_id: string;
  course_id: string;
  content_id: string | null;
  title: string;
  description: string | null;
  video_url: string;
  duration_seconds: number | null;
  order_index: number;
  is_preview: boolean;
  created_at: string;
  updated_at: string;
};

export type CourseModule = {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
  lessons: CourseLesson[];
  created_at: string;
  updated_at: string;
};

type UseCourseLessonsProps = {
  courseId?: string;
  enabled?: boolean;
};

export function useCourseLessons({ courseId, enabled = false }: UseCourseLessonsProps) {
  const { user } = useAuth();
  const [modules, setModules] = useState<CourseModule[]>([]);
  const [completedLessons, setCompletedLessons] = useState<string[]>([]);
  const [currentLesson, setCurrentLesson] = useState<CourseLesson | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCourseData = useCallback(async () => {
    if (!courseId || !enabled) return;

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch modules and lessons
      const [modulesResult, lessonsResult] = await Promise.all([
        supabase
          .from('course_modules')
          .select('*')
          .eq('course_id', courseId)
          .order('order_index', { ascending: true }),
        supabase
          .from('course_lessons')
          .select('*')
          .eq('course_id', courseId)
          .order('order_index', { ascending: true }),
      ]);

      if (modulesResult.error) throw modulesResult.error;
      if (lessonsResult.error) throw lessonsResult.error;

      const rawModules = modulesResult.data || [];
      const rawLessons = lessonsResult.data || [];

      // 2. Fetch enrollment/progress if user is logged in
      let completedIds: string[] = [];
      let lastLessonId: string | null = null;
      let percent = 0;
      let eId: string | null = null;

      if (user) {
        const { data: enrollment, error: enrollError } = await supabase
          .from('course_enrollments')
          .select('id, completed_lessons, progress_percent, last_lesson_id')
          .eq('course_id', courseId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (enrollError) {
          console.error('Error fetching course enrollment:', enrollError);
        } else if (enrollment) {
          completedIds = enrollment.completed_lessons || [];
          lastLessonId = enrollment.last_lesson_id;
          percent = enrollment.progress_percent || 0;
          eId = enrollment.id;
          setEnrollmentId(enrollment.id);
        }
      }

      setCompletedLessons(completedIds);
      setProgressPercent(percent);

      // 3. Match lessons inside their modules
      const modulesWithLessons: CourseModule[] = rawModules.map((mod) => {
        const modLessons = rawLessons
          .filter((lesson) => lesson.module_id === mod.id)
          .sort((a, b) => a.order_index - b.order_index);

        return {
          ...mod,
          lessons: modLessons,
        };
      });

      setModules(modulesWithLessons);

      // 4. Determine current active lesson
      let activeLesson: CourseLesson | null = null;
      if (lastLessonId) {
        activeLesson = rawLessons.find((l) => l.id === lastLessonId) || null;
      }

      // Fallback: Use the very first lesson of the first module if no last lesson was found
      if (!activeLesson && modulesWithLessons.length > 0) {
        for (const mod of modulesWithLessons) {
          if (mod.lessons.length > 0) {
            activeLesson = mod.lessons[0];
            break;
          }
        }
      }

      setCurrentLesson(activeLesson);
    } catch (err: any) {
      console.error('Error loading course lessons/modules:', err);
      setError(err.message || 'Erro ao carregar estrutura do curso.');
    } finally {
      setLoading(false);
    }
  }, [courseId, enabled, user]);

  useEffect(() => {
    fetchCourseData();
  }, [fetchCourseData]);

  // Update last lesson watched in database
  const selectLesson = useCallback(
    async (lesson: CourseLesson) => {
      setCurrentLesson(lesson);
      if (!user || !courseId) return;

      try {
        if (enrollmentId) {
          await supabase
            .from('course_enrollments')
            .update({ last_lesson_id: lesson.id })
            .eq('id', enrollmentId);
        } else {
          // Create course enrollment if user clicked a lesson and didn't have enrollment row yet
          const { data, error: insertError } = await supabase
            .from('course_enrollments')
            .insert({
              course_id: courseId,
              user_id: user.id,
              last_lesson_id: lesson.id,
              completed_lessons: [],
              progress_percent: 0,
            })
            .select('id')
            .single();

          if (!insertError && data) {
            setEnrollmentId(data.id);
          }
        }
      } catch (err) {
        console.error('Error updating last lesson id:', err);
      }
    },
    [courseId, enrollmentId, user]
  );

  // Mark lesson as complete and recalculate progress percentage
  const markLessonComplete = useCallback(
    async (lessonId: string) => {
      if (!user || !courseId) return;
      if (completedLessons.includes(lessonId)) return; // Already completed

      const newCompleted = [...completedLessons, lessonId];
      const totalLessonsCount = modules.reduce((acc, curr) => acc + curr.lessons.length, 0);
      const newPercent = totalLessonsCount > 0 ? Math.min(Math.round((newCompleted.length / totalLessonsCount) * 100), 100) : 0;

      // Optimistic update
      setCompletedLessons(newCompleted);
      setProgressPercent(newPercent);

      try {
        if (enrollmentId) {
          const updateData: any = {
            completed_lessons: newCompleted,
            progress_percent: newPercent,
          };

          // Also set this as last watched if we completed it
          if (currentLesson?.id === lessonId) {
            updateData.last_lesson_id = lessonId;
          }

          const { error: updateError } = await supabase
            .from('course_enrollments')
            .update(updateData)
            .eq('id', enrollmentId);

          if (updateError) throw updateError;
        } else {
          // Insert new enrollment if missing
          const { data, error: insertError } = await supabase
            .from('course_enrollments')
            .insert({
              course_id: courseId,
              user_id: user.id,
              completed_lessons: newCompleted,
              progress_percent: newPercent,
              last_lesson_id: currentLesson?.id === lessonId ? lessonId : null,
            })
            .select('id')
            .single();

          if (insertError) throw insertError;
          if (data) {
            setEnrollmentId(data.id);
          }
        }

        // Trigger COMPLETE_COURSE reward system hook if all lessons completed
        const totalLessonsResult = modules.reduce((acc, curr) => acc + curr.lessons.length, 0);
        if (newCompleted.length === totalLessonsResult && totalLessonsResult > 0) {
          try {
            await supabase.functions.invoke('process-reward', {
              body: {
                actionKey: 'COMPLETE_COURSE',
                userId: user.id,
                contentId: courseId,
                metadata: { lessonCount: totalLessonsResult },
              },
            });
          } catch (e) {
            console.error('Error invoking COMPLETE_COURSE reward:', e);
          }
        }
      } catch (err) {
        console.error('Error marking lesson complete:', err);
        // Rollback on error
        setCompletedLessons(completedLessons);
        setProgressPercent(progressPercent);
      }
    },
    [courseId, enrollmentId, user, completedLessons, modules, progressPercent, currentLesson]
  );

  return {
    modules,
    completedLessons,
    currentLesson,
    progressPercent,
    loading,
    error,
    selectLesson,
    markLessonComplete,
    refresh: fetchCourseData,
  };
}
