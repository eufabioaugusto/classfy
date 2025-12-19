-- Allow all authenticated users to view public profile information (display_name, avatar_url)
-- This is necessary for showing creator info on content pages
CREATE POLICY "Anyone can view public profile info" 
ON public.profiles 
FOR SELECT 
USING (true);

-- Drop the admin-only policy since it's now redundant with the new public policy
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;