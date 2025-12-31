-- Add updated_at column to studies table to fix the trigger issue
ALTER TABLE public.studies ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();