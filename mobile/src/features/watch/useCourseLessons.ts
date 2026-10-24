import { useCallback, useEffect, useRef, useState } from 'react';
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

type CourseState = {
  key: string;
  modules: CourseModule[];
  completedLessons: string[];
  currentLesson: CourseLesson | null;
  progressPercent: number;
  loading: boolean;
  error: string | null;
};
const emptyCourseState = (key = ''): CourseState => ({ key, modules: [], completedLessons: [], currentLesson: null, progressPercent: 0, loading: false, error: null });

export function useCourseLessons({ courseId, enabled = false, initialLessonId }: UseCourseLessonsProps) {
  const { user } = useAuth();
  const owner = user?.id;
  const key = JSON.stringify([owner ?? null, courseId ?? null, initialLessonId ?? null, enabled]);
  const scope = useRef(key); scope.current = key;
  const generation = useRef(0), mounted = useRef(true);
  const [state, setState] = useState<CourseState>(emptyCourseState);

  const fetchCourseData = useCallback(async () => {
    if (!courseId || !enabled || !mounted.current || scope.current !== key) return;
    const request = ++generation.current;
    const current = () => mounted.current && scope.current === key && generation.current === request;
    setState(previous => ({ ...(previous.key === key ? previous : emptyCourseState(key)), loading: true, error: null }));

    try {
      // Resume information starts with the catalog, rather than adding another
      // network round trip before the correct lesson source can be selected.
      const [modulesResult, lessonsResult, enrollmentResult] = await Promise.all([
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
        owner ? supabase
          .from('course_enrollments')
          .select('id, completed_lessons, progress_percent, last_lesson_id')
          .eq('course_id', courseId)
          .eq('user_id', owner)
          .maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);

      if (!current()) return;
      if (modulesResult.error) throw modulesResult.error;
      if (lessonsResult.error) throw lessonsResult.error;

      const rawModules = modulesResult.data || [];
      const rawLessons = lessonsResult.data || [];

      let completedIds: string[] = [];
      let lastLessonId: string | null = null;
      let percent = 0;
      const { data: enrollment, error: enrollError } = enrollmentResult;
      if (enrollError) {
        console.error('Error fetching course enrollment:', enrollError);
      } else if (enrollment) {
        completedIds = enrollment.completed_lessons || [];
        lastLessonId = enrollment.last_lesson_id;
        percent = enrollment.progress_percent || 0;
      }

      const modulesWithLessons: CourseModule[] = rawModules.map((mod) => {
        const modLessons = rawLessons
          .filter((lesson) => lesson.module_id === mod.id)
          .sort((a, b) => a.order_index - b.order_index);

        return {
          ...mod,
          lessons: modLessons,
        };
      });

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

      setState({ key, modules: modulesWithLessons, completedLessons: completedIds, currentLesson: activeLesson, progressPercent: percent, loading: false, error: null });
    } catch (err: unknown) {
      if (!current()) return;
      console.error('Error loading course lessons/modules:', err);
      const message = (err as { message?: unknown })?.message;
      setState(previous => ({ ...(previous.key === key ? previous : emptyCourseState(key)), loading: false, error: typeof message === 'string' && message ? message : 'Erro ao carregar estrutura do curso.' }));
    }
  }, [courseId, enabled, owner, initialLessonId, key]);

  useEffect(() => {
    mounted.current = true;
    void fetchCourseData();
    return () => { mounted.current = false; generation.current++; };
  }, [fetchCourseData]);

  // The server records last_lesson_id when playback is accepted.
  const selectLesson = useCallback(async (lesson: CourseLesson) => {
    if (!mounted.current || scope.current !== key || !enabled || lesson.course_id !== courseId) return;
    setState(previous => previous.key === key ? { ...previous, currentLesson: lesson } : previous);
  }, [courseId, enabled, key]);

  const matches = enabled && !!courseId && state.key === key;

  return {
    modules: matches ? state.modules : [],
    completedLessons: matches ? state.completedLessons : [],
    currentLesson: matches ? state.currentLesson : null,
    progressPercent: matches ? state.progressPercent : 0,
    loading: enabled && !!courseId && (!matches || state.loading),
    error: matches ? state.error : null,
    selectLesson,
    refresh: fetchCourseData,
  };
}
