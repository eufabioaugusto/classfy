-- Atualizar política de inserção de study_notes para permitir notas standalone do Watch
DROP POLICY IF EXISTS "Users can create notes in own studies" ON study_notes;

-- Nova política que permite criar notas próprias (com ou sem study vinculado)
CREATE POLICY "Users can create own notes"
ON study_notes
FOR INSERT
WITH CHECK (auth.uid() = user_id);