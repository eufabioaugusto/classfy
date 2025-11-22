-- Create storage bucket for courses if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('courses', 'courses', true)
ON CONFLICT (id) DO NOTHING;

-- Allow creators to upload course videos
CREATE POLICY "Creators can upload course content"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'courses' 
  AND (storage.foldername(name))[1]::uuid = auth.uid()
  AND (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'creator'
    )
    OR
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
);

-- Allow creators to view their own course content
CREATE POLICY "Creators can view own course content"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'courses'
  AND (
    (storage.foldername(name))[1]::uuid = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
);

-- Allow creators to update their own course content
CREATE POLICY "Creators can update own course content"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'courses'
  AND (storage.foldername(name))[1]::uuid = auth.uid()
);

-- Allow creators to delete their own course content
CREATE POLICY "Creators can delete own course content"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'courses'
  AND (storage.foldername(name))[1]::uuid = auth.uid()
);

-- Allow public access to view course content (for approved courses)
CREATE POLICY "Public can view course content"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'courses');