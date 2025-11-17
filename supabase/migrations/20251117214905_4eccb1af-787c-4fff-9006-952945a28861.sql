-- Create plan_type enum (app_role already exists)
DO $$ BEGIN
  CREATE TYPE public.plan_type AS ENUM ('free', 'pro', 'premium');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create creator_status enum
DO $$ BEGIN
  CREATE TYPE public.creator_status AS ENUM ('none', 'pending', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add new columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS plan plan_type DEFAULT 'free' NOT NULL,
ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS creator_status creator_status DEFAULT 'none' NOT NULL,
ADD COLUMN IF NOT EXISTS creator_channel_name TEXT,
ADD COLUMN IF NOT EXISTS creator_bio TEXT;

-- Insert default 'user' role for all existing profiles (if user_roles exists)
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_roles') THEN
    INSERT INTO public.user_roles (user_id, role)
    SELECT id, 'user'::app_role
    FROM public.profiles
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE user_id = profiles.id
    );
  END IF;
END $$;

-- Update handle_new_user function to assign default role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  
  -- Assign default 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Create wallet for new user
  INSERT INTO public.wallets (user_id, balance, total_earned, total_withdrawn)
  VALUES (NEW.id, 0, 0, 0);
  
  RETURN NEW;
END;
$$;

-- Drop existing policy if exists
DROP POLICY IF EXISTS "Users can update their own creator request" ON public.profiles;

-- RLS Policy for profiles to allow creator status updates
CREATE POLICY "Users can update their own creator request"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Create creator_requests table for better tracking
CREATE TABLE IF NOT EXISTS public.creator_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  channel_name TEXT NOT NULL,
  bio TEXT,
  status creator_status DEFAULT 'pending' NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  reviewed_by UUID REFERENCES public.profiles(id),
  admin_notes TEXT
);

ALTER TABLE public.creator_requests ENABLE ROW LEVEL SECURITY;

-- RLS for creator_requests
CREATE POLICY "Users can view their own requests"
ON public.creator_requests
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own requests"
ON public.creator_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can manage all requests"
ON public.creator_requests
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));