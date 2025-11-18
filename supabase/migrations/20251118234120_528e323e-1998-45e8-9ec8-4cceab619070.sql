-- Add tags column to contents table
ALTER TABLE contents 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT ARRAY[]::TEXT[];