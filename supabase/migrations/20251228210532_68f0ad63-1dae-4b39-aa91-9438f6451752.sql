-- Add hero_image_url column for 4:3 horizontal image on dedicated page
ALTER TABLE public.featured_creators 
ADD COLUMN IF NOT EXISTS hero_image_url TEXT;