-- Allow admins to manage contents without triggering RLS violations

-- Ensure RLS is enabled (should already be, but safe)
ALTER TABLE public.contents ENABLE ROW LEVEL SECURITY;

-- INSERT: admins can create any content
DROP POLICY IF EXISTS "Admins can insert content" ON public.contents;
CREATE POLICY "Admins can insert content"
ON public.contents
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- UPDATE: admins can update any content
DROP POLICY IF EXISTS "Admins can update content" ON public.contents;
CREATE POLICY "Admins can update content"
ON public.contents
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

-- DELETE: admins can delete any content
DROP POLICY IF EXISTS "Admins can delete content" ON public.contents;
CREATE POLICY "Admins can delete content"
ON public.contents
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));
