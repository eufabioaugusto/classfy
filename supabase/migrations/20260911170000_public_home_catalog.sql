-- A Home e uma vitrine publica, mas o playback continua exigindo autenticacao.
-- Esta RPC expoe somente metadados editoriais seguros e preserva as policies
-- restritivas das tabelas contents/courses e dos ativos de video.
CREATE OR REPLACE FUNCTION public.get_public_home_catalog()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'contents', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'description', left(c.description, 320),
          'thumbnail_url', c.thumbnail_url,
          'content_type', c.content_type,
          'creator_id', c.creator_id,
          'category_id', c.category_id,
          'duration_minutes', c.duration_minutes,
          'duration_seconds', c.duration_seconds,
          'is_free', c.is_free,
          'lesson_count', c.lesson_count,
          'price', c.price,
          'discount', c.discount,
          'required_plan', c.required_plan,
          'tags', c.tags,
          'views_count', c.views_count,
          'visibility', c.visibility,
          'published_at', c.published_at,
          'created_at', c.created_at,
          'profiles', jsonb_build_object(
            'display_name', p.display_name,
            'avatar_url', p.avatar_url
          )
        ) ORDER BY c.created_at DESC
      )
      FROM public.contents c
      LEFT JOIN public.profiles p ON p.id = c.creator_id
      WHERE c.status = 'approved'
    ), '[]'::jsonb),
    'courses', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'title', c.title,
          'description', left(c.description, 320),
          'thumbnail_url', c.thumbnail_url,
          'content_type', 'curso',
          'creator_id', c.creator_id,
          'duration_seconds', c.total_duration_seconds,
          'lesson_count', c.total_lessons,
          'price', c.price,
          'discount', c.discount,
          'tags', c.tags,
          'views_count', c.views_count,
          'visibility', c.visibility,
          'published_at', c.published_at,
          'created_at', c.created_at,
          'profiles', jsonb_build_object(
            'display_name', p.display_name,
            'avatar_url', p.avatar_url
          )
        ) ORDER BY c.created_at DESC
      )
      FROM public.courses c
      LEFT JOIN public.profiles p ON p.id = c.creator_id
      WHERE c.status = 'approved'
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_public_home_catalog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_home_catalog() TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_home_catalog() IS
  'Metadados publicos da vitrine da Home; nao expoe fontes ou identificadores de playback.';
