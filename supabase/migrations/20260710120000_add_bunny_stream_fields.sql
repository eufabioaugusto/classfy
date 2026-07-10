-- Add Bunny Stream columns to contents table
ALTER TABLE public.contents
  ADD COLUMN IF NOT EXISTS video_provider TEXT DEFAULT 'supabase',
  ADD COLUMN IF NOT EXISTS bunny_library_id TEXT,
  ADD COLUMN IF NOT EXISTS bunny_video_id TEXT,
  ADD COLUMN IF NOT EXISTS bunny_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS bunny_hls_url TEXT,
  ADD COLUMN IF NOT EXISTS bunny_thumbnail_url TEXT;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_contents_video_provider ON public.contents(video_provider);
CREATE INDEX IF NOT EXISTS idx_contents_bunny_video_id ON public.contents(bunny_video_id);
CREATE INDEX IF NOT EXISTS idx_contents_bunny_status ON public.contents(bunny_status);
