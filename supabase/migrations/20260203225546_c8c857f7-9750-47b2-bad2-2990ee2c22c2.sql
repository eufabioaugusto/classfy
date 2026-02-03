-- Drop conflicting policies and create a unified one
DROP POLICY IF EXISTS "Approved creators can upload content" ON storage.objects;
DROP POLICY IF EXISTS "Creators can upload own content files" ON storage.objects;
DROP POLICY IF EXISTS "Creators can upload content files" ON storage.objects;

-- Create unified INSERT policy for contents bucket
CREATE POLICY "Creators and admins can upload content"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'contents' 
  AND (
    -- User folder: user_id/filename.ext
    (storage.foldername(name))[1] = auth.uid()::text
    OR
    -- Thumbnails folder: thumbnails/user_id/filename.ext
    ((storage.foldername(name))[1] = 'thumbnails' AND (storage.foldername(name))[2] = auth.uid()::text)
  )
  AND (
    has_role(auth.uid(), 'creator'::app_role) 
    OR has_role(auth.uid(), 'admin'::app_role)
  )
);