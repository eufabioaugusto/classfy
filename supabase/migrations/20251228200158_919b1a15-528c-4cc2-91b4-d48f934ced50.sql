-- Add new columns to featured_creators for dedicated page
ALTER TABLE public.featured_creators
ADD COLUMN slug TEXT,
ADD COLUMN short_bio TEXT,
ADD COLUMN total_videos INTEGER DEFAULT 0,
ADD COLUMN total_duration_seconds INTEGER DEFAULT 0,
ADD COLUMN commission_link TEXT,
ADD COLUMN skills JSONB DEFAULT '[]'::jsonb,
ADD COLUMN trailer_url TEXT;

-- Create index on slug for fast lookups
CREATE UNIQUE INDEX idx_featured_creators_slug ON public.featured_creators(slug) WHERE slug IS NOT NULL;