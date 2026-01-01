-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

-- Allow users to delete their own actions (needed for unlike)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'actions'
      AND policyname = 'Users can delete own actions'
  ) THEN
    CREATE POLICY "Users can delete own actions"
    ON public.actions
    FOR DELETE
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- (Optional but safe) allow users to select their own actions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'actions'
      AND policyname = 'Users can view own actions'
  ) THEN
    CREATE POLICY "Users can view own actions"
    ON public.actions
    FOR SELECT
    USING (auth.uid() = user_id);
  END IF;
END $$;