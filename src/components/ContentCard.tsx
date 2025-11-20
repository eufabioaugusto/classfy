import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, BookOpen, Lock, Crown, ShoppingCart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";

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
  const isFree = propIsFree !== undefined ? propIsFree : content?.is_free ?? true;
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

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/watch/${id}`);
    }
  };

  return (
    <Card
      className="group cursor-pointer overflow-hidden bg-card/80 backdrop-blur-sm border border-border/30 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 rounded-lg"
      onClick={handleClick}
    >
      {/* Thumbnail with dynamic aspect ratio */}
      <div className={`relative overflow-hidden bg-muted ${
        aspectRatio === "square" ? "aspect-square" :
        aspectRatio === "vertical" ? "aspect-[9/16]" :
        "aspect-[16/9]"
      }`}>
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
              className={`w-5 h-5 drop-shadow-lg ${
                visibility === "pro" ? "text-yellow-400" : "text-red-500"
              }`}
              fill="currentColor"
            />
          </div>
        )}

        {/* Badges - Top Left */}
        <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap max-w-[calc(100%-3rem)]">
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
            <Badge className={`${getPlanBadgeColor(requiredPlan)} backdrop-blur-md text-white font-semibold uppercase text-[9px] px-1.5 py-0.5 shadow-md`}>
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
            <Badge variant="secondary" className="bg-black/90 backdrop-blur-md text-white border-0 text-[9px] font-medium px-1.5 py-0.5 shadow-lg">
              <Clock className="w-2.5 h-2.5 mr-0.5" />
              {duration}min
            </Badge>
          )}
          {lessonCount && (
            <Badge variant="secondary" className="bg-black/90 backdrop-blur-md text-white border-0 text-[9px] font-medium px-1.5 py-0.5 shadow-lg">
              <BookOpen className="w-2.5 h-2.5 mr-0.5" />
              {lessonCount}
            </Badge>
          )}
        </div>
      </div>

      {/* Content Info */}
      <div className="p-2 space-y-1.5 bg-card">
        {/* Creator info */}
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-full bg-muted overflow-hidden ring-1 ring-border/50">
            {creatorAvatar ? (
              <img src={creatorAvatar} alt={creatorName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-primary text-primary-foreground font-bold text-[10px]">
                {creatorName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-medium text-foreground truncate">{creatorName}</p>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-xs leading-tight line-clamp-2 text-foreground group-hover:text-primary transition-colors duration-300">
          {title}
        </h3>

        {/* Price & Actions */}
        {isPaid && (
          <div className="pt-1.5 border-t border-border/30 space-y-1.5">
            <div className="flex items-center justify-between">
              <div>
                {discount > 0 ? (
                  <div className="flex items-baseline gap-1">
                    <span className="text-xs font-bold text-primary">
                      R$ {(price * (1 - discount / 100)).toFixed(2)}
                    </span>
                    <span className="text-[9px] line-through text-muted-foreground">
                      R$ {price.toFixed(2)}
                    </span>
                  </div>
                ) : (
                  <span className="text-xs font-bold">R$ {price.toFixed(2)}</span>
                )}
              </div>
            </div>
            {!isPurchased && (
              <Button 
                size="sm" 
                className="w-full h-7 text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onPurchaseClick?.();
                }}
              >
                <ShoppingCart className="w-3 h-3 mr-1" />
                Comprar
              </Button>
            )}
          </div>
        )}

        {!isPaid && (
          <div className="flex items-center justify-between pt-1 border-t border-border/30">
            <p className="text-[9px] text-muted-foreground">
              {views.toLocaleString()} views
            </p>
          </div>
        )}
      </div>
    </Card>
  );
};