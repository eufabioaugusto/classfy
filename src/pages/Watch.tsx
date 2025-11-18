import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eye, Heart, Clock } from "lucide-react";
import { ContentActions } from "@/components/ContentActions";
import { ContentComments } from "@/components/ContentComments";
import { FollowButton } from "@/components/FollowButton";
import { useState, useEffect, useRef } from "react";
import { GlobalLoader } from "@/components/GlobalLoader";

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
  status?: string;
  creator: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export default function Watch() {
  const { id } = useParams();
  const { user, profile, loading, role } = useAuth();
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
      let query = supabase
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
          status,
          creator:profiles!creator_id(id, display_name, avatar_url)
        `)
        .eq('id', id);

      // Only filter by approved status if user is not admin
      if (role !== 'admin') {
        query = query.eq('status', 'approved');
      }

      const { data, error } = await query.single();

      if (error) throw error;

      setContent(data);
      checkAccess(data);

      await supabase
        .from('contents')
        .update({ views_count: (data.views_count || 0) + 1 })
        .eq('id', id);
    } catch (error: any) {
      console.error(error);
    } finally {
      setLoadingContent(false);
    }
  };

  const checkAccess = (content: Content) => {
    if (!profile) return;

    // Admins always have access
    if (role === 'admin') {
      setHasAccess(true);
      return;
    }

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
        metadata: { watch_time: currentTime }
      });
      setView15sRecorded(true);
    }

    if (!metricsRecorded.start && currentTime > 0) {
      await recordMetric('start');
    }

    if (!metricsRecorded.half && currentTime > duration / 2) {
      await recordMetric('half');
    }

    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      await recordMetric('complete');
    }

    await trackProgress(user.id, content.id, percent, currentTime);
  };

  if (loading || loadingContent) {
    return <GlobalLoader />;
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!content) return <div className="p-8">Conteúdo não encontrado</div>;
  if (!hasAccess) return <div className="p-8">Sem acesso</div>;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
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

            <div>
              <h1 className="text-3xl font-bold mb-2">{content.title}</h1>
              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                <span className="flex items-center gap-1">
                  <Eye className="h-4 w-4" />
                  {content.views_count || 0} visualizações
                </span>
                <span className="flex items-center gap-1">
                  <Heart className="h-4 w-4" />
                  {content.likes_count || 0} curtidas
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {Math.floor((content.duration_seconds || 0) / 60)} min
                </span>
              </div>
              
              <ContentActions contentId={content.id} />
            </div>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={content.creator.avatar_url || ''} />
                    <AvatarFallback>{content.creator.display_name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{content.creator.display_name}</p>
                  </div>
                </div>
                <FollowButton creatorId={content.creator.id} size="sm" />
              </div>
              {content.description && (
                <div>
                  <h2 className="text-xl font-semibold mb-2">Descrição</h2>
                  <p className="text-muted-foreground">{content.description}</p>
                </div>
              )}
            </Card>

            <ContentComments contentId={content.id} />
          </div>

          <div className="lg:col-span-1">
            <Card className="p-4">
              <h3 className="font-semibold mb-4">Relacionados</h3>
              <p className="text-sm text-muted-foreground">Em breve...</p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
