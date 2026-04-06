import { useParams, useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Header } from "@/components/Header";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileShortsView } from "@/components/shorts/MobileShortsView";
import { DesktopShortsView } from "@/components/shorts/DesktopShortsView";

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

export default function Shorts() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const isMobile = useIsMobile();
  const [shorts, setShorts] = useState<ShortContent[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [localLikesCount, setLocalLikesCount] = useState(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const { processReward } = useRewardSystem();
  const [metricsRecorded, setMetricsRecorded] = useState<{[key: string]: {start: boolean, half: boolean, complete: boolean}}>({});
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [commentsCount, setCommentsCount] = useState(0);
  const scrollLockRef = useRef(false);
  const [isFollowing, setIsFollowing] = useState(false);
  const PAGE_SIZE = 10;

  useEffect(() => {
    if (user) {
      fetchInitialShorts();
    }
  }, [user]);



  useEffect(() => {
    if (shorts[currentIndex]) {
      const currentShort = shorts[currentIndex];
      checkAccess(currentShort);
      checkLikeStatus(currentShort.id);
      checkSavedStatus(currentShort.id);
      checkFollowStatus(currentShort.creator_id);
      fetchCommentsCount(currentShort.id);
      setLocalLikesCount(currentShort.likes_count || 0);
      
      // Update URL to reflect current short
      navigate(`/shorts/${currentShort.id}`, { replace: true });

      // Play current video and pause others
      videoRefs.current.forEach((video, idx) => {
        if (!video) return;
        if (idx === currentIndex) {
          video.play().catch(console.error);
        } else {
          video.pause();
        }
      });
    }

    // Load more when reaching the end of current page
    if (currentIndex >= shorts.length - 2 && hasMore && !isLoadingMore) {
      fetchMoreShorts();
    }
  }, [currentIndex, shorts]);

  const fetchInitialShorts = async () => {
    try {
      setLoading(true);
      let shortsData: ShortContent[] = [];

      // If we have an ID in the URL, fetch that specific short first
      if (id) {
        const { data: specificShort, error: specificError } = await supabase
          .from("contents")
          .select(`
            id,
            title,
            description,
            video_url,
            thumbnail_url,
            file_url,
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
          .eq("id", id)
          .eq("content_type", "short")
          .eq("status", "approved")
          .maybeSingle();

        if (specificError) {
          console.error("Error fetching specific short:", specificError);
        }

        if (specificShort) {
          shortsData.push(specificShort as ShortContent);
        }
      }

      const remainingSlots = PAGE_SIZE - shortsData.length;

      // Fetch other shorts ordered by relevance (views_count desc)
      let query = supabase
        .from("contents")
        .select(`
          id,
          title,
          description,
          video_url,
          thumbnail_url,
          file_url,
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
        .eq("status", "approved")
        .order("views_count", { ascending: false })
        .limit(remainingSlots > 0 ? remainingSlots : 0);

      if (id) query = query.neq("id", id);

      const { data, error } = await query;

      if (error) throw error;

      if (data) {
        shortsData = [...shortsData, ...(data as ShortContent[])];
      }

      setShorts(shortsData);
      setHasMore((data?.length || 0) === (remainingSlots > 0 ? remainingSlots : 0));

      if (shortsData.length > 0) {
        setLocalLikesCount(shortsData[0].likes_count || 0);
      }
    } catch (error) {
      console.error("Error fetching shorts:", error);
      toast.error("Erro ao carregar shorts");
    } finally {
      setLoading(false);
    }
  };

  const fetchMoreShorts = async () => {
    try {
      setIsLoadingMore(true);
      let moreQuery = supabase
        .from("contents")
        .select(`
          id,
          title,
          description,
          video_url,
          thumbnail_url,
          file_url,
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
        .eq("status", "approved")
        .order("views_count", { ascending: false })
        .range(shorts.length, shorts.length + PAGE_SIZE - 1);

      if (id) moreQuery = moreQuery.neq("id", id);

      const { data, error } = await moreQuery;

      if (error) throw error;

      if (!data || data.length === 0) {
        setHasMore(false);
        return;
      }

      setShorts(prev => [...prev, ...(data as ShortContent[])]);
      setHasMore(data.length === PAGE_SIZE);
    } catch (error) {
      console.error("Error loading more shorts:", error);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const fetchCommentsCount = async (contentId: string) => {
    try {
      const { count, error } = await supabase
        .from("comments")
        .select("id", { count: "exact", head: true })
        .eq("content_id", contentId);

      if (error) {
        console.error("Error fetching comments count:", error);
        return;
      }

      setCommentsCount(count ?? 0);
    } catch (error) {
      console.error("Error fetching comments count:", error);
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
      .from("actions")
      .select("id")
      .eq("user_id", user.id)
      .eq("content_id", contentId)
      .eq("type", "LIKE")
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

  const checkFollowStatus = async (creatorId: string) => {
    if (!user || user.id === creatorId) {
      setIsFollowing(false);
      return;
    }
    
    const { data } = await supabase
      .from("follows")
      .select("id")
      .eq("follower_id", user.id)
      .eq("following_id", creatorId)
      .maybeSingle();
    
    setIsFollowing(!!data);
  };

  const handleLike = async () => {
    if (!user || !shorts[currentIndex]) return;

    const contentId = shorts[currentIndex].id;
    
    try {
      if (isLiked) {
        await supabase
          .from("actions")
          .delete()
          .eq("user_id", user.id)
          .eq("content_id", contentId)
          .eq("type", "LIKE");
        
        setLocalLikesCount(prev => Math.max(0, prev - 1));
        setIsLiked(false);
      } else {
        await supabase
          .from("actions")
          .insert({ user_id: user.id, content_id: contentId, type: "LIKE" });
        
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

  const handleFollow = async () => {
    if (!user || !shorts[currentIndex]) return;

    const creatorId = shorts[currentIndex].creator_id;
    
    try {
      if (isFollowing) {
        await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", creatorId);
        
        setIsFollowing(false);
        toast.success("Deixou de seguir");
      } else {
        await supabase
          .from("follows")
          .insert({ follower_id: user.id, following_id: creatorId });
        
        setIsFollowing(true);
        toast.success("Seguindo");
      }
    } catch (error) {
      console.error("Error toggling follow:", error);
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

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (scrollLockRef.current || shorts.length === 0) return;

    const threshold = 30; // exige gesto mais forte/mais longo
    if (Math.abs(e.deltaY) < threshold) return;

    scrollLockRef.current = true;
    e.preventDefault();

    if (e.deltaY > 0) {
      handleNext();
    } else {
      handlePrevious();
    }

    window.setTimeout(() => {
      scrollLockRef.current = false;
    }, 800); // bloqueia novos avanços por 0.8s
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
    return <Navigate to="/auth" replace />;
  }

  if (loading && shorts.length === 0) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
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

  const handleAccessBlocked = () => {
    if (currentShort?.visibility === "paid") {
      setShowPurchaseModal(true);
    } else {
      setShowUpgradeModal(true);
    }
  };

  // Mobile fullscreen view
  if (isMobile) {
    return (
      <>
        <MobileShortsView
          shorts={shorts}
          currentIndex={currentIndex}
          onIndexChange={setCurrentIndex}
          hasAccess={hasAccess}
          isMuted={isMuted}
          onToggleMute={() => setIsMuted(!isMuted)}
          isLiked={isLiked}
          onLike={handleLike}
          isSaved={isSaved}
          onSave={handleSave}
          isFollowing={isFollowing}
          onFollow={handleFollow}
          onShare={handleShare}
          localLikesCount={localLikesCount}
          commentsCount={commentsCount}
          onTimeUpdate={handleTimeUpdate}
          onAccessBlocked={handleAccessBlocked}
        />

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
              creator_name:
                currentShort.creator.creator_channel_name || currentShort.creator.display_name,
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

  // Desktop view - YouTube-style premium layout
  return (
    <>
      <SidebarProvider defaultOpen={true}>
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col">
            <Header variant="home" />
            <main 
              className="flex-1 flex items-center justify-center px-4 py-6" 
              onWheel={handleWheel}
            >
              <DesktopShortsView
                shorts={shorts}
                currentIndex={currentIndex}
                hasAccess={hasAccess}
                isMuted={isMuted}
                onToggleMute={() => setIsMuted(!isMuted)}
                isLiked={isLiked}
                onLike={handleLike}
                isSaved={isSaved}
                onSave={handleSave}
                isFollowing={isFollowing}
                onFollow={handleFollow}
                onShare={handleShare}
                onPrevious={handlePrevious}
                onNext={handleNext}
                localLikesCount={localLikesCount}
                commentsCount={commentsCount}
                onTimeUpdate={handleTimeUpdate}
                onAccessBlocked={handleAccessBlocked}
              />
            </main>
          </div>
        </div>
      </SidebarProvider>

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
            creator_name:
              currentShort.creator.creator_channel_name || currentShort.creator.display_name,
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
