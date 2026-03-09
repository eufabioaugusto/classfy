import { useParams, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { ContentActions } from "@/components/ContentActions";
import { ContentComments } from "@/components/ContentComments";
import { FollowButton } from "@/components/FollowButton";
import { FeaturedBadge } from "@/components/FeaturedBadge";
import { GlobalLoader } from "@/components/GlobalLoader";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { useContentMetrics } from "@/hooks/useContentMetrics";

interface Content {
  id: string;
  content_type: "aula" | "short" | "podcast" | "live";
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
  const audioRef = useRef<HTMLAudioElement>(null);

  const {
    handleTimeUpdate: handleMetricsTimeUpdate,
    registerView,
    resetMetrics,
  } = useContentMetrics({
    contentId: id || "",
    duration: content?.duration_seconds || 0,
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
          id, content_type, title, description, file_url, thumbnail_url,
          visibility, price, duration_seconds, views_count, likes_count,
          creator:profiles!creator_id(id, display_name, avatar_url)
        `)
        .eq('id', id)
        .eq('status', 'approved')
        .eq('content_type', 'podcast')
        .single();

      if (error) throw error;

      setContent(data);
      checkAccess(data);
      resetMetrics();
      await registerView();
    } catch (error: any) {
      toast.error("Podcast não encontrado");
    } finally {
      setLoadingContent(false);
    }
  };

  const checkAccess = async (content: Content) => {
    if (!profile || !user) return;
    const userPlan = profile.plan || 'free';

    if (content.visibility === 'paid') {
      const { data: purchase } = await supabase
        .from('purchased_contents')
        .select('id')
        .eq('user_id', user.id)
        .eq('content_id', content.id)
        .maybeSingle();

      if (purchase) {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setShowPurchaseModal(true);
      }
      return;
    }

    if (content.visibility === 'free') {
      setHasAccess(true);
    } else if (content.visibility === 'pro') {
      if (['pro', 'premium'].includes(userPlan)) {
        setHasAccess(true);
      } else {
        setRequiredUpgradePlan('pro');
        setShowUpgradeModal(true);
      }
    } else if (content.visibility === 'premium') {
      if (userPlan === 'premium') {
        setHasAccess(true);
      } else {
        setRequiredUpgradePlan('premium');
        setShowUpgradeModal(true);
      }
    }
  };

  const handleAudioTimeUpdate = () => {
    if (!audioRef.current || !content) return;
    handleMetricsTimeUpdate(audioRef.current.currentTime);
  };

  if (loading) return <GlobalLoader />;
  if (!user) return <Navigate to="/auth" replace />;
  if (loadingContent) return <GlobalLoader />;
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
            <audio ref={audioRef} className="w-full" controls onTimeUpdate={handleAudioTimeUpdate} src={content.file_url} />
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
          
          <ContentActions contentId={content.id} hasAccess={hasAccess} />

          <Card className="p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                  {content.creator.display_name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold flex items-center gap-1">
                    {content.creator.display_name}
                    <FeaturedBadge creatorId={content.creator.id} size="sm" />
                  </p>
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
