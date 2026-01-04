-- Allow creators to read progress (completion) for their own contents (used in Studio Analytics)

DO $$
BEGIN
  -- Ensure RLS is enabled (it already is, but keep safe)
  EXECUTE 'ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY';

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='user_progress'
      AND policyname='Creators can view progress for owned content'
  ) THEN
    CREATE POLICY "Creators can view progress for owned content"
    ON public.user_progress
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.contents c
        WHERE c.id = user_progress.content_id
          AND c.creator_id = auth.uid()
      )
    );
  END IF;
END $$;