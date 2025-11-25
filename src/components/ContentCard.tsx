import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, BookOpen, Lock, Crown, ShoppingCart, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

interface ContentCardProps {
  id?: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  creatorName?: string;
  creatorAvatar?: string;
  duration?: number;
  lessonCount?: number;
  isFree?: boolean;
  price?: number;
  requiredPlan?: "free" | "pro" | "premium";
  views?: number;
  contentType?: "video" | "course";
  content?: any;
  onClick?: () => void;
  visibility?: "free" | "pro" | "premium" | "paid";
  discount?: number;
  isPurchased?: boolean;
  onPurchaseClick?: () => void;
  aspectRatio?: "default" | "square" | "vertical";
  userPlan?: "free" | "pro" | "premium";
  onUpgradeClick?: (plan: "pro" | "premium") => void;
}

export const ContentCard = ({
  id: propId,
  title: propTitle,
  description: propDescription,
  thumbnail: propThumbnail,
  creatorName: propCreatorName,
  creatorAvatar: propCreatorAvatar,
  duration: propDuration,
  lessonCount: propLessonCount,
  isFree: propIsFree,
  price: propPrice,
  requiredPlan: propRequiredPlan,
  views: propViews,
  contentType: propContentType,
  content,
  onClick,
  visibility: propVisibility,
  discount: propDiscount,
  isPurchased: propIsPurchased,
  onPurchaseClick,
  aspectRatio = "default",
  userPlan = "free",
  onUpgradeClick,
}: ContentCardProps) => {
  // Support both formats: direct props or content object
  const id = propId || content?.id;
  const title = propTitle || content?.title;
  const description = propDescription || content?.description;
  const thumbnail = propThumbnail || content?.thumbnail_url || "/placeholder.svg";
  const creatorName = propCreatorName || content?.profiles?.display_name || "Creator";
  const creatorAvatar = propCreatorAvatar || content?.profiles?.avatar_url;
  const duration = propDuration || content?.duration_minutes;
  const lessonCount = propLessonCount || content?.lesson_count;
  const isFree = propIsFree !== undefined ? propIsFree : (content?.is_free ?? true);
  const price = propPrice || content?.price;
  const requiredPlan = propRequiredPlan || content?.required_plan;
  const views = propViews || content?.views_count || 0;
  const contentType = propContentType || content?.content_type || "video";
  const visibility = propVisibility || content?.visibility || "free";
  const discount = propDiscount !== undefined ? propDiscount : content?.discount || 0;
  const isPurchased = propIsPurchased !== undefined ? propIsPurchased : false;
  const navigate = useNavigate();
  const isRestricted = !isFree || requiredPlan;
  const isPaid = visibility === "paid";
  const [isBoosted, setIsBoosted] = useState(false);

  useEffect(() => {
    const checkBoost = async () => {
      if (!id) return;

      const { data, error } = await supabase.rpc("is_content_boosted", { p_content_id: id });

      if (!error && data) {
        setIsBoosted(data);
      }
    };

    checkBoost();
  }, [id]);

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

  const checkAccess = () => {
    // Check if content is paid and user has purchased it
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

  const handleClick = () => {
    const hasAccess = checkAccess();

    if (!hasAccess) {
      // Block navigation and show appropriate modal
      if (visibility === "paid") {
        onPurchaseClick?.();
      } else if (visibility === "pro" || visibility === "premium") {
        onUpgradeClick?.(visibility);
      }
      return;
    }

    // Only navigate if user has access
    if (onClick) {
      onClick();
    } else {
      // Redirect to appropriate page based on content type
      const actualContentType = content?.content_type || contentType;
      if (actualContentType === "short") {
        navigate(`/shorts/${id}`);
      } else {
        navigate(`/watch/${id}`);
      }
    }
  };

  return (
    <Card
      className="group cursor-pointer overflow-hidden bg-card/80 backdrop-blur-sm border border-border/30 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 rounded-lg"
      onClick={handleClick}
    >
      {/* Thumbnail with dynamic aspect ratio */}
      <div
        className={`relative overflow-hidden bg-muted ${
          aspectRatio === "square" ? "aspect-square" : aspectRatio === "vertical" ? "aspect-[9/16]" : "aspect-[16/9]"
        }`}
      >
        <img
          src={thumbnail}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out"
        />

        {/* Play button overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-gradient-to-t group-hover:from-black/30 group-hover:to-transparent flex items-center justify-center transition-all duration-300">
          <div className="opacity-0 group-hover:opacity-100 transition-all duration-300 transform group-hover:scale-100 scale-90">
            <div className="bg-primary rounded-full p-2.5 shadow-2xl shadow-primary/50 ring-2 ring-primary/20">
              {isRestricted ? (
                <Lock className="w-5 h-5 text-primary-foreground" />
              ) : (
                <Play className="w-5 h-5 text-primary-foreground fill-current" />
              )}
            </div>
          </div>
        </div>

        {/* Plan Badge - Top Right */}
        {(visibility === "pro" || visibility === "premium") && (
          <div className="absolute top-1.5 right-1.5">
            <Crown
              className={`w-3 h-3 drop-shadow-lg ${visibility === "pro" ? "text-yellow-400" : "text-red-500"}`}
              fill="currentColor"
            />
          </div>
        )}

        {/* Badges - Top Left */}
        <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap max-w-[calc(100%-3rem)]">
          {isBoosted && (
            <Badge className="bg-primary/95 backdrop-blur-md text-primary-foreground font-semibold text-[9px] px-1.5 py-0.5 shadow-md flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5" />
              Anúncio
            </Badge>
          )}
          {isPaid && (
            <>
              <Badge className="bg-badge-hot/95 backdrop-blur-md text-white font-semibold text-[9px] px-1.5 py-0.5 shadow-md">
                Pago
              </Badge>
              {discount > 0 && (
                <Badge className="bg-green-600/95 backdrop-blur-md text-white font-semibold text-[9px] px-1.5 py-0.5 shadow-md">
                  -{discount}%
                </Badge>
              )}
            </>
          )}
          {!isPaid && requiredPlan && requiredPlan !== "free" && (
            <Badge
              className={`${getPlanBadgeColor(requiredPlan)} backdrop-blur-md text-white font-semibold uppercase text-[9px] px-1.5 py-0.5 shadow-md`}
            >
              {requiredPlan}
            </Badge>
          )}
          {visibility === "free" && !requiredPlan && (
            <Badge className="bg-badge-free/95 backdrop-blur-md text-white font-semibold text-[9px] px-1.5 py-0.5 shadow-md">
              FREE
            </Badge>
          )}
        </div>

        {/* Duration/Lessons - Bottom Right */}
        <div className="absolute bottom-1.5 right-1.5 flex gap-1">
          {duration && (
            <Badge
              variant="secondary"
              className="bg-black/90 backdrop-blur-md text-white border-0 text-[9px] font-medium px-1.5 py-0.5 shadow-lg"
            >
              <Clock className="w-2.5 h-2.5 mr-0.5" />
              {duration}min
            </Badge>
          )}
          {lessonCount && (
            <Badge
              variant="secondary"
              className="bg-black/90 backdrop-blur-md text-white border-0 text-[9px] font-medium px-1.5 py-0.5 shadow-lg"
            >
              <BookOpen className="w-2.5 h-2.5 mr-0.5" />
              {lessonCount}
            </Badge>
          )}
        </div>
      </div>

      {/* Content Info */}
      <div className="p-3 bg-card">
        {/* Creator info + Price/Button */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-muted overflow-hidden ring-1 ring-border/50 flex-shrink-0">
            {creatorAvatar ? (
              <img src={creatorAvatar} alt={creatorName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary text-primary-foreground font-bold text-[10px]">
                {creatorName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground truncate">{creatorName}</p>
          </div>

          {/* Price + Button (for paid content) */}
          {isPaid && !isPurchased && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="text-right">
                {discount > 0 ? (
                  <div className="flex flex-col items-end">
                    <span className="text-[11px] font-bold text-primary leading-tight">
                      R$ {(price * (1 - discount / 100)).toFixed(2)}
                    </span>
                    <span className="text-[9px] line-through text-muted-foreground leading-tight">
                      R$ {price.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] font-bold">R$ {price.toFixed(2)}</span>
                )}
              </div>
              <Button
                size="sm"
                className="h-7 px-2.5 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onPurchaseClick?.();
                }}
              >
                <ShoppingCart className="w-3 h-3 mr-1" />
                Comprar
              </Button>
            </div>
          )}
        </div>

        {/* Title */}
        <h3
          className="font-semibold text-sm leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors duration-300 mb-2"
          style={{ minHeight: "2.5rem" }}
        >
          {title}
        </h3>

        {/* Views - Always show */}
        <div className="pt-1.5 border-t border-border/30">
          <p className="text-[10px] text-muted-foreground">{views.toLocaleString()} views</p>
        </div>
      </div>
    </Card>
  );
};
