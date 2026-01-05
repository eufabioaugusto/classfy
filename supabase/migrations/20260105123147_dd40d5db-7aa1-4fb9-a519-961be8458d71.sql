-- Add show_on_home column to featured_creators table
ALTER TABLE public.featured_creators 
ADD COLUMN show_on_home boolean NOT NULL DEFAULT true;