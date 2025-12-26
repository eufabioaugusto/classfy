-- Add course_id column to boosts table
ALTER TABLE public.boosts 
ADD COLUMN course_id uuid REFERENCES public.courses(id) ON DELETE CASCADE;

-- Add constraint to ensure either content_id OR course_id is set (not both, not neither) for content objective
-- For profile objective, both can be null
ALTER TABLE public.boosts
ADD CONSTRAINT boosts_content_or_course_check 
CHECK (
  (objective = 'profile') OR 
  (objective = 'content' AND ((content_id IS NOT NULL AND course_id IS NULL) OR (content_id IS NULL AND course_id IS NOT NULL)))
);