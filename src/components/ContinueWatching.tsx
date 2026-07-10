import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, PlayCircle } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface ContinueWatchingItem {
  content_id: string;
  progress_percent: number;
  last_position_seconds: number | null;
  contents: {
    id: string;
    title: string;
    thumbnail_url: string | null;
    content_type: string | null;
    duration_seconds: number | null;
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
  } | null;
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

const getCreatorName = (profiles: ContinueWatchingItem["contents"] extends infer T ? T : never) => {
  if (!profiles || typeof profiles !== "object" || !("profiles" in profiles)) return "Creator Classfy";

  const profileValue = profiles.profiles;
  const profile = Array.isArray(profileValue) ? profileValue[0] : profileValue;
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
      return "Conteudo";
  }
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

    const fetchProgress = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("user_progress")
          .select(`
            content_id,
            progress_percent,
            last_position_seconds,
            contents:content_id (
              id,
              title,
              thumbnail_url,
              content_type,
              duration_seconds,
              profiles:creator_id (
                display_name,
                creator_channel_name
              )
            )
          `)
          .eq("user_id", userId)
          .eq("completed", false)
          .gt("progress_percent", 0)
          .order("updated_at", { ascending: false })
          .limit(5);

        if (error) throw error;
        if (mounted) setItems((data || []) as unknown as ContinueWatchingItem[]);
      } catch (error) {
        console.error("Error fetching continue watching progress:", error);
        if (mounted) setItems([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchProgress();

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
    <section className={cn("space-y-3 sm:space-y-4", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-foreground" />
          <h2 className="text-lg sm:text-2xl font-bold text-foreground">Continue assistindo</h2>
        </div>
        <button
          type="button"
          onClick={() => navigate("/historico")}
          className="text-xs sm:text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Ver tudo
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
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
              className="group w-full overflow-hidden rounded-xl border border-border/70 bg-card text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg"
            >
              <div className="relative aspect-video overflow-hidden bg-muted">
                {content.thumbnail_url ? (
                  <img
                    src={content.thumbnail_url}
                    alt={content.title}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-muted to-muted/40">
                    <PlayCircle className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
                <div className="absolute left-2 top-2 bg-black/50 text-white font-bold text-[10px] px-2 py-0.5 rounded shadow-md transition-colors duration-300 group-hover:bg-black/75">
                  {getContentTypeLabel(content.content_type)}
                </div>
                {duration && (
                  <div className="absolute bottom-2 right-2 rounded-md bg-black/75 px-2 py-1 text-[11px] font-semibold text-white">
                    {duration}
                  </div>
                )}
              </div>

              <div className="space-y-2 p-3">
                <div>
                  <p className="line-clamp-1 text-sm font-semibold text-foreground">{content.title}</p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{creatorName}</p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-cinematic-accent" style={{ width: `${percent}%` }} />
                  </div>
                  <span className="w-8 text-right text-[11px] font-semibold text-muted-foreground">{percent}%</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
