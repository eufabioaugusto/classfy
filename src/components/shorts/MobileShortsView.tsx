import { useRef, useState, useEffect } from "react";
import { Heart, MessageCircle, Share2, Bookmark, Volume2, VolumeX } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MobileBottomNav } from "@/components/MobileBottomNav";

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

  // Handle snap scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      
      setIsScrolling(true);
      
      scrollTimeoutRef.current = setTimeout(() => {
        setIsScrolling(false);
        const scrollTop = container.scrollTop;
        const itemHeight = window.innerHeight;
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
      container.scrollTo({
        top: currentIndex * window.innerHeight,
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
    <div className="fixed inset-0 bg-black z-40">
      {/* Scrollable container with snap */}
      <div
        ref={containerRef}
        className="h-full w-full overflow-y-scroll snap-y snap-mandatory scrollbar-hide"
        style={{ scrollSnapType: "y mandatory" }}
      >
        {shorts.map((short, index) => (
          <div
            key={short.id}
            className="h-screen w-full snap-start snap-always relative"
            style={{ scrollSnapAlign: "start" }}
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

            {/* Right side actions - YouTube style */}
            {index === currentIndex && hasAccess && (
              <div className="absolute right-3 bottom-32 flex flex-col items-center gap-5 z-10">
                {/* Like */}
                <button onClick={onLike} className="flex flex-col items-center gap-1">
                  <div className="p-2">
                    <Heart
                      className={`w-7 h-7 ${isLiked ? "fill-red-500 text-red-500" : "text-white"}`}
                      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    />
                  </div>
                  <span className="text-xs font-medium text-white drop-shadow-lg">
                    {formatCount(localLikesCount)}
                  </span>
                </button>

                {/* Comment */}
                <button className="flex flex-col items-center gap-1">
                  <div className="p-2">
                    <MessageCircle
                      className="w-7 h-7 text-white"
                      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    />
                  </div>
                  <span className="text-xs font-medium text-white drop-shadow-lg">
                    {formatCount(commentsCount)}
                  </span>
                </button>

                {/* Share */}
                <button onClick={onShare} className="flex flex-col items-center gap-1">
                  <div className="p-2">
                    <Share2
                      className="w-7 h-7 text-white"
                      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    />
                  </div>
                </button>

                {/* Save */}
                <button onClick={onSave} className="flex flex-col items-center gap-1">
                  <div className="p-2">
                    <Bookmark
                      className={`w-7 h-7 ${isSaved ? "fill-white text-white" : "text-white"}`}
                      style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.5))" }}
                    />
                  </div>
                </button>

                {/* Mute */}
                <button onClick={onToggleMute} className="flex flex-col items-center gap-1">
                  <div className="p-2">
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
                  </div>
                </button>

                {/* Creator avatar */}
                <div 
                  className="mt-2 cursor-pointer"
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

            {/* Bottom info - YouTube style */}
            {index === currentIndex && hasAccess && (
              <div className="absolute left-4 bottom-24 right-20 z-10">
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

      {/* Bottom nav - always visible on shorts */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-t border-white/10 pb-safe">
        <MobileBottomNavForShorts />
      </div>
    </div>
  );
}

// Custom bottom nav for shorts (always visible)
function MobileBottomNavForShorts() {
  const navigate = (path: string) => {
    window.location.href = path;
  };

  return (
    <nav className="flex items-stretch h-14">
      <button
        onClick={() => navigate("/?mode=explore")}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white/60 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
        <span className="text-[9px] font-medium">Explorar</span>
      </button>

      <button
        onClick={() => navigate("/search")}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white/60 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-[9px] font-medium">Buscar</span>
      </button>

      <button
        onClick={() => navigate("/?mode=focus")}
        className="flex-1 flex flex-col items-center justify-center -mt-2"
      >
        <div className="flex items-center justify-center w-11 h-11 rounded-full bg-primary text-primary-foreground shadow-lg">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
        </div>
        <span className="text-[9px] mt-0.5 font-medium text-white/60">Estudo</span>
      </button>

      <button
        onClick={() => navigate("/messages")}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white/60 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
        <span className="text-[9px] font-medium">Mensagens</span>
      </button>

      <button
        onClick={() => navigate("/recompensas")}
        className="flex-1 flex flex-col items-center justify-center gap-0.5 text-white/60 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
        </svg>
        <span className="text-[9px] font-medium">Recompensas</span>
      </button>
    </nav>
  );
}