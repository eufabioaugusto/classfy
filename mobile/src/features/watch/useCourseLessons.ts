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
  media_asset_id?: string | null;
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
  initialLessonId?: string;
};

export function useCourseLessons({ courseId, enabled = false, initialLessonId }: UseCourseLessonsProps) {
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
      lastLessonId = initialLessonId || lastLessonId;
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
  }, [courseId, enabled, user?.id, initialLessonId]);

  useEffect(() => {
    fetchCourseData();
  }, [fetchCourseData]);

  // The server records last_lesson_id when playback is accepted.
  const selectLesson = useCallback(async (lesson: CourseLesson) => setCurrentLesson(lesson), []);

  return {
    modules,
    completedLessons,
    currentLesson,
    progressPercent,
    loading,
    error,
    selectLesson,
    refresh: fetchCourseData,
  };
}
