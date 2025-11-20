-- Tornar study_id opcional em study_notes para permitir notas standalone do Watch
ALTER TABLE study_notes ALTER COLUMN study_id DROP NOT NULL;

-- Atualizar política de visualização para permitir notas sem estudo
DROP POLICY IF EXISTS "Users can view own notes" ON study_notes;

CREATE POLICY "Users can view own notes"
ON study_notes
FOR SELECT
USING (user_id = auth.uid());