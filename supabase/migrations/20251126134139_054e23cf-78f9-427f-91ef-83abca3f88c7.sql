-- Adicionar coluna lesson_id à tabela study_notes
ALTER TABLE public.study_notes
ADD COLUMN lesson_id uuid REFERENCES public.course_lessons(id) ON DELETE CASCADE;