import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, BookOpen, Lock, Crown, ShoppingCart, Zap, Sparkles } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CreatorLink } from "@/components/CreatorLink";
import { FeaturedBadge } from "@/components/FeaturedBadge";
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
  isBoosted?: boolean;
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
  isBoosted: propIsBoosted,
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
  const [isBoosted, setIsBoosted] = useState(propIsBoosted ?? false);
  const [isHovered, setIsHovered] = useState(false);
  const [shouldAutoplay, setShouldAutoplay] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isMobile = useIsMobile();
  const isShort = (content?.content_type || contentType) === "short";
  const videoUrl = content?.file_url || content?.video_url;
  const hasVideo = !!videoUrl;

  // Only allow hover preview for content the user can access (free or matching plan/purchased)
  const canPreview = useMemo(() => {
    if (visibility === "free") return true;
    if (visibility === "paid") return isPurchased;
    if (visibility === "pro") return ["pro", "premium"].includes(userPlan);
    if (visibility === "premium") return userPlan === "premium";
    return true;
  }, [visibility, isPurchased, userPlan]);
  const hasPreviewableVideo = hasVideo && canPreview;
  const publishedAt = content?.published_at || content?.created_at;

  // Check if content is new (published within last 48 hours)
  const isNew = useMemo(() => {
    if (!publishedAt) return false;
    const publishDate = new Date(publishedAt);
    const now = new Date();
    const diffHours = (now.getTime() - publishDate.getTime()) / (1000 * 60 * 60);
    return diffHours <= 48;
  }, [publishedAt]);

  // Only fetch boost status if not provided as prop
  useEffect(() => {
    if (propIsBoosted !== undefined || !id) return;
    const checkBoost = async () => {
      const { data, error } = await supabase.rpc("is_content_boosted", { p_content_id: id });
      if (!error && data) setIsBoosted(data);
    };
    checkBoost();
  }, [id, propIsBoosted]);

  // Random autoplay for mobile shorts
  useEffect(() => {
    if (isShort && isMobile && videoUrl && canPreview) {
      const randomDelay = Math.random() * 3000;
      const timer = setTimeout(() => setShouldAutoplay(true), randomDelay);
      return () => clearTimeout(timer);
    }
  }, [isShort, isMobile, videoUrl]);

  // Handle hover autoplay for desktop (only if user has access)
  useEffect(() => {
    if (!hasPreviewableVideo || isMobile) return;
    if (isHovered && videoRef.current) {
      videoRef.current.currentTime = 0;
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) playPromise.catch(() => {});
    } else if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isHovered, hasPreviewableVideo, isMobile]);

  // Handle mobile autoplay (shorts only)
  useEffect(() => {
    if (!isShort || !videoUrl || !isMobile || !shouldAutoplay) return;
    if (videoRef.current) {
      const playPromise = videoRef.current.play();
      if (playPromise !== undefined) playPromise.catch(() => {});
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
    // Allow visitors to view free content without login (for conversion)
    // Views/rewards will only count after they sign up
    if (visibility === "free") {
      return true;
    }

    // For restricted content, user must be logged in
    if (!userPlan || userPlan === "free") {
      return false;
    }

    // Check if content is paid and user has purchased it
    if (visibility === "paid") {
      return isPurchased;
    }

    // Check plan-based access
    if (visibility === "pro") {
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
    <div
      className="group cursor-pointer flex flex-col"
      onClick={handleClick}
      onMouseEnter={() => !isMobile && setIsHovered(true)}
      onMouseLeave={() => !isMobile && setIsHovered(false)}
    >
      {/* Thumbnail with dynamic aspect ratio - 12px radius like YouTube */}
      <div
        className={`relative overflow-hidden bg-muted rounded-[12px] ${
          aspectRatio === "square" ? "aspect-square" : aspectRatio === "vertical" ? "aspect-[9/16]" : "aspect-[16/9]"
        }`}
      >
        <img
          src={thumbnail}
          alt={title}
          className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${
            hasVideo && (isHovered || shouldAutoplay) ? "opacity-0" : "opacity-100"
          } transition-opacity duration-300`}
        />

        {/* Video hover preview for all types */}
        {hasVideo && (
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

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all duration-300" />

        {/* Boost badge - Top Left */}
        {isBoosted && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-primary/95 backdrop-blur-md text-primary-foreground font-semibold text-[10px] px-2 py-0.5 shadow-md flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Anúncio
            </Badge>
          </div>
        )}

        {/* NEW badge - Top Left (below boost if both present) */}
        {isNew && !isBoosted && (
          <div className="absolute top-2 left-2">
            <Badge className="bg-accent/95 backdrop-blur-md text-accent-foreground font-bold text-[10px] px-2 py-0.5 shadow-md flex items-center gap-1">
              <Sparkles className="w-3 h-3" />
              NOVO
            </Badge>
          </div>
        )}

        {/* Tier badge - Top Right */}
        {visibility === "premium" && !isPurchased && (
          <div className="absolute top-2 right-2">
            <Crown className="w-5 h-5 text-red-500 drop-shadow-md" fill="currentColor" />
          </div>
        )}
        {visibility === "pro" && !isPurchased && (
          <div className="absolute top-2 right-2">
            <Crown className="w-5 h-5 text-yellow-400 drop-shadow-md" fill="currentColor" />
          </div>
        )}

        {/* Duration/Lessons - Bottom Right */}
        <div className="absolute bottom-2 right-2 flex gap-1">
          {duration && (
            <Badge
              variant="secondary"
              className="bg-black/80 text-white border-0 text-[11px] font-medium px-1.5 py-0.5"
            >
              {duration}min
            </Badge>
          )}
          {lessonCount && (
            <Badge
              variant="secondary"
              className="bg-black/80 text-white border-0 text-[11px] font-medium px-1.5 py-0.5"
            >
              {lessonCount} aulas
            </Badge>
          )}
        </div>
      </div>

      {/* Content Info - YouTube style */}
      <div className="flex gap-3 pt-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <CreatorLink
            creatorId={creatorId}
            creatorName={creatorName}
            creatorAvatar={creatorAvatar}
            channelName={channelName}
            avatarSize="md"
            showName={false}
          />
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Title row with optional buy button */}
          <div className="flex items-start gap-2">
            <h3 className="flex-1 font-medium text-sm sm:text-base leading-snug line-clamp-2 text-foreground group-hover:text-primary transition-colors">
              {title}
            </h3>
            
            {/* Buy button + price for paid content */}
            {isPaid && !isPurchased && (
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                <Button
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPurchaseClick?.();
                  }}
                >
                  <ShoppingCart className="w-3.5 h-3.5 mr-1.5" />
                  Comprar
                </Button>
                <span className="text-[10px] sm:text-[11px] font-semibold text-foreground">
                  {discount > 0 ? (
                    <>
                      <span className="text-primary">R$ {(price * (1 - discount / 100)).toFixed(2)}</span>
                      <span className="ml-1 line-through text-muted-foreground text-[9px]">
                        R$ {price.toFixed(2)}
                      </span>
                    </>
                  ) : (
                    `R$ ${price?.toFixed(2)}`
                  )}
                </span>
              </div>
            )}
          </div>

          {/* Creator name */}
          <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 truncate flex items-center gap-1">
            {creatorName}
            <FeaturedBadge creatorId={creatorId} size="xs" />
          </p>

          {/* Views */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] sm:text-xs text-muted-foreground">
              {views.toLocaleString()} views
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
