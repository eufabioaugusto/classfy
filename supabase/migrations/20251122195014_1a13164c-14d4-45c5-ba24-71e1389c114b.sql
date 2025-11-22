-- Create courses table for managing complete course structures
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  visibility content_visibility DEFAULT 'free',
  price NUMERIC DEFAULT 0,
  discount NUMERIC DEFAULT 0,
  tags TEXT[],
  total_duration_seconds INTEGER DEFAULT 0,
  total_lessons INTEGER DEFAULT 0,
  level TEXT CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  requirements TEXT,
  what_you_learn TEXT,
  published_at TIMESTAMP WITH TIME ZONE,
  views_count INTEGER DEFAULT 0,
  students_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create course_modules table for organizing lessons
CREATE TABLE IF NOT EXISTS public.course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create course_lessons table for individual lessons in modules
CREATE TABLE IF NOT EXISTS public.course_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id UUID NOT NULL REFERENCES public.course_modules(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  content_id UUID REFERENCES public.contents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  video_url TEXT,
  duration_seconds INTEGER,
  order_index INTEGER NOT NULL,
  is_preview BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create course_materials table for downloadable resources
CREATE TABLE IF NOT EXISTS public.course_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create course_quizzes table for assessments
CREATE TABLE IF NOT EXISTS public.course_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  questions JSONB NOT NULL,
  passing_score INTEGER DEFAULT 70,
  max_attempts INTEGER DEFAULT 3,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create course_enrollments table for tracking student enrollments
CREATE TABLE IF NOT EXISTS public.course_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  progress_percent INTEGER DEFAULT 0,
  completed_lessons UUID[] DEFAULT ARRAY[]::UUID[],
  last_lesson_id UUID REFERENCES public.course_lessons(id) ON DELETE SET NULL,
  enrolled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE,
  UNIQUE(course_id, user_id)
);

-- Enable RLS
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.course_enrollments ENABLE ROW LEVEL SECURITY;

-- RLS Policies for courses
CREATE POLICY "Approved courses viewable by all"
  ON public.courses FOR SELECT
  USING (status = 'approved' OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'));

CREATE POLICY "Creators can create courses"
  ON public.courses FOR INSERT
  WITH CHECK (creator_id = auth.uid() AND has_role(auth.uid(), 'creator'));

CREATE POLICY "Creators can update own courses"
  ON public.courses FOR UPDATE
  USING (creator_id = auth.uid());

CREATE POLICY "Creators can delete own courses"
  ON public.courses FOR DELETE
  USING (creator_id = auth.uid());

-- RLS Policies for course_modules
CREATE POLICY "Modules viewable based on course"
  ON public.course_modules FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses WHERE id = course_id AND 
    (status = 'approved' OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "Creators can manage own course modules"
  ON public.course_modules FOR ALL
  USING (EXISTS (SELECT 1 FROM courses WHERE id = course_id AND creator_id = auth.uid()));

-- RLS Policies for course_lessons
CREATE POLICY "Lessons viewable based on course"
  ON public.course_lessons FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses WHERE id = course_id AND 
    (status = 'approved' OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "Creators can manage own course lessons"
  ON public.course_lessons FOR ALL
  USING (EXISTS (SELECT 1 FROM courses WHERE id = course_id AND creator_id = auth.uid()));

-- RLS Policies for course_materials
CREATE POLICY "Materials viewable based on course"
  ON public.course_materials FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses WHERE id = course_id AND 
    (status = 'approved' OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "Creators can manage own course materials"
  ON public.course_materials FOR ALL
  USING (EXISTS (SELECT 1 FROM courses WHERE id = course_id AND creator_id = auth.uid()));

-- RLS Policies for course_quizzes
CREATE POLICY "Quizzes viewable based on course"
  ON public.course_quizzes FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM courses WHERE id = course_id AND 
    (status = 'approved' OR creator_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "Creators can manage own course quizzes"
  ON public.course_quizzes FOR ALL
  USING (EXISTS (SELECT 1 FROM courses WHERE id = course_id AND creator_id = auth.uid()));

-- RLS Policies for course_enrollments
CREATE POLICY "Users can view own enrollments"
  ON public.course_enrollments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can enroll in courses"
  ON public.course_enrollments FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own enrollments"
  ON public.course_enrollments FOR UPDATE
  USING (user_id = auth.uid());

-- Create indexes for better performance
CREATE INDEX idx_courses_creator ON courses(creator_id);
CREATE INDEX idx_courses_status ON courses(status);
CREATE INDEX idx_course_modules_course ON course_modules(course_id);
CREATE INDEX idx_course_lessons_module ON course_lessons(module_id);
CREATE INDEX idx_course_lessons_course ON course_lessons(course_id);
CREATE INDEX idx_course_materials_course ON course_materials(course_id);
CREATE INDEX idx_course_quizzes_course ON course_quizzes(course_id);
CREATE INDEX idx_course_enrollments_user ON course_enrollments(user_id);
CREATE INDEX idx_course_enrollments_course ON course_enrollments(course_id);