-- Atualizar enum content_type para os novos valores
ALTER TYPE content_type RENAME TO content_type_old;

CREATE TYPE content_type AS ENUM ('aula', 'short', 'podcast');

-- Atualizar tabela contents com o novo tipo
ALTER TABLE contents 
  ALTER COLUMN content_type TYPE content_type 
  USING (
    CASE content_type::text
      WHEN 'video' THEN 'aula'::content_type
      WHEN 'course' THEN 'aula'::content_type
      ELSE 'aula'::content_type
    END
  );

-- Remover tipo antigo
DROP TYPE content_type_old;