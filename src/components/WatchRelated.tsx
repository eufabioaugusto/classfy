import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Play, Clock } from "lucide-react";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";

interface WatchRelatedProps {
  contentId: string;
  categoryId?: string | null;
  tags: string[] | null;
  contentType: "aula" | "short" | "podcast" | "curso";
  currentContent?: {
    id: string;
    title: string;
    thumbnail_url?: string;
    file_url: string;
    duration_seconds?: number;
    creator?: { display_name: string } | null;
  };
  currentTime?: number;
}

interface RelatedContent {
  id: string;
  title: string;
  thumbnail_url: string;
  duration_seconds: number;
  views_count: number;
  content_type: "aula" | "short" | "podcast" | "curso";
  creator?: {
    display_name?: string | null;
  } | null;
}

export const WatchRelated = ({ contentId, categoryId, tags, contentType, currentContent, currentTime }: WatchRelatedProps) => {
  const [relatedContents, setRelatedContents] = useState<RelatedContent[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { startMiniPlayer } = useMiniPlayer();

  useEffect(() => {
    fetchRelatedContents();
  }, [contentId, categoryId, tags]);

  const fetchRelatedContents = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('contents')
        .select(`
          id,
          title,
          thumbnail_url,
          duration_seconds,
          views_count,
          content_type,
          creator:profiles!creator_id(display_name)
        `)
        .eq('status', 'approved')
        .neq('id', contentId)
        .limit(6);

      // Priorizar mesma categoria
      if (categoryId) {
        query = query.eq('category_id', categoryId);
      }

      // Se tiver tags, buscar por overlap
      if (tags && tags.length > 0) {
        query = query.overlaps('tags', tags);
      }

      const { data, error } = await query;

      if (error) throw error;

      setRelatedContents(data || []);
    } catch (error) {
      console.error('Error fetching related contents:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleContentClick = (id: string) => {
    // If we have current content and time > 0, start mini player for current video
    if (currentContent && currentTime && currentTime > 5) {
      startMiniPlayer({
        id: currentContent.id,
        title: currentContent.title,
        subtitle: currentContent.creator?.display_name,
        thumbnail_url: currentContent.thumbnail_url,
        file_url: currentContent.file_url,
        duration_seconds: currentContent.duration_seconds,
        creator: currentContent.creator ? { display_name: currentContent.creator.display_name } : undefined,
      }, currentTime);
    }
    navigate(`/watch/${id}`, isMobile ? { state: { backgroundLocation: location } } : undefined);
  };

  if (loading) {
    return (
      <Card className="overflow-hidden bg-muted/30">
        <div className="p-4 border-b border-border">
          <h5 className="font-semibold">Relacionados</h5>
        </div>
        <div className="p-4 space-y-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="w-32 h-20 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  if (relatedContents.length === 0) {
    return null;
  }

  return (
    <Card className="overflow-hidden bg-muted/30">
      <div className="p-4 border-b border-border">
        <h5 className="font-semibold">Relacionados</h5>
      </div>
      <ScrollArea className="h-[600px]">
        <div className="p-4 space-y-4">
          {relatedContents.map((content) => (
            <div
              key={content.id}
              onClick={() => handleContentClick(content.id)}
              className="flex gap-3 cursor-pointer group"
            >
              <div className="relative w-32 h-20 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                <img
                  src={content.thumbnail_url}
                  alt={content.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Play className="h-6 w-6 text-white fill-white" />
                </div>
                <div className="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                  {formatDuration(content.duration_seconds)}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h6 className="font-medium text-sm line-clamp-2 group-hover:text-primary transition-colors">
                  {content.title}
                </h6>
                <p className="text-xs text-muted-foreground mt-1">
                  {content.creator?.display_name || "Criador"}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" />
                  {content.views_count.toLocaleString()} visualizações
                </p>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </Card>
  );
};
