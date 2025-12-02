import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
import { ContentCard } from "@/components/ContentCard";
import { supabase } from "@/integrations/supabase/client";
import { History, AlertCircle } from "lucide-react";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";

export default function Historico() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [contents, setContents] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [selectedContent, setSelectedContent] = useState<any>(null);

  const currentPlan = profile?.plan || "free";

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    loadHistory();
  }, [user, navigate]);

  const loadHistory = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const { data: viewData, error: viewError } = await supabase
        .from("content_views")
        .select(
          `
          content_id,
          last_viewed_at,
          contents (
            *,
            profiles:creator_id (
              display_name,
              avatar_url,
              creator_channel_name
            )
          )
        `
        )
        .eq("user_id", user.id)
        .order("last_viewed_at", { ascending: false })
        .limit(50);

      if (viewError) throw viewError;

      const contentsList = (viewData || [])
        .map((view: any) => view.contents)
        .filter((content: any) => content !== null);

      setContents(contentsList);
    } catch (error) {
      console.error("Error loading history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContentClick = (content: any) => {
    navigate(`/watch/${content.id}`);
  };

  const handleUpgradeClick = (plan: "pro" | "premium", content: any) => {
    setRequiredUpgradePlan(plan);
    setSelectedContent(content);
    setShowUpgradeModal(true);
  };

  const handlePurchaseClick = (content: any) => {
    setSelectedContent(content);
    setShowPurchaseModal(true);
  };

  return (
    <AdminLayout title="Histórico">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <History className="w-8 h-8 text-primary" />
            <h1 className="text-4xl font-bold text-foreground">Histórico</h1>
          </div>
          <p className="text-muted-foreground">
            Conteúdos que você assistiu recentemente
          </p>
        </div>

        {isLoading && (
          <div className="text-center py-20">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/30">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <p className="text-muted-foreground text-sm font-medium">
                Carregando histórico...
              </p>
            </div>
          </div>
        )}

        {!isLoading && contents.length === 0 && (
          <div className="text-center py-20">
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-xl font-semibold mb-2">
                  Nenhum conteúdo no histórico
                </h3>
                <p className="text-muted-foreground">
                  Os vídeos que você assistir aparecerão aqui
                </p>
              </div>
            </div>
          </div>
        )}

        {!isLoading && contents.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {contents.map((content) => (
              <ContentCard
                key={content.id}
                content={content}
                onClick={() => handleContentClick(content)}
                userPlan={currentPlan}
                onUpgradeClick={(plan) => handleUpgradeClick(plan, content)}
                onPurchaseClick={() => handlePurchaseClick(content)}
              />
            ))}
          </div>
        )}
      </div>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        requiredPlan={requiredUpgradePlan}
      />
      {selectedContent && (
        <PurchaseModal
          open={showPurchaseModal}
          onOpenChange={setShowPurchaseModal}
          content={{
            id: selectedContent.id,
            title: selectedContent.title,
            thumbnail_url: selectedContent.thumbnail_url,
            price: selectedContent.price,
            discount: selectedContent.discount || 0,
            creator_name:
              selectedContent.profiles?.display_name ||
              selectedContent.creator?.display_name ||
              "Creator",
          }}
          onPurchaseComplete={() => {
            setShowPurchaseModal(false);
            setSelectedContent(null);
          }}
        />
      )}
    </AdminLayout>
  );
}