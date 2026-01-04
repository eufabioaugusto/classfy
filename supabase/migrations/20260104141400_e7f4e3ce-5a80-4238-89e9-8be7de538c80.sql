-- Fix analytics visibility for creators
-- Creators must be able to read metrics and views for their own content/courses.

-- content_views: allow creators to read rows for content/courses they own
ALTER TABLE public.content_views ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'content_views'
      AND policyname = 'Creators can view content views for owned content'
  ) THEN
    CREATE POLICY "Creators can view content views for owned content"
    ON public.content_views
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.contents c
        WHERE c.id = content_views.content_id
          AND c.creator_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.courses co
        WHERE co.id = content_views.course_id
          AND co.creator_id = auth.uid()
      )
    );
  END IF;
END $$;

-- content_views: allow viewers to update their own row (used to store watch time)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'content_views'
      AND policyname = 'Users can update own content views'
  ) THEN
    CREATE POLICY "Users can update own content views"
    ON public.content_views
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- content_metrics: allow creators to read metrics for owned content
ALTER TABLE public.content_metrics ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'content_metrics'
      AND policyname = 'Creators can view metrics for owned content'
  ) THEN
    CREATE POLICY "Creators can view metrics for owned content"
    ON public.content_metrics
    FOR SELECT
    USING (
      EXISTS (
        SELECT 1
        FROM public.contents c
        WHERE c.id = content_metrics.content_id
          AND c.creator_id = auth.uid()
      )
    );
  END IF;
END $$;