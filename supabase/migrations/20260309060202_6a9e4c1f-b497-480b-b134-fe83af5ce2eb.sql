
-- Create a full-text search function for contents and courses
CREATE OR REPLACE FUNCTION public.search_platform_content(
  p_query text,
  p_limit integer DEFAULT 20,
  p_exclude_id uuid DEFAULT NULL
)
RETURNS TABLE(
  item_id uuid,
  item_type text,
  title text,
  description text,
  content_type text,
  thumbnail_url text,
  visibility text,
  tags text[],
  total_lessons integer,
  total_duration_seconds integer,
  transcription_snippet text,
  rank real
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH query_tokens AS (
    SELECT plainto_tsquery('portuguese', p_query) AS q
  ),
  content_results AS (
    SELECT 
      c.id AS item_id,
      'content'::text AS item_type,
      c.title,
      c.description,
      c.content_type::text,
      c.thumbnail_url,
      c.visibility::text,
      c.tags,
      NULL::integer AS total_lessons,
      NULL::integer AS total_duration_seconds,
      LEFT(t.text, 500) AS transcription_snippet,
      ts_rank(
        setweight(to_tsvector('portuguese', COALESCE(c.title, '')), 'A') ||
        setweight(to_tsvector('portuguese', COALESCE(c.description, '')), 'B') ||
        setweight(to_tsvector('portuguese', COALESCE(array_to_string(c.tags, ' '), '')), 'B') ||
        setweight(to_tsvector('portuguese', COALESCE(LEFT(t.text, 5000), '')), 'C'),
        q.q
      ) AS rank
    FROM contents c
    CROSS JOIN query_tokens q
    LEFT JOIN transcriptions t ON t.content_id = c.id
    WHERE c.status = 'approved'
      AND c.content_type IN ('aula', 'short', 'podcast')
      AND (p_exclude_id IS NULL OR c.id != p_exclude_id)
      AND (
        to_tsvector('portuguese', COALESCE(c.title, '')) ||
        to_tsvector('portuguese', COALESCE(c.description, '')) ||
        to_tsvector('portuguese', COALESCE(array_to_string(c.tags, ' '), '')) ||
        to_tsvector('portuguese', COALESCE(LEFT(t.text, 5000), ''))
      ) @@ q.q
  ),
  course_results AS (
    SELECT 
      cr.id AS item_id,
      'course'::text AS item_type,
      cr.title,
      cr.description,
      'curso'::text AS content_type,
      cr.thumbnail_url,
      cr.visibility::text,
      cr.tags,
      cr.total_lessons,
      cr.total_duration_seconds,
      NULL::text AS transcription_snippet,
      ts_rank(
        setweight(to_tsvector('portuguese', COALESCE(cr.title, '')), 'A') ||
        setweight(to_tsvector('portuguese', COALESCE(cr.description, '')), 'B') ||
        setweight(to_tsvector('portuguese', COALESCE(array_to_string(cr.tags, ' '), '')), 'B'),
        q.q
      ) AS rank
    FROM courses cr
    CROSS JOIN query_tokens q
    WHERE cr.status = 'approved'
      AND (p_exclude_id IS NULL OR cr.id != p_exclude_id)
      AND (
        to_tsvector('portuguese', COALESCE(cr.title, '')) ||
        to_tsvector('portuguese', COALESCE(cr.description, '')) ||
        to_tsvector('portuguese', COALESCE(array_to_string(cr.tags, ' '), ''))
      ) @@ q.q
  )
  SELECT * FROM (
    SELECT * FROM content_results
    UNION ALL
    SELECT * FROM course_results
  ) combined
  ORDER BY rank DESC
  LIMIT p_limit;
$$;
