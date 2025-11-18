-- Criar bucket para armazenar conteúdos (vídeos, áudios e thumbnails)
INSERT INTO storage.buckets (id, name, public)
VALUES ('contents', 'contents', true)
ON CONFLICT (id) DO NOTHING;

-- Política: todos podem ver conteúdos
CREATE POLICY "Content files are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'contents');

-- Política: creators aprovados podem fazer upload
CREATE POLICY "Approved creators can upload content"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'contents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
    AND creator_status = 'approved'
  )
);

-- Política: creators podem atualizar seus próprios arquivos
CREATE POLICY "Creators can update own content"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'contents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Política: creators podem deletar seus próprios arquivos
CREATE POLICY "Creators can delete own content"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'contents' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);