import { useParams, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, ThumbsUp, Share2 } from "lucide-react";

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

      // Incrementar views
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
      // TODO: verificar se comprou
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

  const handleTimeUpdate = () => {
    if (!videoRef.current || !content) return;

    const currentTime = videoRef.current.currentTime;
    const duration = content.duration_seconds;

    if (!metricsRecorded.start && currentTime > 0) {
      recordMetric('start');
    }

    if (!metricsRecorded.half && currentTime > duration / 2) {
      recordMetric('half');
    }

    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      recordMetric('complete');
    }
  };

  if (loading || loadingContent) {
    return <div className="min-h-screen flex items-center justify-center bg-background">Carregando...</div>;
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!content) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-bold mb-2">Conteúdo não encontrado</h2>
        </Card>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-xl font-bold mb-2">Conteúdo Bloqueado</h2>
          <p className="text-muted-foreground mb-4">
            Assine para acessar este conteúdo.
          </p>
          <Badge variant="secondary" className="mb-4">{content.visibility.toUpperCase()}</Badge>
          <Button className="w-full">Assinar Agora</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4 md:p-8">
        {/* Player */}
        <div className="aspect-video bg-black rounded-lg overflow-hidden mb-6">
          <video
            ref={videoRef}
            src={content.file_url}
            poster={content.thumbnail_url}
            controls
            autoPlay
            className="w-full h-full"
            onTimeUpdate={handleTimeUpdate}
          />
        </div>

        {/* Info */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">{content.title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Eye className="w-4 h-4" />
                {content.views_count} visualizações
              </span>
              <span className="flex items-center gap-1">
                <ThumbsUp className="w-4 h-4" />
                {content.likes_count}
              </span>
            </div>
          </div>

          {/* Creator */}
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {content.creator.avatar_url && (
                  <img
                    src={content.creator.avatar_url}
                    alt={content.creator.display_name}
                    className="w-12 h-12 rounded-full"
                  />
                )}
                <div>
                  <p className="font-semibold">{content.creator.display_name}</p>
                </div>
              </div>
              <Button variant="secondary" className="gap-2">
                <Share2 className="w-4 h-4" />
                Compartilhar
              </Button>
            </div>
          </Card>

          {/* Description */}
          {content.description && (
            <Card className="p-4">
              <p className="text-muted-foreground whitespace-pre-wrap">{content.description}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
