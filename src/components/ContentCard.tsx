import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, BookOpen, Lock, Crown, ShoppingCart, Zap } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CreatorLink } from "@/components/CreatorLink";
import { useIsMobile } from "@/hooks/use-mobile";

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
  const creatorId = content?.creator_id || content?.profiles?.id;
  const channelName = content?.profiles?.creator_channel_name;
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
  const location = useLocation();
  const isRestricted = !isFree || requiredPlan;
  const isPaid = visibility === "paid";
  const [isBoosted, setIsBoosted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();
  const isShort = (content?.content_type || contentType) === "short";
  const videoUrl = content?.file_url || content?.video_url;

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

  // Random autoplay for mobile shorts
  useEffect(() => {
    if (isShort && isMobile && videoUrl) {
      const randomDelay = Math.random() * 3000; // Random delay up to 3 seconds
      const timer = setTimeout(() => {
        setShouldAutoplay(true);
      }, randomDelay);
      return () => clearTimeout(timer);
    }
  }, [isShort, isMobile, videoUrl]);

  // Handle hover autoplay for desktop
  useEffect(() => {
    if (!isShort || !videoUrl || isMobile) return;

    if (isHovered && videoRef.current) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Ignore autoplay errors
        });
      }
    } else if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isHovered, isShort, videoUrl, isMobile]);

  // Handle mobile autoplay
  useEffect(() => {
    if (!isShort || !videoUrl || !isMobile || !shouldAutoplay) return;

    if (videoRef.current) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Ignore autoplay errors
        });
      }
    }
  }, [shouldAutoplay, isShort, videoUrl, isMobile]);

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

    // Always check content type first for proper navigation
    const actualContentType = content?.content_type || contentType;
    
    // Navigate to shorts feed starting with this short
    if (actualContentType === "short") {
      navigate(`/shorts/${id}`);
    } else if (onClick) {
      onClick();
    } else {
      navigate(`/watch/${id}`, isMobile ? { state: { backgroundLocation: location } } : undefined);
    }
  };

  return (
    <Card
      className="group cursor-pointer overflow-hidden bg-card/80 backdrop-blur-sm border border-border/30 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 rounded-lg"
      onClick={handleClick}
      onMouseEnter={() => isShort && !isMobile && setIsHovered(true)}
      onMouseLeave={() => isShort && !isMobile && setIsHovered(false)}
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
          className={`w-full h-full object-cover group-hover:scale-110 transition-transform duration-500 ease-out ${
            isShort && (isHovered || shouldAutoplay) ? "opacity-0" : "opacity-100"
          } transition-opacity duration-300`}
        />

        {/* Video autoplay for shorts */}
        {isShort && videoUrl && (
          <video
            ref={videoRef}
            src={videoUrl}
            className={`absolute inset-0 w-full h-full object-cover ${
              isHovered || shouldAutoplay ? "opacity-100" : "opacity-0"
            } transition-opacity duration-300`}
            muted
            loop
            playsInline
          />
        )}

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

        {/* Badges - Top Left (only boost badge now) */}
        <div className="absolute top-1.5 left-1.5 flex gap-1 flex-wrap max-w-[calc(100%-3rem)]">
          {isBoosted && (
            <Badge className="bg-primary/95 backdrop-blur-md text-primary-foreground font-semibold text-[9px] px-1.5 py-0.5 shadow-md flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5" />
              Anúncio
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
      <div className="p-2 sm:p-3 bg-card">
        {/* Creator info + Price/Button */}
        <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
          <CreatorLink
            creatorId={creatorId}
            creatorName={creatorName}
            creatorAvatar={creatorAvatar}
            channelName={channelName}
            avatarSize="sm"
            showName={true}
            className="flex-1 min-w-0"
          />

          {/* Price + Button (for paid content) */}
          {isPaid && !isPurchased && (
            <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
              <div className="text-right hidden sm:block">
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
                className="h-6 sm:h-7 px-2 sm:px-2.5 text-[9px] sm:text-[10px]"
                onClick={(e) => {
                  e.stopPropagation();
                  onPurchaseClick?.();
                }}
              >
                <ShoppingCart className="w-3 h-3 sm:mr-1" />
                <span className="hidden sm:inline">Comprar</span>
              </Button>
            </div>
          )}
        </div>

        {/* Title */}
        <h3
          className="font-semibold text-xs sm:text-sm leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors duration-300 mb-1.5 sm:mb-2"
          style={{ minHeight: "2rem" }}
        >
          {title}
        </h3>

        {/* Views + Tier/Price indicator */}
        <div className="pt-1 sm:pt-1.5 border-t border-border/30 flex items-center justify-between">
          <p className="text-[9px] sm:text-[10px] text-muted-foreground">{views.toLocaleString()} views</p>
          
          {/* Tier/Price indicator */}
          {isPaid && !isPurchased ? (
            <div className="flex items-center gap-1">
              {discount > 0 ? (
                <>
                  <span className="text-[9px] sm:text-[10px] font-bold text-primary">
                    R$ {(price * (1 - discount / 100)).toFixed(2)}
                  </span>
                  <span className="text-[8px] sm:text-[9px] line-through text-muted-foreground">
                    R$ {price.toFixed(2)}
                  </span>
                </>
              ) : (
                <span className="text-[9px] sm:text-[10px] font-bold text-foreground">
                  R$ {price?.toFixed(2)}
                </span>
              )}
            </div>
          ) : visibility === "premium" ? (
            <Crown className="w-3 h-3 text-red-500" fill="currentColor" />
          ) : visibility === "pro" ? (
            <Crown className="w-3 h-3 text-yellow-400" fill="currentColor" />
          ) : !isShort && visibility === "free" ? (
            <span className="text-[9px] sm:text-[10px] font-semibold text-green-500">FREE</span>
          ) : null}
        </div>
      </div>
    </Card>
  );
};
