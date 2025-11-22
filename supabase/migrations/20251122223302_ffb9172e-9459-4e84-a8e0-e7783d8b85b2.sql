-- Create table to track video processing jobs
CREATE TABLE IF NOT EXISTS public.video_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.courses(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  original_path TEXT NOT NULL,
  compressed_path TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  file_size BIGINT,
  compressed_size BIGINT,
  compression_ratio NUMERIC,
  metadata JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add index for querying jobs by status
CREATE INDEX IF NOT EXISTS idx_video_jobs_status ON public.video_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_video_jobs_user_id ON public.video_processing_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_video_jobs_course_id ON public.video_processing_jobs(course_id);

-- Enable RLS
ALTER TABLE public.video_processing_jobs ENABLE ROW LEVEL SECURITY;

-- Creators can view their own jobs
CREATE POLICY "Users can view own video jobs"
ON public.video_processing_jobs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins can view all jobs
CREATE POLICY "Admins can view all video jobs"
ON public.video_processing_jobs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- System can insert jobs
CREATE POLICY "System can insert video jobs"
ON public.video_processing_jobs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- System can update jobs
CREATE POLICY "System can update video jobs"
ON public.video_processing_jobs
FOR UPDATE
TO authenticated
USING (true);

-- Add trigger to update updated_at
CREATE TRIGGER update_video_processing_jobs_updated_at
BEFORE UPDATE ON public.video_processing_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();