-- Create featured-creators storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('featured-creators', 'featured-creators', true);

-- RLS policies for featured-creators bucket
CREATE POLICY "Admins can upload featured creator images"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'featured-creators' AND
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Featured creator images are publicly accessible"
ON storage.objects
FOR SELECT
USING (bucket_id = 'featured-creators');

CREATE POLICY "Admins can update featured creator images"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'featured-creators' AND
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Admins can delete featured creator images"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'featured-creators' AND
  has_role(auth.uid(), 'admin'::app_role)
);