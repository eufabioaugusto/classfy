-- Fix #1: Remove duplicate permissive RLS policies on profiles table
DROP POLICY IF EXISTS "Authenticated users can view basic profile data" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;

-- Fix #2: Update course_lessons RLS policy to verify purchase for paid courses
DROP POLICY IF EXISTS "Lessons viewable based on course" ON public.course_lessons;

CREATE POLICY "Lessons viewable with purchase check"
  ON public.course_lessons FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM courses c
      WHERE c.id = course_lessons.course_id 
      AND (
        c.creator_id = auth.uid() OR
        has_role(auth.uid(), 'admin'::app_role) OR
        (
          c.status = 'approved' AND (
            c.visibility = 'free' OR
            course_lessons.is_preview = true OR
            EXISTS (
              SELECT 1 FROM course_enrollments ce
              WHERE ce.course_id = c.id AND ce.user_id = auth.uid()
            )
          )
        )
      )
    )
  );