-- Políticas para o bucket 'contents'
-- Permite creators fazer upload de seus próprios arquivos
CREATE POLICY "Creators can upload own content files"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'contents' 
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'creator'
  )
);

-- Permite creators atualizarem seus próprios arquivos
CREATE POLICY "Creators can update own content files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'contents' 
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'creator'
  )
);

-- Permite creators deletarem seus próprios arquivos
CREATE POLICY "Creators can delete own content files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'contents' 
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_id = auth.uid() 
    AND role = 'creator'
  )
);