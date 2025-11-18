-- Add related_contents column to study_messages table to persist recommended content
ALTER TABLE study_messages 
ADD COLUMN IF NOT EXISTS related_contents JSONB DEFAULT NULL;