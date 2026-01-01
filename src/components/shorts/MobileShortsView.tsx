import { useRef, useState, useEffect } from "react";
import { Heart, MessageCircle, Share2, Bookmark, Volume2, VolumeX, Home, Search, Target, Gift } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useUnreadMessages } from "@/hooks/useUnreadMessages";

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

interface MobileShortsViewProps {
  shorts: ShortContent[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
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
  localLikesCount: number;
  commentsCount: number;
  onTimeUpdate: (e: React.SyntheticEvent<HTMLVideoElement>) => void;
  onAccessBlocked: () => void;
}

export function MobileShortsView({
  shorts,
  currentIndex,
  onIndexChange,
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
  localLikesCount,
  commentsCount,
  onTimeUpdate,
  onAccessBlocked,
}: MobileShortsViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const currentShort = shorts[currentIndex];

  // Nav height constant (64px nav + 16px safe area buffer)
  const NAV_HEIGHT = 80;

  // Handle snap scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getItemHeight = () => window.innerHeight - NAV_HEIGHT;

    const handleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      setIsScrolling(true);
      
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
        const scrollTop = container.scrollTop;
        const itemHeight = getItemHeight();
        const newIndex = Math.round(scrollTop / itemHeight);
        
        if (newIndex !== currentIndex && newIndex >= 0 && newIndex < shorts.length) {
          onIndexChange(newIndex);
        }
      }, 100);
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [currentIndex, shorts.length, onIndexChange]);

  // Play/pause videos based on current index
  useEffect(() => {
    videoRefs.current.forEach((video, idx) => {
      if (!video) return;
      if (idx === currentIndex && hasAccess) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
  }, [currentIndex, hasAccess]);

  // Scroll to index when it changes externally
  useEffect(() => {
    const container = containerRef.current;
    if (container && !isScrolling) {
      const itemHeight = window.innerHeight - NAV_HEIGHT;
      container.scrollTo({
        top: currentIndex * itemHeight,
        behavior: "smooth",
      });
    }
  }, [currentIndex]);

  const formatCount = (count: number) => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  };

  return (
    <div className="fixed inset-x-0 top-0 bg-black z-40" style={{ height: `calc(100dvh - ${NAV_HEIGHT}px)` }}>
      {/* Scrollable container with snap - height accounts for bottom nav */}
      <div
        ref={containerRef}
        className="w-full h-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide"
        style={{ scrollSnapType: "y mandatory" }}
      >
        {shorts.map((short, index) => (
          <div
            key={short.id}
            className="w-full snap-start snap-always relative"
            style={{ 
              scrollSnapAlign: "start",
              height: `calc(100dvh - ${NAV_HEIGHT}px)`
            }}
          >
            {/* Video */}
            <video
              ref={(el) => (videoRefs.current[index] = el)}
              src={short.video_url || short.file_url || ""}
              className="absolute inset-0 w-full h-full object-cover"
              loop
              playsInline
              muted={isMuted}
              onTimeUpdate={index === currentIndex ? onTimeUpdate : undefined}
              onClick={() => {
                const video = videoRefs.current[index];
                if (video) {
                  if (video.paused) {
                    video.play();
                  } else {
                    video.pause();
                  }
                }
              }}
              poster={short.thumbnail_url}
            />

            {/* Access overlay */}
            {index === currentIndex && !hasAccess && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-20">
                <div className="text-center px-6">
                  <h3 className="text-xl font-bold text-white mb-2">Conteúdo Bloqueado</h3>
                  <p className="text-gray-300 mb-4">
                    {short.visibility === "paid"
                      ? `Este short custa R$ ${short.price?.toFixed(2)}`
                      : `Assine o plano ${short.visibility === "pro" ? "Pro" : "Premium"} para acessar`}
                  </p>
                  <Button onClick={onAccessBlocked}>
                    {short.visibility === "paid" ? "Comprar Agora" : "Assinar"}
                  </Button>
                </div>
              </div>
            )}

            {/* Gradient overlay for better text readability */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none" />

            {/* Right side actions - centered vertically with tight spacing */}
            {index === currentIndex && hasAccess && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 z-10">
                {/* Like */}
                <button onClick={onLike} className="flex flex-col items-center">
                  <Heart
                    className={`w-7 h-7 ${isLiked ? "fill-red-500 text-red-500" : "text-white"}`}
                    style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                  />
                  <span className="text-[10px] font-medium text-white drop-shadow-lg mt-0.5">
                    {formatCount(localLikesCount)}
                  </span>
                </button>

                {/* Comment */}
                <button className="flex flex-col items-center">
                  <MessageCircle
                    className="w-7 h-7 text-white"
                    style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                  />
                  <span className="text-[10px] font-medium text-white drop-shadow-lg mt-0.5">
                    {formatCount(commentsCount)}
                  </span>
                </button>

                {/* Share */}
                <button onClick={onShare} className="flex flex-col items-center">
                  <Share2
                    className="w-7 h-7 text-white"
                    style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                  />
                </button>

                {/* Save */}
                <button onClick={onSave} className="flex flex-col items-center">
                  <Bookmark
                    className={`w-7 h-7 ${isSaved ? "fill-white text-white" : "text-white"}`}
                    style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                  />
                </button>

                {/* Mute */}
                <button onClick={onToggleMute} className="flex flex-col items-center">
                  {isMuted ? (
                    <VolumeX
                      className="w-6 h-6 text-white"
                      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    />
                  ) : (
                    <Volume2
                      className="w-6 h-6 text-white"
                      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    />
                  )}
                </button>

                {/* Creator avatar */}
                <div 
                  className="mt-1 cursor-pointer"
                  onClick={() => window.location.href = `/c/${short.creator.creator_channel_name || short.creator.id}`}
                >
                  <Avatar className="w-10 h-10 border-2 border-white">
                    <AvatarImage src={short.creator.avatar_url || ""} />
                    <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                      {short.creator.display_name[0]}
                    </AvatarFallback>
                  </Avatar>
                </div>
              </div>
            )}

            {/* Bottom info - positioned 20px from bottom of video area */}
            {index === currentIndex && hasAccess && (
              <div className="absolute left-4 right-20 z-10" style={{ bottom: '20px' }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-white font-semibold text-sm drop-shadow-lg">
                    @{short.creator.creator_channel_name || short.creator.display_name}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onFollow}
                    className={`h-7 px-3 text-xs ${
                      isFollowing
                        ? "bg-muted/30 backdrop-blur-sm border-white/30 text-white"
                        : "bg-white text-black border-white hover:bg-white/90"
                    }`}
                  >
                    {isFollowing ? "Seguindo" : "Seguir"}
                  </Button>
                </div>

                <h2 className="font-semibold text-white text-sm drop-shadow-lg line-clamp-2 mb-1">
                  {short.title}
                </h2>
                {short.description && (
                  <p className="text-xs text-white/80 drop-shadow-lg line-clamp-1">
                    {short.description}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bottom nav - reuse MobileBottomNav styled for shorts */}
      <ShortsBottomNav />
    </div>
  );
}

// Bottom nav styled for shorts (dark theme, always visible)
function ShortsBottomNav() {
  const { user } = useAuth();
  const unreadCount = useUnreadMessages();

  const navigate = (path: string) => {
    window.location.href = path;
  };

  const openSearch = () => {
    window.dispatchEvent(new CustomEvent('open-global-search'));
  };

  const navItems = [
    { icon: Home, label: "Explorar", action: () => navigate("/?mode=explore") },
    { icon: Search, label: "Buscar", action: openSearch },
    { icon: Target, label: "Estudo", action: () => navigate(user ? "/?mode=focus" : "/auth"), isCenter: true },
    { icon: MessageCircle, label: "Mensagens", action: () => navigate(user ? "/messages" : "/auth"), showBadge: true },
    { icon: Gift, label: "Recompensas", action: () => navigate(user ? "/recompensas" : "/auth") },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-t border-white/10 pb-safe">
      <div className="flex items-stretch h-16">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const showBadge = item.showBadge && unreadCount > 0;

          if (item.isCenter) {
            return (
              <button
                key={item.label}
                onClick={item.action}
                className="relative flex-1 basis-0 flex flex-col items-center justify-center -mt-2"
              >
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-all duration-200 active:scale-95">
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-[9px] mt-0.5 font-medium text-white/60">
                  {item.label}
                </span>
              </button>
            );
          }

          return (
            <button
              key={item.label}
              onClick={item.action}
              className="relative flex-1 basis-0 flex flex-col items-center justify-center gap-0.5 py-2 transition-all duration-200 active:scale-95 text-white/60 hover:text-white"
            >
              <div className="relative">
                <Icon className="w-5 h-5" />
                {showBadge && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-[16px] px-0.5 text-[9px] font-bold bg-destructive text-destructive-foreground rounded-full">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </div>
              <span className="text-[9px] font-medium truncate max-w-full px-1">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}