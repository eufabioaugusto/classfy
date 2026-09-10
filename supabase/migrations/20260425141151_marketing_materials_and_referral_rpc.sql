
-- Tabela de materiais de marketing para kit de afiliados
CREATE TABLE public.marketing_materials (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,
  type          text        NOT NULL CHECK (type IN ('banner','text','post','video_template')),
  file_url      text,
  thumbnail_url text,
  category      text        NOT NULL DEFAULT 'geral',
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  updated_at    timestamptz NOT NULL DEFAULT NOW()
);

ALTER TABLE public.marketing_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active materials"
  ON marketing_materials FOR SELECT TO authenticated
  USING (active = true);

CREATE POLICY "Admins can manage materials"
  ON marketing_materials FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RPC: garante que o user tem link de indicação, criando se não existir
CREATE OR REPLACE FUNCTION public.get_or_create_referral_link(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT referral_code INTO v_code FROM referral_links WHERE user_id = p_user_id;

  IF v_code IS NULL THEN
    -- Código: primeiros 8 chars do UUID + sufixo aleatório de 4 hex
    v_code := UPPER(
      REPLACE(SUBSTRING(p_user_id::text, 1, 8), '-', '') ||
      TO_HEX(FLOOR(RANDOM() * 65535)::int)
    );
    INSERT INTO referral_links (user_id, referral_code)
    VALUES (p_user_id, v_code)
    ON CONFLICT (user_id) DO NOTHING;

    -- Re-fetch in case of conflict
    SELECT referral_code INTO v_code FROM referral_links WHERE user_id = p_user_id;
  END IF;

  RETURN v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_referral_link TO authenticated;

-- Inserir alguns materiais de exemplo para o admin visualizar a UI
INSERT INTO marketing_materials (title, description, type, category, active)
VALUES
  ('Texto para WhatsApp', 'Mensagem pronta para enviar convidando para a Classfy', 'text', 'social', true),
  ('Texto para Instagram', 'Caption pronta para post no Instagram', 'text', 'social', true),
  ('Banner 1080x1080', 'Banner quadrado para stories e feed', 'banner', 'visual', false),
  ('Post para LinkedIn', 'Artigo pronto para profissionais', 'post', 'social', false);
;
