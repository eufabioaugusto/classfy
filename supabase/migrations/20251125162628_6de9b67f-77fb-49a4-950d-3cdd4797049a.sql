-- Adicionar campo para capa do canal na tabela profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS cover_image_url TEXT;

-- Criar bucket para capas de canais
INSERT INTO storage.buckets (id, name, public)
VALUES ('covers', 'covers', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies para o bucket covers
CREATE POLICY "Capas são visíveis publicamente"
ON storage.objects FOR SELECT
USING (bucket_id = 'covers');

CREATE POLICY "Usuários podem fazer upload de suas próprias capas"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'covers' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Usuários podem atualizar suas próprias capas"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'covers' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Usuários podem deletar suas próprias capas"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'covers' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);