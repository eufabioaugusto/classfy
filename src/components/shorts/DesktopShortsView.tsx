import { useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  MoreHorizontal,
  Send,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { FeaturedBadge } from "@/components/FeaturedBadge";
import { ShareViaDMModal } from "@/components/direct-messages/ShareViaDMModal";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface ShortContent {
  id: string;
  title: string;
  description: string | null;
  video_url: string | null;
  thumbnail_url: string;
  file_url: string | null;
  visibility: "free" | "pro" | "premium" | "paid";
  price: number;
  duration_seconds: number;
  views_count: number;
  likes_count: number;
  creator_id: string;
  creator: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    creator_channel_name: string | null;
  };
}

interface DesktopShortsViewProps {
  shorts: ShortContent[];
  currentIndex: number;
  hasAccess: boolean;
  isMuted: boolean;
  onToggleMute: () => void;
  isLiked: boolean;
  onLike: () => void;
  isSaved: boolean;
  onSave: () => void;
  isFollowing: boolean;
  onFollow: () => void;
  onShare: () => void;
  onPrevious: () => void;
  onNext: () => void;
  localLikesCount: number;
  commentsCount: number;
  onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  onAccessBlocked: () => void;
}

export function DesktopShortsView({
  shorts,
  currentIndex,
  hasAccess,
  isMuted,
  onToggleMute,
  isLiked,
  onLike,
  isSaved,
  onSave,
  isFollowing,
  onFollow,
  onShare,
  onPrevious,
  onNext,
  localLikesCount,
  commentsCount,
  onTimeUpdate,
  onAccessBlocked,
}: DesktopShortsViewProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [showDMModal, setShowDMModal] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideControlsTimeout = useRef<NodeJS.Timeout | null>(null);

  const currentShort = shorts[currentIndex];

  const formatCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  const togglePlayPause = useCallback(() => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [videoRef]);

  const handleMouseEnter = () => {
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    setShowControls(true);
  };

  const handleMouseLeave = () => {
    hideControlsTimeout.current = setTimeout(() => {
      setShowControls(false);
    }, 2000);
  };

  const navigateToCreator = () => {
    navigate(`/c/${currentShort.creator.creator_channel_name || currentShort.creator.id}`);
  };

  if (!currentShort) return null;

  return (
    <div className="flex items-center justify-center w-full h-full">
      {/* Main container - centered layout */}
      <div className="flex items-center gap-4 lg:gap-6">
        {/* Left side - Creator info panel */}
        <div className="hidden lg:flex flex-col items-end gap-4 w-[280px] pr-4">
          {/* Creator card */}
          <div className="w-full bg-card/50 backdrop-blur-sm rounded-xl p-4 border border-border/50">
            <div className="flex items-center gap-3 mb-3">
              <Avatar 
                className="w-11 h-11 cursor-pointer ring-2 ring-primary/20 hover:ring-primary/40 transition-all"
                onClick={navigateToCreator}
              >
                <AvatarImage src={currentShort.creator.avatar_url || ""} />
                <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                  {currentShort.creator.display_name[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p 
                  className="font-semibold text-sm text-foreground flex items-center gap-1 cursor-pointer hover:text-primary transition-colors"
                  onClick={navigateToCreator}
                >
                  @{currentShort.creator.creator_channel_name || currentShort.creator.display_name}
                  <FeaturedBadge creatorId={currentShort.creator.id} size="sm" />
                </p>
              </div>
            </div>
            
            <Button
              size="sm"
              onClick={onFollow}
              className={cn(
                "w-full h-9 text-sm font-medium transition-all",
                isFollowing 
                  ? "bg-secondary text-secondary-foreground hover:bg-secondary/80" 
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {isFollowing ? "Seguindo" : "Seguir"}
            </Button>
          </div>

          {/* Title and description */}
          <div className="w-full text-right">
            <h2 className="font-semibold text-base text-foreground mb-1 line-clamp-2">
              {currentShort.title}
            </h2>
            {currentShort.description && (
              <p className="text-sm text-muted-foreground line-clamp-3">
                {currentShort.description}
              </p>
            )}
          </div>
        </div>

        {/* Center - Video player */}
        <div 
          className="relative flex-shrink-0"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="relative w-[340px] md:w-[380px] aspect-[9/16] rounded-xl overflow-hidden bg-black shadow-2xl ring-1 ring-white/10">
            <video
              ref={videoRef}
              src={currentShort.video_url || currentShort.file_url || ""}
              className="w-full h-full object-cover"
              loop
              playsInline
              muted={isMuted}
              autoPlay
              onTimeUpdate={onTimeUpdate}
              onClick={togglePlayPause}
              poster={currentShort.thumbnail_url}
            />

            {/* Top controls bar - appears on hover */}
            {hasAccess && (
              <div 
                className={cn(
                  "absolute top-0 left-0 right-0 p-3 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300",
                  showControls ? "opacity-100" : "opacity-0"
                )}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={togglePlayPause}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors"
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4 text-white" fill="white" />
                    ) : (
                      <Play className="w-4 h-4 text-white ml-0.5" fill="white" />
                    )}
                  </button>
                  <button
                    onClick={onToggleMute}
                    className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors"
                  >
                    {isMuted ? (
                      <VolumeX className="w-4 h-4 text-white" />
                    ) : (
                      <Volume2 className="w-4 h-4 text-white" />
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm hover:bg-black/60 transition-colors">
                    <MoreHorizontal className="w-4 h-4 text-white" />
                  </button>
                </div>
              </div>
            )}

            {/* Access overlay */}
            {!hasAccess && (
              <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-20">
                <div className="text-center px-6">
                  <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Conteúdo Exclusivo</h3>
                  <p className="text-sm text-white/70 mb-5 max-w-[200px] mx-auto">
                    {currentShort.visibility === "paid"
                      ? `Adquira por R$ ${currentShort.price?.toFixed(2)}`
                      : `Assine o plano ${currentShort.visibility === "pro" ? "Pro" : "Premium"}`}
                  </p>
                  <Button 
                    onClick={onAccessBlocked}
                    className="px-6"
                  >
                    {currentShort.visibility === "paid" ? "Comprar" : "Assinar"}
                  </Button>
                </div>
              </div>
            )}

            {/* Mobile-style bottom info - only on smaller screens where left panel is hidden */}
            {hasAccess && (
              <div className="lg:hidden absolute left-3 bottom-3 right-3 z-10">
                <div className="flex items-center gap-2 mb-2">
                  <Avatar 
                    className="w-8 h-8 cursor-pointer ring-1 ring-white/30"
                    onClick={navigateToCreator}
                  >
                    <AvatarImage src={currentShort.creator.avatar_url || ""} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {currentShort.creator.display_name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-white font-medium text-sm flex items-center gap-1">
                    @{currentShort.creator.creator_channel_name || currentShort.creator.display_name}
                    <FeaturedBadge creatorId={currentShort.creator.id} size="sm" className="text-primary" />
                  </span>
                  <Button
                    size="sm"
                    onClick={onFollow}
                    variant={isFollowing ? "secondary" : "default"}
                    className="h-7 px-3 text-xs ml-auto"
                  >
                    {isFollowing ? "Seguindo" : "Seguir"}
                  </Button>
                </div>
                <h2 className="font-medium text-white text-sm line-clamp-2 drop-shadow-lg">
                  {currentShort.title}
                </h2>
              </div>
            )}
          </div>
        </div>

        {/* Right side - Action buttons */}
        {hasAccess && (
          <div className="flex flex-col items-center gap-4">
            {/* Like */}
            <ActionButton
              icon={Heart}
              label={formatCount(localLikesCount)}
              onClick={onLike}
              isActive={isLiked}
              activeClassName="fill-red-500 text-red-500"
            />

            {/* Comment */}
            <ActionButton
              icon={MessageCircle}
              label={formatCount(commentsCount)}
              onClick={() => {}}
            />

            {/* Send via DM */}
            {user && (
              <ActionButton
                icon={Send}
                onClick={() => setShowDMModal(true)}
              />
            )}

            {/* Share */}
            <ActionButton
              icon={Share2}
              onClick={onShare}
            />

            {/* Save */}
            <ActionButton
              icon={Bookmark}
              onClick={onSave}
              isActive={isSaved}
              activeClassName="fill-foreground"
            />

            {/* Mute toggle - smaller, subtle */}
            <button
              onClick={onToggleMute}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-muted/80 hover:bg-muted transition-colors mt-2"
            >
              {isMuted ? (
                <VolumeX className="w-5 h-5 text-muted-foreground" />
              ) : (
                <Volume2 className="w-5 h-5 text-muted-foreground" />
              )}
            </button>
          </div>
        )}

        {/* Far right - Navigation arrows */}
        <div className="flex flex-col items-center gap-3 ml-4 lg:ml-8">
          <button
            onClick={onPrevious}
            disabled={currentIndex === 0}
            className={cn(
              "w-12 h-12 flex items-center justify-center rounded-full transition-all",
              currentIndex === 0
                ? "bg-muted/30 text-muted-foreground/30 cursor-not-allowed"
                : "bg-muted hover:bg-muted/80 text-foreground"
            )}
          >
            <ChevronUp className="w-6 h-6" />
          </button>
          <button
            onClick={onNext}
            disabled={currentIndex === shorts.length - 1}
            className={cn(
              "w-12 h-12 flex items-center justify-center rounded-full transition-all",
              currentIndex === shorts.length - 1
                ? "bg-muted/30 text-muted-foreground/30 cursor-not-allowed"
                : "bg-muted hover:bg-muted/80 text-foreground"
            )}
          >
            <ChevronDown className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* DM Share Modal */}
      <ShareViaDMModal
        open={showDMModal}
        onClose={() => setShowDMModal(false)}
        contentId={currentShort.id}
        contentTitle={currentShort.title}
        contentThumbnail={currentShort.thumbnail_url}
        creatorName={currentShort.creator.display_name}
      />
    </div>
  );
}

// Reusable action button component
interface ActionButtonProps {
  icon: React.ComponentType<{ className?: string }>;
  label?: string;
  onClick: () => void;
  isActive?: boolean;
  activeClassName?: string;
}

function ActionButton({ 
  icon: Icon, 
  label, 
  onClick, 
  isActive = false, 
  activeClassName = "" 
}: ActionButtonProps) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 group">
      <div className="w-12 h-12 flex items-center justify-center rounded-full bg-muted/80 group-hover:bg-muted transition-colors">
        <Icon 
          className={cn(
            "w-6 h-6 transition-colors",
            isActive ? activeClassName : "text-foreground"
          )} 
        />
      </div>
      {label && (
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
    </button>
  );
}
