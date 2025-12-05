-- Fix: Restrict comments visibility to approved content only
DROP POLICY IF EXISTS "Comments viewable by all" ON public.comments;

CREATE POLICY "Comments viewable on approved content"
  ON public.comments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contents 
      WHERE contents.id = comments.content_id 
      AND contents.status = 'approved'
    )
  );