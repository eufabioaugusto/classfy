-- A single editorial slot controls the opening card in Explore mode.
-- Without a saved row, the app keeps its existing automatic selection.
CREATE TABLE public.home_hero_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE RESTRICT,
  is_active boolean NOT NULL DEFAULT true,
  eyebrow_label text NOT NULL DEFAULT 'Em destaque',
  chip_label text,
  show_chip boolean NOT NULL DEFAULT true,
  title text,
  description text,
  thumbnail_url text,
  image_position text NOT NULL DEFAULT 'center' CHECK (image_position IN ('left', 'center', 'right')),
  alignment text NOT NULL DEFAULT 'left' CHECK (alignment IN ('left', 'center', 'right')),
  primary_label text NOT NULL DEFAULT 'Assistir agora',
  primary_href text CHECK (primary_href IS NULL OR (primary_href LIKE '/%' AND primary_href NOT LIKE '//%')),
  show_secondary boolean NOT NULL DEFAULT true,
  secondary_label text NOT NULL DEFAULT 'Estudar com a Classy',
  secondary_href text CHECK (secondary_href IS NULL OR (secondary_href LIKE '/%' AND secondary_href NOT LIKE '//%')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.home_hero_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active home hero" ON public.home_hero_settings
FOR SELECT USING (is_active OR public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can manage home hero" ON public.home_hero_settings
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER update_home_hero_settings_updated_at
BEFORE UPDATE ON public.home_hero_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('home-hero', 'home-hero', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view home hero images" ON storage.objects
FOR SELECT USING (bucket_id = 'home-hero');

CREATE POLICY "Admins can upload home hero images" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'home-hero' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update home hero images" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'home-hero' AND public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (bucket_id = 'home-hero' AND public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete home hero images" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'home-hero' AND public.has_role(auth.uid(), 'admin'::public.app_role));
