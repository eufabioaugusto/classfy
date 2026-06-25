export type CreatorSummary = {
  display_name?: string | null;
  avatar_url?: string | null;
};

export type ContentSummary = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  content_type?: string | null;
  visibility?: string | null;
  views_count?: number | null;
  duration_seconds?: number | null;
  profiles?: CreatorSummary | CreatorSummary[] | null;
};
