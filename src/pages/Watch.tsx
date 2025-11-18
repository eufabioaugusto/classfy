import { useParams, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, ThumbsUp, Share2 } from "lucide-react";
import { useRewardSystem } from "@/hooks/useRewardSystem";

interface Content {
  id: string;
  content_type: "aula" | "short" | "podcast";
  title: string;
  description: string | null;
  file_url: string;
  thumbnail_url: string;
  visibility: "free" | "pro" | "premium" | "paid";
  price: number;
  duration_seconds: number;
  views_count: number;
  likes_count: number;
  creator: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export default function Watch() {
  const { id } = useParams();
  const { user, profile, loading } = useAuth();
  const [content, setContent] = useState<Content | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [metricsRecorded, setMetricsRecorded] = useState({
    start: false,
    half: false,
    complete: false
  });
  const [view15sRecorded, setView15sRecorded] = useState(false);
  const { processReward, trackProgress } = useRewardSystem();

  useEffect(() => {
    if (id && user) {
      fetchContent();
    }
  }, [id, user]);

  const fetchContent = async () => {
    try {
      const { data, error } = await supabase
        .from('contents')
        .select(`
          id,
          content_type,
          title,
          description,
          file_url,
          thumbnail_url,
          visibility,
          price,
          duration_seconds,
          views_count,
          likes_count,
          creator:profiles!creator_id(id, display_name, avatar_url)
        `)
        .eq('id', id)
        .eq('status', 'approved')
        .single();

      if (error) throw error;

      setContent(data);
      checkAccess(data);

      await supabase
        .from('contents')
        .update({ views_count: (data.views_count || 0) + 1 })
        .eq('id', id);
    } catch (error: any) {
      toast.error("Conteúdo não encontrado");
    } finally {
      setLoadingContent(false);
    }
  };

  const checkAccess = (content: Content) => {
    if (!profile) return;

    const userPlan = profile.plan || 'free';

    if (content.visibility === 'free') {
      setHasAccess(true);
    } else if (content.visibility === 'pro' && ['pro', 'premium'].includes(userPlan)) {
      setHasAccess(true);
    } else if (content.visibility === 'premium' && userPlan === 'premium') {
      setHasAccess(true);
    } else if (content.visibility === 'paid') {
      setHasAccess(false);
    } else {
      setHasAccess(false);
    }
  };

  const recordMetric = async (event: 'start' | 'half' | 'complete') => {
    if (metricsRecorded[event] || !user || !id) return;

    try {
      await supabase
        .from('content_metrics')
        .insert({
          content_id: id,
          user_id: user.id,
          event
        });

      setMetricsRecorded(prev => ({ ...prev, [event]: true }));
    } catch (error) {
      console.error('Error recording metric:', error);
    }
  };

  const handleTimeUpdate = async () => {
    if (!videoRef.current || !content || !user) return;

    const currentTime = videoRef.current.currentTime;
    const duration = content.duration_seconds;
    const percent = (currentTime / duration) * 100;

    if (!view15sRecorded && currentTime >= 15) {
      await processReward({
        actionKey: 'VIEW_15S',
        userId: user.id,
        contentId: content.id,
        metadata: { watch_time: currentTime },
      });
      setView15sRecorded(true);
    }

    if (!metricsRecorded.start && currentTime > 0) {
      await recordMetric('start');
    }

    await trackProgress(user.id, content.id, percent, currentTime);

    if (!metricsRecorded.half && currentTime > duration / 2) {
      await recordMetric('half');
    }

    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      await recordMetric('complete');
    }
  };

  if (loading || loadingContent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!content) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-2xl font-bold mb-4">Conteúdo não encontrado</h2>
          <p className="text-muted-foreground">Este vídeo pode ter sido removido ou não está mais disponível.</p>
        </Card>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">Conteúdo Bloqueado</h2>
          <p className="text-muted-foreground mb-4">
            Este conteúdo requer um plano {content.visibility.toUpperCase()} para ser acessado.
          </p>
          <Button onClick={() => window.location.href = '/conta'}>
            Fazer Upgrade
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <Card className="overflow-hidden">
              <video
                ref={videoRef}
                className="w-full aspect-video"
                controls
                onTimeUpdate={handleTimeUpdate}
                poster={content.thumbnail_url}
                src={content.file_url}
              />
            </Card>

            <div className="mt-4">
              <h1 className="text-2xl font-bold mb-2">{content.title}</h1>
              <div className="flex items-center gap-4 text-muted-foreground mb-4">
                <span className="flex items-center gap-1">
                  <Eye className="h-4 w-4" />
                  {content.views_count} views
                </span>
                <Badge variant="outline">{content.content_type}</Badge>
              </div>

              <Card className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      {content.creator.display_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold">{content.creator.display_name}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="icon">
                      <ThumbsUp className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" size="icon">
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                {content.description && (
                  <p className="mt-4 text-sm text-muted-foreground">{content.description}</p>
                )}
              </Card>
            </div>
          </div>

          <div className="lg:col-span-1">
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Conteúdos Relacionados</h3>
              <p className="text-sm text-muted-foreground">Em breve...</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
