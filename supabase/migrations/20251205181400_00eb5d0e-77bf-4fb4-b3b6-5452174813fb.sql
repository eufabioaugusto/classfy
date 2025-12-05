-- Fix: Restrict comments to authenticated users to prevent anonymous user behavior scraping
DROP POLICY IF EXISTS "Comments viewable on approved content" ON public.comments;

CREATE POLICY "Comments viewable by authenticated users on approved content"
  ON public.comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contents 
      WHERE contents.id = comments.content_id 
      AND contents.status = 'approved'
    )
  );