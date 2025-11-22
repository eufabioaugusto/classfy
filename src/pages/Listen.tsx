import { useParams, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, AlertCircle } from "lucide-react";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { ContentActions } from "@/components/ContentActions";
import { ContentComments } from "@/components/ContentComments";
import { FollowButton } from "@/components/FollowButton";
import { GlobalLoader } from "@/components/GlobalLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";

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

export default function Listen() {
  const { id } = useParams();
  const { user, profile, loading } = useAuth();
  const [content, setContent] = useState<Content | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [isPurchased, setIsPurchased] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
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
        .eq('content_type', 'podcast')
        .single();

      if (error) throw error;

      setContent(data);
      checkAccess(data);

      await supabase
        .from('contents')
        .update({ views_count: (data.views_count || 0) + 1 })
        .eq('id', id);
    } catch (error: any) {
      toast.error("Podcast não encontrado");
    } finally {
      setLoadingContent(false);
    }
  };

  const checkAccess = async (content: Content) => {
    if (!profile || !user) return;
    
    const userPlan = profile.plan || 'free';
    
    // Check if content is paid and user has purchased it
    if (content.visibility === 'paid') {
      const { data: purchase } = await supabase
        .from('purchased_contents')
        .select('id')
        .eq('user_id', user.id)
        .eq('content_id', content.id)
        .maybeSingle();
      
      if (purchase) {
        setIsPurchased(true);
        setHasAccess(true);
        return;
      } else {
        setIsPurchased(false);
        setHasAccess(false);
        setShowPurchaseModal(true);
        return;
      }
    }
    
    // Check plan-based access
    if (content.visibility === 'free') {
      setHasAccess(true);
    } else if (content.visibility === 'pro') {
      if (['pro', 'premium'].includes(userPlan)) {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan('pro');
        setShowUpgradeModal(true);
      }
    } else if (content.visibility === 'premium') {
      if (userPlan === 'premium') {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan('premium');
        setShowUpgradeModal(true);
      }
    } else {
      setHasAccess(false);
    }
  };

  const recordMetric = async (event: 'start' | 'half' | 'complete') => {
    if (metricsRecorded[event] || !user || !id) return;
    try {
      await supabase.from('content_metrics').insert({ content_id: id, user_id: user.id, event });
      setMetricsRecorded(prev => ({ ...prev, [event]: true }));
    } catch (error) {
      console.error('Error recording metric:', error);
    }
  };

  const checkBingeWatch = async () => {
    if (!user) return;
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCompletions } = await supabase
      .from('content_metrics')
      .select('content_id')
      .eq('user_id', user.id)
      .eq('event', 'complete')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(3);

    if (recentCompletions && recentCompletions.length >= 3) {
      await processReward({
        actionKey: 'BINGE_WATCH',
        userId: user.id,
        metadata: { contentCount: recentCompletions.length },
      });
    }
  };

  const checkFirstContentWeek = async () => {
    if (!user) return;
    
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const { data: weeklyViews } = await supabase
      .from('content_metrics')
      .select('id')
      .eq('user_id', user.id)
      .eq('event', 'start')
      .gte('created_at', startOfWeek.toISOString())
      .limit(1);

    if (!weeklyViews || weeklyViews.length === 0) {
      await processReward({
        actionKey: 'FIRST_CONTENT_WEEK',
        userId: user.id,
        contentId: content.id,
      });
    }
  };

  const handleTimeUpdate = async () => {
    if (!audioRef.current || !content || !user) return;
    const currentTime = audioRef.current.currentTime;
    const duration = content.duration_seconds;
    const percent = (currentTime / duration) * 100;

    if (!view15sRecorded && currentTime >= 15) {
      await processReward({ actionKey: 'VIEW_15S', userId: user.id, contentId: content.id, metadata: { watch_time: currentTime } });
      setView15sRecorded(true);
    }

    if (!metricsRecorded.start && currentTime > 0) {
      await recordMetric('start');
      await checkFirstContentWeek();
    }
    if (!metricsRecorded.half && currentTime > duration / 2) await recordMetric('half');
    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      await recordMetric('complete');
      await checkBingeWatch();
    }

    await trackProgress(user.id, content.id, percent, currentTime);
  };

  if (loading || loadingContent) return <GlobalLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (!content) return <div className="p-8">Podcast não encontrado</div>;

  return (
    <div className="min-h-screen bg-background">
      <UpgradeModal 
        open={showUpgradeModal} 
        onOpenChange={setShowUpgradeModal}
        requiredPlan={requiredUpgradePlan}
      />
      
      <PurchaseModal
        open={showPurchaseModal}
        onOpenChange={setShowPurchaseModal}
        content={{
          id: content.id,
          title: content.title,
          thumbnail_url: content.thumbnail_url,
          price: content.price,
          discount: 0,
          creator_name: content.creator.display_name
        }}
        onPurchaseComplete={() => {
          setShowPurchaseModal(false);
          fetchContent();
        }}
      />
      
      <div className="max-w-4xl mx-auto p-4">
        <Card className="overflow-hidden">
          <div className="relative aspect-square max-w-md mx-auto">
            <img src={content.thumbnail_url} alt={content.title} className="w-full h-full object-cover" />
          </div>
          <div className="p-6">
            <audio ref={audioRef} className="w-full" controls onTimeUpdate={handleTimeUpdate} src={content.file_url} />
          </div>
        </Card>

        <div className="mt-4 space-y-4">
          <h1 className="text-2xl font-bold">{content.title}</h1>
          <div className="flex items-center gap-4 text-muted-foreground">
            <span className="flex items-center gap-1">
              <Eye className="h-4 w-4" />
              {content.views_count} plays
            </span>
            <Badge variant="outline">{content.content_type}</Badge>
          </div>
          
          <ContentActions contentId={content.id} />

          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  {content.creator.display_name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold">{content.creator.display_name}</p>
                </div>
              </div>
              <FollowButton creatorId={content.creator.id} size="sm" />
            </div>
            {content.description && (
              <p className="text-sm text-muted-foreground">{content.description}</p>
            )}
          </Card>

          <ContentComments contentId={content.id} />
        </div>
      </div>
    </div>
  );
}
