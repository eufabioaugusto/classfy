-- Create transcriptions table to store video/audio transcriptions
CREATE TABLE IF NOT EXISTS public.transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  language TEXT DEFAULT 'pt-BR',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(content_id)
);

-- Enable RLS
ALTER TABLE public.transcriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can view transcriptions of approved content
CREATE POLICY "Transcriptions viewable by all" 
ON public.transcriptions 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.contents 
    WHERE contents.id = transcriptions.content_id 
    AND contents.status = 'approved'
  )
);

-- Policy: System can insert transcriptions
CREATE POLICY "System can insert transcriptions" 
ON public.transcriptions 
FOR INSERT 
WITH CHECK (true);

-- Policy: System can update transcriptions
CREATE POLICY "System can update transcriptions" 
ON public.transcriptions 
FOR UPDATE 
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_transcriptions_content_id ON public.transcriptions(content_id);

-- Create index for full-text search on transcription text
CREATE INDEX idx_transcriptions_text_search ON public.transcriptions USING gin(to_tsvector('portuguese', text));