-- Migration: Add user interests and difficulties tracking columns to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS interests jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS difficulties jsonb DEFAULT '[]'::jsonb;
