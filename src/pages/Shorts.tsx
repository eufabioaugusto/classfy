import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Share2, MoreVertical, Volume2, VolumeX, ChevronUp, ChevronDown, Bookmark } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";

interface ShortContent {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string;
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

export default function Shorts() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [shorts, setShorts] = useState<ShortContent[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [localLikesCount, setLocalLikesCount] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const { processReward } = useRewardSystem();
  const [metricsRecorded, setMetricsRecorded] = useState<{[key: string]: {start: boolean, half: boolean, complete: boolean}}>({});

  useEffect(() => {
    if (user) {
      fetchShorts();
    }
  }, [user]);

  useEffect(() => {
    if (id && shorts.length > 0) {
      const index = shorts.findIndex(s => s.id === id);
      if (index !== -1) {
        setCurrentIndex(index);
        scrollToIndex(index);
      }
    }
  }, [id, shorts]);

  useEffect(() => {
    if (shorts[currentIndex]) {
      checkAccess(shorts[currentIndex]);
      checkLikeStatus(shorts[currentIndex].id);
      checkSavedStatus(shorts[currentIndex].id);
      navigate(`/shorts/${shorts[currentIndex].id}`, { replace: true });
      
      // Pause all videos except current
      videoRefs.current.forEach((video, idx) => {
        if (video) {
          if (idx === currentIndex) {
            video.play().catch(console.error);
          } else {
            video.pause();
          }
        }
      });
    }
  }, [currentIndex, shorts]);

  const fetchShorts = async () => {
    try {
      const { data, error } = await supabase
        .from("contents")
        .select(`
          id,
          title,
          description,
          video_url,
          thumbnail_url,
          visibility,
          price,
          duration_seconds,
          views_count,
          likes_count,
          creator_id,
          creator:profiles!contents_creator_id_fkey(
            id,
            display_name,
            avatar_url,
            creator_channel_name
          )
        `)
        .eq("content_type", "short")
        .eq("status", "published")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      setShorts(data || []);
      
      if (data && data.length > 0) {
        setLocalLikesCount(data[0].likes_count || 0);
      }
    } catch (error) {
      console.error("Error fetching shorts:", error);
      toast.error("Erro ao carregar shorts");
    } finally {
      setLoading(false);
    }
  };

  const checkAccess = async (short: ShortContent) => {
    if (!user || !short) return;

    // Check if content is free
    if (short.visibility === "free") {
      setHasAccess(true);
      await incrementView(short.id);
      return;
    }

    // Check if user has required plan
    if (short.visibility === "pro" && (profile?.plan === "pro" || profile?.plan === "premium")) {
      setHasAccess(true);
      await incrementView(short.id);
      return;
    }

    if (short.visibility === "premium" && profile?.plan === "premium") {
      setHasAccess(true);
      await incrementView(short.id);
      return;
    }

    // Check if paid content was purchased
    if (short.visibility === "paid") {
      const { data } = await supabase
        .from("purchased_contents")
        .select("id")
        .eq("user_id", user.id)
        .eq("content_id", short.id)
        .maybeSingle();

      if (data) {
        setHasAccess(true);
        await incrementView(short.id);
        return;
      }
    }

    setHasAccess(false);
  };

  const incrementView = async (contentId: string) => {
    try {
      await supabase.rpc("increment_content_view", {
        p_content_id: contentId,
        p_user_id: user?.id,
      });
    } catch (error) {
      console.error("Error incrementing view:", error);
    }
  };

  const checkLikeStatus = async (contentId: string) => {
    if (!user) return;
    
    const { data } = await supabase
      .from("favorites")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .maybeSingle();
    
    setIsLiked(!!data);
  };

  const checkSavedStatus = async (contentId: string) => {
    if (!user) return;
    
    const { data } = await supabase
      .from("saved_contents")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .maybeSingle();
    
    setIsSaved(!!data);
  };

  const handleLike = async () => {
    if (!user || !shorts[currentIndex]) return;

    const contentId = shorts[currentIndex].id;
    
    try {
      if (isLiked) {
        await supabase
          .from("favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("content_id", contentId);
        
        setLocalLikesCount(prev => Math.max(0, prev - 1));
        setIsLiked(false);
      } else {
        await supabase
          .from("favorites")
          .insert({ user_id: user.id, content_id: contentId });
        
        setLocalLikesCount(prev => prev + 1);
        setIsLiked(true);
        await processReward({
          actionKey: 'LIKE_CONTENT',
          userId: user.id,
          contentId,
        });
      }
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  const handleSave = async () => {
    if (!user || !shorts[currentIndex]) return;

    const contentId = shorts[currentIndex].id;
    
    try {
      if (isSaved) {
        await supabase
          .from("saved_contents")
          .delete()
          .eq("user_id", user.id)
          .eq("content_id", contentId);
        
        setIsSaved(false);
        toast.success("Removido dos salvos");
      } else {
        await supabase
          .from("saved_contents")
          .insert({ user_id: user.id, content_id: contentId });
        
        setIsSaved(true);
        toast.success("Salvo com sucesso");
        await processReward({
          actionKey: 'SAVE_CONTENT',
          userId: user.id,
          contentId,
        });
      }
    } catch (error) {
      console.error("Error toggling save:", error);
    }
  };

  const handleShare = async () => {
    const short = shorts[currentIndex];
    if (!short) return;

    const url = `${window.location.origin}/shorts/${short.id}`;
    
    if (navigator.share) {
      try {
        await navigator.share({
          title: short.title,
          text: short.description || "",
          url: url,
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Error sharing:", error);
        }
      }
    } else {
      navigator.clipboard.writeText(url);
      toast.success("Link copiado!");
    }
  };

  const scrollToIndex = (index: number) => {
    const container = containerRef.current;
    if (container) {
      container.scrollTo({
        top: index * window.innerHeight,
        behavior: "smooth",
      });
    }
  };

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const scrollPosition = container.scrollTop;
    const newIndex = Math.round(scrollPosition / window.innerHeight);
    
    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < shorts.length) {
      setCurrentIndex(newIndex);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      scrollToIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (currentIndex < shorts.length - 1) {
      setCurrentIndex(currentIndex + 1);
      scrollToIndex(currentIndex + 1);
    }
  };

  const handleTimeUpdate = async (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    const short = shorts[currentIndex];
    if (!short || !user) return;

    const contentId = short.id;
    const currentTime = video.currentTime;
    const duration = video.duration;
    const percentWatched = (currentTime / duration) * 100;

    // Initialize metrics for this content if not exists
    if (!metricsRecorded[contentId]) {
      setMetricsRecorded(prev => ({
        ...prev,
        [contentId]: { start: false, half: false, complete: false }
      }));
    }

    // Record start (after 3 seconds)
    if (currentTime >= 3 && !metricsRecorded[contentId]?.start) {
      await recordMetric(contentId, "start");
      setMetricsRecorded(prev => ({
        ...prev,
        [contentId]: { ...prev[contentId], start: true }
      }));
    }

    // Record half
    if (percentWatched >= 50 && !metricsRecorded[contentId]?.half) {
      await recordMetric(contentId, "half");
      setMetricsRecorded(prev => ({
        ...prev,
        [contentId]: { ...prev[contentId], half: true }
      }));
    }

    // Record complete
    if (percentWatched >= 95 && !metricsRecorded[contentId]?.complete) {
      await recordMetric(contentId, "complete");
      await processReward({
        actionKey: 'WATCH_100',
        userId: user.id,
        contentId,
      });
      setMetricsRecorded(prev => ({
        ...prev,
        [contentId]: { ...prev[contentId], complete: true }
      }));
    }
  };

  const recordMetric = async (contentId: string, event: string) => {
    try {
      await supabase.from("content_metrics").insert({
        content_id: contentId,
        user_id: user?.id,
        event,
      });
    } catch (error) {
      console.error("Error recording metric:", error);
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Faça login para ver os shorts</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (shorts.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Nenhum short disponível</p>
      </div>
    );
  }

  const currentShort = shorts[currentIndex];

  return (
    <>
      <div 
        ref={containerRef}
        className="h-screen overflow-y-scroll snap-y snap-mandatory scroll-smooth bg-black"
        onScroll={handleScroll}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        <style>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        
        {shorts.map((short, index) => (
          <div
            key={short.id}
            className="relative h-screen w-screen snap-start snap-always flex items-center justify-center"
          >
            {/* Video */}
            <video
              ref={(el) => (videoRefs.current[index] = el)}
              src={short.video_url}
              className="absolute inset-0 w-full h-full object-contain bg-black"
              loop
              playsInline
              muted={isMuted}
              onTimeUpdate={index === currentIndex ? handleTimeUpdate : undefined}
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
            />

            {/* Access overlay */}
            {index === currentIndex && !hasAccess && (
              <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-20">
                <div className="text-center px-6">
                  <h3 className="text-xl font-bold text-white mb-2">Conteúdo Bloqueado</h3>
                  <p className="text-gray-300 mb-4">
                    {short.visibility === "paid" 
                      ? `Este short custa R$ ${short.price?.toFixed(2)}`
                      : `Assine o plano ${short.visibility === "pro" ? "Pro" : "Premium"} para acessar`
                    }
                  </p>
                  <Button
                    onClick={() => {
                      if (short.visibility === "paid") {
                        setShowPurchaseModal(true);
                      } else {
                        setShowUpgradeModal(true);
                      }
                    }}
                  >
                    {short.visibility === "paid" ? "Comprar Agora" : "Assinar"}
                  </Button>
                </div>
              </div>
            )}

            {/* Navigation arrows */}
            {index === currentIndex && (
              <>
                {currentIndex > 0 && (
                  <button
                    onClick={handlePrevious}
                    className="absolute top-1/2 left-4 -translate-y-1/2 z-10 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                  >
                    <ChevronUp className="w-6 h-6" />
                  </button>
                )}
                {currentIndex < shorts.length - 1 && (
                  <button
                    onClick={handleNext}
                    className="absolute top-1/2 right-4 -translate-y-1/2 z-10 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 transition-colors"
                  >
                    <ChevronDown className="w-6 h-6" />
                  </button>
                )}
              </>
            )}

            {/* Side actions */}
            {index === currentIndex && hasAccess && (
              <div className="absolute right-4 bottom-24 flex flex-col gap-6 z-10">
                {/* Like */}
                <button
                  onClick={handleLike}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="bg-black/30 backdrop-blur-sm p-3 rounded-full">
                    <Heart
                      className={`w-7 h-7 ${isLiked ? "fill-red-500 text-red-500" : "text-white"}`}
                    />
                  </div>
                  <span className="text-white text-xs font-medium">
                    {localLikesCount > 999 
                      ? `${(localLikesCount / 1000).toFixed(1)}k`
                      : localLikesCount
                    }
                  </span>
                </button>

                {/* Comment */}
                <button className="flex flex-col items-center gap-1">
                  <div className="bg-black/30 backdrop-blur-sm p-3 rounded-full">
                    <MessageCircle className="w-7 h-7 text-white" />
                  </div>
                  <span className="text-white text-xs font-medium">113</span>
                </button>

                {/* Save */}
                <button
                  onClick={handleSave}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="bg-black/30 backdrop-blur-sm p-3 rounded-full">
                    <Bookmark
                      className={`w-7 h-7 ${isSaved ? "fill-white text-white" : "text-white"}`}
                    />
                  </div>
                </button>

                {/* Share */}
                <button
                  onClick={handleShare}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="bg-black/30 backdrop-blur-sm p-3 rounded-full">
                    <Share2 className="w-7 h-7 text-white" />
                  </div>
                </button>

                {/* Mute */}
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="flex flex-col items-center gap-1"
                >
                  <div className="bg-black/30 backdrop-blur-sm p-3 rounded-full">
                    {isMuted ? (
                      <VolumeX className="w-7 h-7 text-white" />
                    ) : (
                      <Volume2 className="w-7 h-7 text-white" />
                    )}
                  </div>
                </button>

                {/* More */}
                <button className="flex flex-col items-center gap-1">
                  <div className="bg-black/30 backdrop-blur-sm p-3 rounded-full">
                    <MoreVertical className="w-7 h-7 text-white" />
                  </div>
                </button>
              </div>
            )}

            {/* Bottom info */}
            {index === currentIndex && hasAccess && (
              <div className="absolute left-4 bottom-20 right-24 z-10">
                {/* Creator info */}
                <div className="flex items-center gap-3 mb-3">
                  <Avatar className="w-10 h-10 border-2 border-white">
                    <AvatarImage src={short.creator.avatar_url || ""} />
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {short.creator.display_name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-white font-semibold text-sm">
                      @{short.creator.creator_channel_name || short.creator.display_name}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-white/10 backdrop-blur-sm border-white text-white hover:bg-white/20"
                  >
                    Seguir
                  </Button>
                </div>

                {/* Title and description */}
                <div className="text-white">
                  <h2 className="font-bold text-base mb-1">{short.title}</h2>
                  {short.description && (
                    <p className="text-sm text-white/90 line-clamp-2">
                      {short.description}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        requiredPlan={currentShort?.visibility === "premium" ? "premium" : "pro"}
      />

      {currentShort && (
        <PurchaseModal
          open={showPurchaseModal}
          onOpenChange={setShowPurchaseModal}
          content={{
            id: currentShort.id,
            title: currentShort.title,
            thumbnail_url: currentShort.thumbnail_url,
            price: currentShort.price,
            creator_name: currentShort.creator.creator_channel_name || currentShort.creator.display_name,
          }}
          onPurchaseComplete={() => {
            setShowPurchaseModal(false);
            checkAccess(currentShort);
          }}
        />
      )}
    </>
  );
}
