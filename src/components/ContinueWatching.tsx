import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Clock, PlayCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ContentSummary {
  id: string;
  title: string;
  thumbnail_url: string | null;
  content_type: string | null;
  duration_seconds: number | null;
  status?: string | null;
  profiles:
    | {
        display_name: string | null;
        creator_channel_name: string | null;
      }
    | {
        display_name: string | null;
        creator_channel_name: string | null;
      }[]
    | null;
}

interface ContinueWatchingItem {
  content_id: string;
  progress_percent: number;
  last_position_seconds: number | null;
  last_activity_at: string | null;
  contents: ContentSummary | null;
}

interface ProgressRow {
  content_id: string;
  progress_percent: number;
  last_position_seconds: number | null;
  completed: boolean | null;
  updated_at: string;
  contents: ContentSummary | null;
}

interface ViewRow {
  content_id: string | null;
  last_viewed_at: string | null;
  total_watch_time_seconds: number | null;
  contents: ContentSummary | null;
}

interface ContinueWatchingProps {
  userId: string;
  className?: string;
}

const clampPercent = (value: number | null | undefined) => {
  if (!value || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(Math.floor(value), 100));
};

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return null;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}min` : `${hours}h`;
};

const getCreatorName = (content: ContentSummary) => {
  const profile = Array.isArray(content.profiles) ? content.profiles[0] : content.profiles;
  return profile?.creator_channel_name || profile?.display_name || "Creator Classfy";
};

const getContentTypeLabel = (contentType?: string | null) => {
  switch (contentType) {
    case "podcast":
      return "Podcast";
    case "short":
      return "Short";
    case "live":
      return "Live";
    case "curso":
      return "Curso";
    case "aula":
      return "Aula";
    default:
      return "Conteúdo";
  }
};

const isNewer = (candidate: string | null, current: string | null) => {
  if (!candidate) return false;
  if (!current) return true;
  return new Date(candidate).getTime() > new Date(current).getTime();
};

export function ContinueWatching({ userId, className }: ContinueWatchingProps) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ContinueWatchingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    let mounted = true;

    const fetchContinueWatching = async () => {
      try {
        setLoading(true);
        const [progressResult, viewsResult] = await Promise.all([
          supabase
            .from("user_progress")
            .select(`
              content_id,
              progress_percent,
              last_position_seconds,
              completed,
              updated_at,
              contents (
                id,
                title,
                thumbnail_url,
                content_type,
                duration_seconds,
                status,
                profiles:creator_id (
                  display_name,
                  creator_channel_name
                )
              )
            `)
            .eq("user_id", userId)
            .order("updated_at", { ascending: false })
            .limit(100),
          supabase
            .from("content_views")
            .select(`
              content_id,
              last_viewed_at,
              total_watch_time_seconds,
              contents (
                id,
                title,
                thumbnail_url,
                content_type,
                duration_seconds,
                status,
                profiles:creator_id (
                  display_name,
                  creator_channel_name
                )
              )
            `)
            .eq("user_id", userId)
            .not("content_id", "is", null)
            .order("last_viewed_at", { ascending: false })
            .limit(20),
        ]);

        if (progressResult.error) throw progressResult.error;
        if (viewsResult.error) throw viewsResult.error;

        const progressRows = (progressResult.data || []) as unknown as ProgressRow[];
        const viewRows = (viewsResult.data || []) as unknown as ViewRow[];
        const completedContentIds = new Set(
          progressRows.filter((row) => row.completed === true).map((row) => row.content_id),
        );
        const mergedItems = new Map<string, ContinueWatchingItem>();

        progressRows.forEach((row) => {
          if (!row.contents || (row.contents.status && row.contents.status !== "approved") || row.completed === true) return;
          if (clampPercent(row.progress_percent) === 0 && !row.last_position_seconds) return;

          mergedItems.set(row.content_id, {
            content_id: row.content_id,
            progress_percent: clampPercent(row.progress_percent),
            last_position_seconds: row.last_position_seconds,
            last_activity_at: row.updated_at,
            contents: row.contents,
          });
        });

        viewRows.forEach((row) => {
          if (!row.content_id || !row.contents || (row.contents.status && row.contents.status !== "approved")) return;
          if (completedContentIds.has(row.content_id)) return;

          const existing = mergedItems.get(row.content_id);
          if (existing) {
            if (isNewer(row.last_viewed_at, existing.last_activity_at)) {
              existing.last_activity_at = row.last_viewed_at;
            }
            return;
          }

          const duration = row.contents.duration_seconds || 0;
          const watchedSeconds = row.total_watch_time_seconds || 0;
          mergedItems.set(row.content_id, {
            content_id: row.content_id,
            progress_percent: duration > 0 ? clampPercent((watchedSeconds / duration) * 100) : 0,
            last_position_seconds: watchedSeconds,
            last_activity_at: row.last_viewed_at,
            contents: row.contents,
          });
        });

        const nextItems = Array.from(mergedItems.values())
          .sort(
            (a, b) =>
              new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime(),
          )
          .slice(0, 3);

        if (mounted) setItems(nextItems);
      } catch (error) {
        console.error("Error fetching continue watching progress:", error);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchContinueWatching();

    return () => {
      mounted = false;
    };
  }, [userId]);

  const handlePress = (item: ContinueWatchingItem) => {
    const content = item.contents;
    if (!content) return;

    if (content.content_type === "short") {
      navigate(`/shorts/${content.id}`);
      return;
    }

    navigate(`/watch/${content.id}`);
  };

  if (loading || items.length === 0) return null;

  return (
    <section className={cn("cf2-home-section cf2-continue", className)}>
      <div className="cf2-home-section__header">
        <div>
          <span className="cf2-home-section__eyebrow">Retome de onde parou</span>
          <h2><Clock aria-hidden="true" /> Continue assistindo</h2>
        </div>
        <button type="button" onClick={() => navigate("/historico")}>
          Histórico <ArrowRight aria-hidden="true" />
        </button>
      </div>

      <div className="cf2-home-grid cf2-home-grid--three">
        {items.map((item) => {
          const content = item.contents;
          if (!content) return null;

          const percent = clampPercent(item.progress_percent);
          const duration = formatDuration(content.duration_seconds);
          const creatorName = getCreatorName(content);

          return (
            <button
              key={item.content_id}
              type="button"
              onClick={() => handlePress(item)}
              className="cf2-continue-card"
            >
              <span className="cf2-continue-card__media">
                {content.thumbnail_url ? (
                  <img src={content.thumbnail_url} alt={content.title} loading="lazy" />
                ) : (
                  <span className="cf2-continue-card__placeholder">
                    <PlayCircle aria-hidden="true" />
                  </span>
                )}
                <span className="cf2-continue-card__shade" />
                <span className="cf2-continue-card__type">{getContentTypeLabel(content.content_type)}</span>
                {duration && <span className="cf2-continue-card__duration">{duration}</span>}
                <span className="cf2-continue-card__progress" style={{ width: `${percent}%` }} />
              </span>

              <span className="cf2-continue-card__copy">
                <strong>{content.title}</strong>
                <small>{creatorName}</small>
                <span>{percent > 0 ? `${percent}% assistido` : "Começou agora"}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
