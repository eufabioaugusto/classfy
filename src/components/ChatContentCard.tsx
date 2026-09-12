import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Heart, Bookmark, Clock, Lock, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";

interface ChatContentCardProps {
  id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  content_type: "aula" | "short" | "podcast";
  duration_minutes?: number;
  required_plan?: "free" | "pro" | "premium";
  visibility?: "free" | "pro" | "premium" | "paid";
  price?: number;
  is_free?: boolean;
  relevanceScore?: number;
  onPlay?: (contentId: string) => void;
  compact?: boolean;
}

export const ChatContentCard = ({
  id,
  title,
  description,
  thumbnail_url,
  content_type,
  duration_minutes,
  required_plan,
  visibility = "free",
  price = 0,
  is_free = true,
  relevanceScore,
  onPlay,
  compact = false,
}: ChatContentCardProps) => {
  const navigate = useNavigate();
  const { user, profile, role } = useAuth();
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isPurchased, setIsPurchased] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredPlan, setRequiredPlan] = useState<"pro" | "premium">("pro");

  const userPlan = profile?.plan || "free";

  // Check if user has purchased the content (for paid visibility)
  useEffect(() => {
    const checkPurchase = async () => {
      if (visibility === "paid" && user) {
        const { data } = await supabase
          .from("purchased_contents")
          .select("id")
          .eq("user_id", user.id)
          .eq("content_id", id)
          .in("status", ["confirmed", "legacy_confirmed"])
          .maybeSingle();
        setIsPurchased(!!data);
      }
    };
    checkPurchase();
  }, [id, user, visibility]);

  const contentTypeLabel = {
    aula: "Aula",
    short: "Short",
    podcast: "Podcast",
  };

  const checkAccess = (): boolean => {
    // Admins always have access
    if (role === "admin") return true;

    // Check paid content
    if (visibility === "paid") {
      return isPurchased;
    }

    // Check plan-based access
    if (visibility === "free") {
      return true;
    } else if (visibility === "pro") {
      return ["pro", "premium"].includes(userPlan);
    } else if (visibility === "premium") {
      return userPlan === "premium";
    }

    return true;
  };

  const handleWatch = () => {
    const hasAccess = checkAccess();

    if (!hasAccess) {
      if (visibility === "paid") {
        setShowPurchaseModal(true);
      } else if (visibility === "pro") {
        setRequiredPlan("pro");
        setShowUpgradeModal(true);
      } else if (visibility === "premium") {
        setRequiredPlan("premium");
        setShowUpgradeModal(true);
      }
      return;
    }

    if (onPlay) {
      onPlay(id);
    } else {
      const route = content_type === "podcast" ? `/listen/${id}` : `/watch/${id}`;
      navigate(route);
    }
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast.error("Faça login para salvar conteúdos");
      return;
    }

    setLoading(true);
    try {
      if (isSaved) {
        const { error } = await supabase
          .from("saved_contents")
          .delete()
          .eq("content_id", id)
          .eq("user_id", user.id);

        if (error) throw error;
        setIsSaved(false);
        toast.success("Removido dos salvos");
      } else {
        const { error } = await supabase
          .from("saved_contents")
          .insert({ content_id: id, user_id: user.id });

        if (error) throw error;
        setIsSaved(true);
        toast.success("Salvo com sucesso!");
      }
    } catch (error) {
      console.error("Error saving content:", error);
      toast.error("Erro ao salvar conteúdo");
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast.error("Faça login para favoritar conteúdos");
      return;
    }

    setLoading(true);
    try {
      if (isFavorited) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("content_id", id)
          .eq("user_id", user.id);

        if (error) throw error;
        setIsFavorited(false);
        toast.success("Removido dos favoritos");
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ content_id: id, user_id: user.id });

        if (error) throw error;
        setIsFavorited(true);
        toast.success("Favoritado com sucesso!");
      }
    } catch (error) {
      console.error("Error favoriting content:", error);
      toast.error("Erro ao favoritar conteúdo");
    } finally {
      setLoading(false);
    }
  };

  const getPlanBadgeColor = (plan?: string) => {
    switch (plan) {
      case "pro":
        return "bg-badge-pro";
      case "premium":
        return "bg-badge-premium";
      default:
        return "bg-badge-free";
    }
  };

  const hasAccess = checkAccess();
  const isLocked = !hasAccess;
  const showPlanBadge = visibility === "pro" || visibility === "premium";

  // Compact attachment used inside the conversation.
  if (compact) {
    return (
      <>
        <button
          type="button"
          className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card p-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={handleWatch}
          aria-label={`${isLocked ? "Ver acesso a" : "Abrir"} ${title}`}
        >
          <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-muted">
            <img
              src={thumbnail_url || "/placeholder.svg"}
              alt={title}
              className="h-full w-full object-cover"
            />
            {showPlanBadge && (
              <div className="absolute right-1.5 top-1.5">
                <Crown
                  className={`w-3 h-3 drop-shadow-lg ${visibility === "pro" ? "text-yellow-400" : "text-red-500"}`}
                  fill="currentColor"
                />
              </div>
            )}
            {duration_minutes && (
              <div className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[9px] font-medium text-white">
                {duration_minutes}m
              </div>
            )}
            {isLocked && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                <Lock className="h-4 w-4 text-white" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">
              {contentTypeLabel[content_type]}
            </p>
            <h3 className="mt-0.5 line-clamp-2 text-xs font-medium leading-4 text-foreground">
              {title}
            </h3>
          </div>

          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
            {isLocked ? (
              <Lock className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 fill-current" />
            )}
          </span>
        </button>

        <UpgradeModal
          open={showUpgradeModal}
          onOpenChange={setShowUpgradeModal}
          requiredPlan={requiredPlan}
        />

        <PurchaseModal
          open={showPurchaseModal}
          onOpenChange={setShowPurchaseModal}
          content={{
            id,
            title,
            thumbnail_url: thumbnail_url || "/placeholder.svg",
            price: price,
            creator_name: "",
          }}
        />
      </>
    );
  }

  // Default full card - Uniform height design
  return (
    <>
      <Card className="overflow-hidden bg-card/80 backdrop-blur-sm border border-border/30 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 group cursor-pointer h-full flex flex-col" onClick={handleWatch}>
        {/* Thumbnail */}
        <div className="relative overflow-hidden bg-muted aspect-[16/9] flex-shrink-0">
          <img
            src={thumbnail_url || "/placeholder.svg"}
            alt={title}
            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
          />

          {/* Plan Badge - Top Right */}
          {showPlanBadge && (
            <div className="absolute top-2 right-2">
              <Crown
                className={`w-4 h-4 drop-shadow-lg ${visibility === "pro" ? "text-yellow-400" : "text-red-500"}`}
                fill="currentColor"
              />
            </div>
          )}
          
          {/* Badges */}
          <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap max-w-[calc(100%-4rem)]">
            <Badge className="bg-primary/95 backdrop-blur-md text-primary-foreground text-[10px] font-medium px-2 py-0.5 shadow-md">
              {contentTypeLabel[content_type]}
            </Badge>
            {relevanceScore && relevanceScore >= 50 && (
              <Badge 
                className={`backdrop-blur-md text-white text-[10px] font-medium px-2 py-0.5 shadow-md ${
                  relevanceScore >= 85 ? 'bg-green-600/95' : 
                  relevanceScore >= 70 ? 'bg-emerald-500/95' : 
                  'bg-amber-500/95'
                }`}
              >
                {relevanceScore}% match
              </Badge>
            )}
            {required_plan && required_plan !== 'free' && (
              <Badge className={`${getPlanBadgeColor(required_plan)} backdrop-blur-md text-white text-[10px] font-medium px-2 py-0.5 shadow-md`}>
                {required_plan.toUpperCase()}
              </Badge>
            )}
          </div>

          {/* Duration */}
          {duration_minutes && (
            <div className="absolute bottom-2 right-2 bg-black/90 backdrop-blur-md px-2 py-1 rounded-md text-[10px] font-medium text-white flex items-center gap-1 shadow-lg">
              <Clock className="w-3 h-3" />
              {duration_minutes}min
            </div>
          )}

          {/* Lock overlay */}
          {isLocked && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/30 backdrop-blur-[1px] flex items-center justify-center">
              <div className="bg-black/40 backdrop-blur-md rounded-full p-4">
                <Lock className="w-8 h-8 text-white drop-shadow-2xl" />
              </div>
            </div>
          )}

          {/* Play overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-gradient-to-t group-hover:from-black/30 group-hover:to-transparent transition-all duration-300 flex items-center justify-center">
            <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:scale-100 scale-90">
              <div className="bg-primary rounded-full p-4 shadow-2xl shadow-primary/50 ring-4 ring-primary/20">
                {isLocked ? (
                  <Lock className="w-7 h-7 text-primary-foreground" />
                ) : (
                  <Play className="w-7 h-7 text-primary-foreground fill-current" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content - Flex grow to fill remaining space */}
        <div className="p-3 flex flex-col flex-grow">
          <div className="space-y-1 flex-grow">
            <h3 className="font-semibold text-foreground text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
              {title}
            </h3>
            {/* Description with fixed height - always reserve space */}
            <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed min-h-[2rem]">
              {description || '\u00A0'}
            </p>
          </div>

          {/* Action Buttons - Fixed at bottom */}
          <div className="flex gap-2 pt-2 mt-auto">
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleWatch();
              }}
              className="flex-1 h-8 text-xs font-medium shadow-sm hover:shadow-md transition-shadow"
              size="sm"
            >
              {isLocked ? (
                <>
                  <Lock className="w-3.5 h-3.5 mr-1.5" />
                  {visibility === "paid" ? "Comprar" : "Fazer Upgrade"}
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                  Assistir
                </>
              )}
            </Button>
            <Button
              onClick={handleSave}
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={loading}
              title={isSaved ? "Remover dos salvos" : "Salvar"}
            >
              <Bookmark className={`w-3.5 h-3.5 ${isSaved ? "fill-current" : ""}`} />
            </Button>
            <Button
              onClick={handleFavorite}
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={loading}
              title={isFavorited ? "Remover dos favoritos" : "Favoritar"}
            >
              <Heart className={`w-3.5 h-3.5 ${isFavorited ? "fill-current text-red-500" : ""}`} />
            </Button>
          </div>
        </div>
      </Card>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        requiredPlan={requiredPlan}
      />

      <PurchaseModal
        open={showPurchaseModal}
        onOpenChange={setShowPurchaseModal}
        content={{
          id,
          title,
          thumbnail_url: thumbnail_url || "/placeholder.svg",
          price: price,
          creator_name: "",
        }}
      />
    </>
  );
};
