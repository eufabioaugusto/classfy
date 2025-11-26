-- Tornar content_id nullable em study_notes para permitir notas em lessons de curso
ALTER TABLE study_notes ALTER COLUMN content_id DROP NOT NULL;