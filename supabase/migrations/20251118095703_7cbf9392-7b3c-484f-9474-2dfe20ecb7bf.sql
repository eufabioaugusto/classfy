-- Fix public data exposure on profiles table
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Authenticated users can view profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- Fix public data exposure on follows table
DROP POLICY IF EXISTS "Follows viewable by all" ON public.follows;

CREATE POLICY "Authenticated users can view follows"
ON public.follows
FOR SELECT
TO authenticated
USING (true);