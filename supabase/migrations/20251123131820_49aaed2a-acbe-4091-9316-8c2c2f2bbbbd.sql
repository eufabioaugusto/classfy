-- Drop the existing restrictive policy on contents
DROP POLICY IF EXISTS "Approved content viewable by all" ON public.contents;

-- Create new policy that allows everyone to view all contents (for discovery)
-- Access control for watching will be handled in the frontend
CREATE POLICY "All content viewable for discovery"
ON public.contents
FOR SELECT
TO public
USING (true);

-- Same for courses table
DROP POLICY IF EXISTS "Approved courses viewable by all" ON public.courses;

CREATE POLICY "All courses viewable for discovery"
ON public.courses
FOR SELECT
TO public
USING (true);