import { useParams, Navigate, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { ContentActions } from "@/components/ContentActions";
import { ContentComments } from "@/components/ContentComments";
import { FollowButton } from "@/components/FollowButton";
import { AddToStudyModal } from "@/components/AddToStudyModal";
import { WatchVideoPlayer } from "@/components/WatchVideoPlayer";
import { Header } from "@/components/Header";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { useState, useEffect, useRef } from "react";
import { GlobalLoader } from "@/components/GlobalLoader";
import { toast } from "sonner";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { WatchNotes } from "@/components/WatchNotes";
import { CourseCurriculum } from "@/components/CourseCurriculum";
import { WatchRelated } from "@/components/WatchRelated";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileVideoPlayer } from "@/components/watch/MobileVideoPlayer";
import { MobileWatchLayout } from "@/components/watch/MobileWatchLayout";
import { MobileCommentsSheet } from "@/components/watch/MobileCommentsSheet";
import { MobileNotesSheet } from "@/components/watch/MobileNotesSheet";
import { MobileWatchOverlay } from "@/components/watch/MobileWatchOverlay";

interface Content {
  id: string;
  content_type: "aula" | "short" | "podcast" | "curso";
  title: string;
  description: string | null;
  file_url: string;
  thumbnail_url: string;
  visibility: "free" | "pro" | "premium" | "paid";
  price: number;
  duration_seconds: number;
  views_count: number;
  likes_count: number;
  status?: string;
  creator_id: string;
  category_id?: string | null;
  tags: string[] | null;
  created_at?: string;
  creator?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  } | null;
  // Course specific fields
  total_lessons?: number;
  total_duration_seconds?: number;
  level?: string;
  what_you_learn?: string;
  requirements?: string;
}

// Helper function to format view counts
const formatCount = (count: number) => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  }
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

// Inner component to use sidebar hook
function WatchContent() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { user, profile, loading, role } = useAuth();
  const { setOpen: setSidebarOpen } = useSidebar();
  const { startMiniPlayer, closeMiniPlayer, state: miniPlayerState } = useMiniPlayer();
  const [content, setContent] = useState<Content | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<"pro" | "premium">("pro");
  const [isPurchased, setIsPurchased] = useState(false);
  const [metricsRecorded, setMetricsRecorded] = useState({
    start: false,
    half: false,
    complete: false,
  });
  const [view15sRecorded, setView15sRecorded] = useState(false);
  const [showAddToStudyModal, setShowAddToStudyModal] = useState(false);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState(0);
  const [seekToTime, setSeekToTime] = useState<number | null>(null);
  const { processReward, handleLike, handleSave, handleFavorite } = useRewardSystem();
  
  // Track current playback time for mini player
  const currentPlaybackTime = useRef(0);

  // Theater mode state
  const [theaterMode, setTheaterMode] = useState(false);
  const previousSidebarState = useRef(true);

  // Course-specific state
  const [isCourse, setIsCourse] = useState(false);
  const [courseModules, setCourseModules] = useState<any[]>([]);
  const [currentLesson, setCurrentLesson] = useState<any>(null);

  // YouTube-style UI state
  const [descExpanded, setDescExpanded] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);

  // Mobile sheet states
  const [showMobileComments, setShowMobileComments] = useState(false);
  const [showMobileNotes, setShowMobileNotes] = useState(false);
  const [relatedContents, setRelatedContents] = useState<any[]>([]);

  // Action states for mobile
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(0);

  // Store content ref for cleanup
  const contentRef = useRef<Content | null>(null);
  
  // Keep contentRef updated
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  // Close mini player when entering this Watch page (we're now watching full screen)
  useEffect(() => {
    if (miniPlayerState.isVisible && miniPlayerState.content?.id === id) {
      closeMiniPlayer();
    }
  }, [id]);

  // Activate mini player when leaving the Watch page
  useEffect(() => {
    return () => {
      const currentContent = contentRef.current;
      const playbackTime = currentPlaybackTime.current;
      
      // Only activate if we have content and some playback progress
      if (currentContent && playbackTime > 0) {
        startMiniPlayer({
          id: currentContent.id,
          title: currentContent.title,
          subtitle: currentContent.creator?.display_name,
          thumbnail_url: currentContent.thumbnail_url,
          file_url: currentContent.file_url,
          duration_seconds: currentContent.duration_seconds,
          creator: currentContent.creator ? { display_name: currentContent.creator.display_name } : undefined,
        }, playbackTime);
      }
    };
  }, [startMiniPlayer]);

  const handleTheaterModeToggle = () => {
    if (!theaterMode) {
      // Entering theater mode - collapse sidebar
      previousSidebarState.current = true;
      setSidebarOpen(false);
    } else {
      // Exiting theater mode - restore sidebar
      setSidebarOpen(previousSidebarState.current);
    }
    setTheaterMode(!theaterMode);
  };

  // Start fetching content as early as possible - don't wait for role/profile
  useEffect(() => {
    if (id && !loading) {
      fetchContent();
    }
  }, [id, loading]);

  const fetchContent = async () => {
    try {
      // Fetch content and course in parallel for speed
      const [contentResult, courseResult] = await Promise.all([
        supabase
          .from("contents")
          .select(`
            id, content_type, title, description, file_url, thumbnail_url,
            visibility, price, duration_seconds, views_count, likes_count,
            status, creator_id, category_id, tags, created_at,
            creator:profiles!creator_id(id, display_name, avatar_url)
          `)
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("courses")
          .select(`
            id, title, description, thumbnail_url, visibility, price,
            total_duration_seconds, views_count, likes_count, status,
            creator_id, tags, total_lessons, level, what_you_learn,
            requirements, created_at,
            creator:profiles!creator_id(id, display_name, avatar_url)
          `)
          .eq("id", id)
          .maybeSingle()
      ]);

      const data = contentResult.data;
      const courseData = courseResult.data;

      // Handle content
      if (data) {
        // Check access for non-admins
        if (role !== "admin" && data.status !== "approved") {
          setContent(null);
          setLoadingContent(false);
          return;
        }

        setIsCourse(false);
        setContent(data);
        checkAccess(data);

        // Register view in background (don't await)
        const isAdminPreview = role === "admin" && data.status === "pending";
        if (!isAdminPreview && user) {
          supabase.rpc("increment_content_view", {
            p_user_id: user.id,
            p_content_id: id,
          }).then(({ error }) => {
            if (error) console.error("Error registering view:", error);
          });
        }

        setLoadingContent(false);
        return;
      }

      // Handle course
      if (courseData) {
        if (role !== "admin" && courseData.status !== "approved" && courseData.creator_id !== user?.id) {
          setContent(null);
          setLoadingContent(false);
          return;
        }

        // Fetch modules (needed for course display)
        const { data: modules } = await supabase
          .from("course_modules")
          .select(`*, lessons:course_lessons(*)`)
          .eq("course_id", id)
          .order("order_index", { ascending: true });

        setCourseModules(modules || []);

        if (modules?.[0]?.lessons?.[0]) {
          setCurrentLesson(modules[0].lessons[0]);
        }

        setIsCourse(true);
        setContent({
          ...courseData,
          content_type: "curso" as any,
          duration_seconds: courseData.total_duration_seconds || 0,
          file_url: "",
          likes_count: courseData.likes_count || 0,
          category_id: null,
        } as Content);

        checkAccess(courseData as any);

        // Register view in background
        const isAdminPreview = role === "admin" && courseData.status === "pending";
        if (!isAdminPreview && user) {
          supabase.rpc("increment_course_view", {
            p_user_id: user.id,
            p_course_id: id,
          }).then(({ error }) => {
            if (error) console.error("Error registering course view:", error);
          });
        }

        setLoadingContent(false);
        return;
      }

      // Neither found
      setContent(null);
    } catch (error: any) {
      console.error(error);
    } finally {
      setLoadingContent(false);
    }
  };

  // Fetch followers count for creator
  const fetchFollowersCount = async (creatorId: string) => {
    const { count } = await supabase
      .from("follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", creatorId);
    setFollowersCount(count || 0);
  };

  // Trigger followers count and action states when content changes
  useEffect(() => {
    if (content?.creator?.id) {
      fetchFollowersCount(content.creator.id);
    }
    if (content && user) {
      checkActionStates();
      fetchRelatedContents();
    }
  }, [content?.id, content?.creator?.id, user]);

  const checkActionStates = async () => {
    if (!user || !content) return;
    
    const [likeData, savedData, favoriteData, countResult] = await Promise.all([
      supabase.from('actions').select('id').eq('user_id', user.id).eq('type', 'LIKE').eq(isCourse ? 'course_id' : 'content_id', content.id).maybeSingle(),
      supabase.from('saved_contents').select('id').eq('user_id', user.id).eq(isCourse ? 'course_id' : 'content_id', content.id).maybeSingle(),
      supabase.from('favorites').select('id').eq('user_id', user.id).eq(isCourse ? 'course_id' : 'content_id', content.id).maybeSingle(),
      supabase.from('actions').select('*', { count: 'exact', head: true }).eq('type', 'LIKE').eq(isCourse ? 'course_id' : 'content_id', content.id),
    ]);
    
    setIsLiked(!!likeData.data);
    setIsSaved(!!savedData.data);
    setIsFavorited(!!favoriteData.data);
    setLikesCount(countResult.count || 0);
  };

  const fetchRelatedContents = async () => {
    if (!content) return;
    const { data } = await supabase
      .from('contents')
      .select('id, title, thumbnail_url, duration_seconds, views_count, creator:profiles!creator_id(display_name)')
      .eq('status', 'approved')
      .neq('id', content.id)
      .limit(6);
    setRelatedContents(data || []);
  };

  const toggleLike = async () => {
    if (!user || !content) return;
    if (isLiked) {
      await supabase.from('actions').delete().eq('user_id', user.id).eq('type', 'LIKE').eq(isCourse ? 'course_id' : 'content_id', content.id);
      setIsLiked(false);
      setLikesCount(prev => Math.max(0, prev - 1));
    } else {
      await supabase.from('actions').insert({ user_id: user.id, type: 'LIKE', [isCourse ? 'course_id' : 'content_id']: content.id });
      setIsLiked(true);
      setLikesCount(prev => prev + 1);
      await handleLike(user.id, content.id, true);
    }
  };

  const toggleSave = async () => {
    if (!user || !content) return;
    if (isSaved) {
      await supabase.from('saved_contents').delete().eq('user_id', user.id).eq(isCourse ? 'course_id' : 'content_id', content.id);
      setIsSaved(false);
    } else {
      await supabase.from('saved_contents').insert({ user_id: user.id, [isCourse ? 'course_id' : 'content_id']: content.id });
      setIsSaved(true);
      await handleSave(user.id, content.id);
    }
  };

  const toggleFavorite = async () => {
    if (!user || !content) return;
    if (isFavorited) {
      await supabase.from('favorites').delete().eq('user_id', user.id).eq(isCourse ? 'course_id' : 'content_id', content.id);
      setIsFavorited(false);
    } else {
      await supabase.from('favorites').insert({ user_id: user.id, [isCourse ? 'course_id' : 'content_id']: content.id });
      setIsFavorited(true);
      await handleFavorite(user.id, content.id);
    }
  };

  // Log content fetch errors for debugging
  useEffect(() => {
    if (content && !content.creator) {
      console.warn("⚠️ Content loaded but creator is null - possible RLS/network issue");
    }
  }, [content]);

  const checkAccess = async (content: Content) => {
    if (!profile || !user) return;

    // Admins always have access
    if (role === "admin") {
      setHasAccess(true);
      return;
    }

    const userPlan = profile.plan || "free";

    // Check if content is paid and user has purchased it
    if (content.visibility === "paid") {
      const { data: purchase } = await supabase
        .from("purchased_contents")
        .select("id")
        .eq("user_id", user.id)
        .eq("content_id", content.id)
        .maybeSingle();

      if (purchase) {
        setIsPurchased(true);
        setHasAccess(true);
        return;
      } else {
        setIsPurchased(false);
        setHasAccess(false);
        setShowPurchaseModal(true);
        return;
      }
    }

    // Check plan-based access
    if (content.visibility === "free") {
      setHasAccess(true);
    } else if (content.visibility === "pro") {
      if (["pro", "premium"].includes(userPlan)) {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan("pro");
        setShowUpgradeModal(true);
      }
    } else if (content.visibility === "premium") {
      if (userPlan === "premium") {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan("premium");
        setShowUpgradeModal(true);
      }
    } else {
      setHasAccess(false);
    }
  };

  const recordMetric = async (event: "start" | "half" | "complete") => {
    if (metricsRecorded[event] || !user || !id) return;

    try {
      await supabase.from("content_metrics").insert({
        content_id: id,
        user_id: user.id,
        event,
      });

      setMetricsRecorded((prev) => ({ ...prev, [event]: true }));
    } catch (error) {
      console.error("Error recording metric:", error);
    }
  };

  const checkBingeWatch = async () => {
    if (!user) return;

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCompletions } = await supabase
      .from("content_metrics")
      .select("content_id")
      .eq("user_id", user.id)
      .eq("event", "complete")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(3);

    if (recentCompletions && recentCompletions.length >= 3) {
      await processReward({
        actionKey: "BINGE_WATCH",
        userId: user.id,
        metadata: { contentCount: recentCompletions.length },
      });
    }
  };

  const checkFirstContentWeek = async () => {
    if (!user || !content) return;

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const { data: weeklyViews } = await supabase
      .from("content_metrics")
      .select("id")
      .eq("user_id", user.id)
      .eq("event", "start")
      .gte("created_at", startOfWeek.toISOString())
      .limit(1);

    if (!weeklyViews || weeklyViews.length === 0) {
      await processReward({
        actionKey: "FIRST_CONTENT_WEEK",
        userId: user.id,
        contentId: content.id,
      });
    }
  };

  const handleTimeUpdate = async (currentTime: number) => {
    if (!content || !user) return;
    
    // Store current time for mini player
    currentPlaybackTime.current = currentTime;

    const duration = content.duration_seconds || 0;
    const percent = (currentTime / duration) * 100;

    if (!view15sRecorded && currentTime >= 15) {
      await processReward({
        actionKey: "VIEW_15S",
        userId: user.id,
        contentId: content.id,
        metadata: { watch_time: currentTime },
      });
      setView15sRecorded(true);
    }

    if (!metricsRecorded.start && currentTime > 0) {
      await recordMetric("start");
      await checkFirstContentWeek();
    }

    if (!metricsRecorded.half && currentTime > duration / 2) {
      await recordMetric("half");
    }

    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      await recordMetric("complete");
      await checkBingeWatch();
    }
  };

  const handleApprove = async () => {
    if (!content) return;

    try {
      // Check if admin
      if (role !== "admin") {
        toast.error("Apenas administradores podem aprovar conteúdo.");
        return;
      }

      // Update content status using service role through edge function
      const { data: updateData, error: updateError } = await supabase.functions.invoke("approve-content", {
        body: { contentId: id },
      });

      if (updateError) throw updateError;

      toast.success("Conteúdo aprovado! O criador foi notificado.");
      window.location.href = "/admin/contents";
    } catch (error: any) {
      console.error("Error approving content:", error);
      toast.error(error.message || "Não foi possível aprovar o conteúdo.");
    }
  };

  const handleReject = async () => {
    if (!content) return;

    try {
      // Check if admin
      if (role !== "admin") {
        toast.error("Apenas administradores podem reprovar conteúdo.");
        return;
      }

      // Update content status using service role through edge function
      const { data: updateData, error: updateError } = await supabase.functions.invoke("reject-content", {
        body: { contentId: id },
      });

      if (updateError) throw updateError;

      toast.success("Conteúdo reprovado. O criador foi notificado.");
      window.location.href = "/admin/contents";
    } catch (error: any) {
      console.error("Error rejecting content:", error);
      toast.error(error.message || "Não foi possível reprovar o conteúdo.");
    }
  };

// Debug logs
  console.log("🎬 Watch render - loading:", loading, "loadingContent:", loadingContent, "user:", !!user, "content:", !!content);

  // First check auth loading - if auth is still loading, show loader
  if (loading) {
    console.log("⏳ Showing loader: auth loading");
    return <GlobalLoader />;
  }

  // If auth finished and no user, redirect to auth
  if (!user) {
    console.log("🚪 Redirecting to /auth - no user");
    return <Navigate to="/auth" replace />;
  }

  // Only show content loader after we know user is authenticated
  if (loadingContent) {
    console.log("⏳ Showing loader: content loading");
    return <GlobalLoader />;
  }
  if (!content)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Conteúdo não encontrado</h2>
          <p className="text-muted-foreground">O conteúdo que você está procurando não existe ou foi removido.</p>
        </Card>
      </div>
    );
  // Mobile layout - with swipe-to-minimize overlay
  if (isMobile) {
    const handleMinimize = () => {
      // Navigate back - the overlay handles starting the mini player
      navigate(-1);
    };

    return (
      <MobileWatchOverlay
        isVisible={true}
        content={{
          id: content.id,
          title: content.title,
          file_url: isCourse && currentLesson ? currentLesson.video_url : content.file_url,
          thumbnail_url: content.thumbnail_url,
          duration_seconds: content.duration_seconds,
          creator: content.creator,
        }}
        currentTime={currentPlaybackTime.current}
        onClose={handleMinimize}
      >
        <div className="min-h-screen bg-background flex flex-col">
          <UpgradeModal open={showUpgradeModal} onOpenChange={setShowUpgradeModal} requiredPlan={requiredUpgradePlan} />
          <PurchaseModal
            open={showPurchaseModal}
            onOpenChange={setShowPurchaseModal}
            content={{ id: content.id, title: content.title, thumbnail_url: content.thumbnail_url, price: content.price, discount: 0, creator_name: content.creator?.display_name || "Criador" }}
            onPurchaseComplete={() => { setShowPurchaseModal(false); fetchContent(); }}
          />
          <AddToStudyModal open={showAddToStudyModal} onOpenChange={setShowAddToStudyModal} contentId={content.id} contentTitle={content.title} />
          <MobileCommentsSheet open={showMobileComments} onOpenChange={setShowMobileComments} contentId={content.id} />
          <MobileNotesSheet open={showMobileNotes} onOpenChange={setShowMobileNotes} contentId={content.id} onSeekTo={setSeekToTime} refreshTrigger={notesRefreshTrigger} />

          {/* Video Player - Full width, sticky top */}
          <div className="sticky top-0 z-40 bg-black">
            <MobileVideoPlayer
              src={isCourse && currentLesson ? currentLesson.video_url : content.file_url}
              poster={content.thumbnail_url}
              title={isCourse && currentLesson ? currentLesson.title : content.title}
              onTimeUpdate={handleTimeUpdate}
              onNoteClick={() => setShowMobileNotes(true)}
              seekToTime={seekToTime}
              isPodcast={content.content_type === "podcast"}
            />
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-auto pb-20">
            <MobileWatchLayout
              content={content}
              followersCount={followersCount}
              isLiked={isLiked}
              isSaved={isSaved}
              isFavorited={isFavorited}
              likesCount={likesCount}
              onToggleLike={toggleLike}
              onToggleSave={toggleSave}
              onToggleFavorite={toggleFavorite}
              onAddToStudy={() => setShowAddToStudyModal(true)}
              onShowComments={() => setShowMobileComments(true)}
              relatedContents={relatedContents}
              onContentClick={(id) => navigate(`/watch/${id}`)}
            />
          </div>
        </div>
      </MobileWatchOverlay>
    );
  }

  // Desktop layout
  return (
    <div className="min-h-screen flex w-full bg-background">
      <AppSidebar />

      <div className="flex-1 flex flex-col">
        <Header />

          <UpgradeModal open={showUpgradeModal} onOpenChange={setShowUpgradeModal} requiredPlan={requiredUpgradePlan} />

          {content && (
            <PurchaseModal
              open={showPurchaseModal}
              onOpenChange={setShowPurchaseModal}
              content={{
                id: content.id,
                title: content.title,
                thumbnail_url: content.thumbnail_url,
                price: content.price,
                discount: 0,
                creator_name: content.creator?.display_name || "Criador",
              }}
              onPurchaseComplete={() => {
                setShowPurchaseModal(false);
                fetchContent();
              }}
            />
          )}

          <AddToStudyModal
            open={showAddToStudyModal}
            onOpenChange={setShowAddToStudyModal}
            contentId={content.id}
            contentTitle={content.title}
          />

          <main className="flex-1 overflow-auto">
            <div className="w-full">
              <div className={`flex gap-4 sm:gap-6 p-3 sm:p-6 ${theaterMode ? 'flex-col' : 'flex-col lg:flex-row'}`}>
                <div className={`min-w-0 space-y-3 sm:space-y-4 ${theaterMode ? 'w-full' : 'flex-1'}`}>
                  {isCourse && currentLesson ? (
                    <WatchVideoPlayer
                      content={{
                        id: currentLesson.id, // ID interno da lesson
                        title: currentLesson.title,
                        file_url: currentLesson.video_url || "",
                        thumbnail_url: content.thumbnail_url,
                        content_type: "aula" as any,
                        duration_seconds: currentLesson.duration_seconds || 0,
                        content_id: currentLesson.content_id || null, // FK real para contents.id (quando existir)
                        lesson_id: currentLesson.id, // ID da lesson para salvar notas
                      }}
                      onTimeUpdate={handleTimeUpdate}
                      onCreateNote={() => setNotesRefreshTrigger((prev) => prev + 1)}
                      seekToTime={seekToTime}
                      theaterMode={theaterMode}
                      onTheaterModeToggle={handleTheaterModeToggle}
                    />
                  ) : !isCourse ? (
                    <WatchVideoPlayer
                      content={{
                        id: content.id,
                        title: content.title,
                        file_url: content.file_url,
                        thumbnail_url: content.thumbnail_url,
                        content_type: content.content_type,
                        duration_seconds: content.duration_seconds,
                        content_id: content.id, // aqui sempre existe em contents
                      }}
                      onTimeUpdate={handleTimeUpdate}
                      onCreateNote={() => setNotesRefreshTrigger((prev) => prev + 1)}
                      seekToTime={seekToTime}
                      theaterMode={theaterMode}
                      onTheaterModeToggle={handleTheaterModeToggle}
                    />
                  ) : null}

                  {/* Title */}
                  <div className="flex items-start sm:items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                    <h1 className="text-lg sm:text-xl font-bold">
                      {isCourse && currentLesson ? currentLesson.title : content.title}
                    </h1>
                    {content.status === "pending" && role === "admin" && (
                      <Badge
                        variant="outline"
                        className="flex items-center gap-1 border-yellow-500 text-yellow-600 dark:text-yellow-400"
                      >
                        <AlertCircle className="h-3 w-3" />
                        PENDENTE
                      </Badge>
                    )}
                    {isCourse && <Badge variant="secondary">CURSO</Badge>}
                  </div>

                  {/* Creator Row + Actions - YouTube Style */}
                  {content.status === "pending" && role === "admin" ? (
                    <div className="flex gap-2 mb-4">
                      <Button onClick={handleApprove} className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4" />
                        Aprovar Conteúdo
                      </Button>
                      <Button onClick={handleReject} variant="destructive" className="flex items-center gap-2">
                        <XCircle className="h-4 w-4" />
                        Reprovar Conteúdo
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between flex-wrap gap-3 sm:gap-4 py-2 sm:py-3">
                      {/* Left - Creator info */}
                      <div className="flex items-center gap-2 sm:gap-3">
                        <Avatar className="h-8 w-8 sm:h-10 sm:w-10">
                          <AvatarImage src={content.creator?.avatar_url || ""} />
                          <AvatarFallback>{content.creator?.display_name?.[0] || "C"}</AvatarFallback>
                        </Avatar>
                        <div className="mr-1 sm:mr-2">
                          <p className="font-semibold text-xs sm:text-sm">{content.creator?.display_name || "Criador"}</p>
                          <p className="text-[10px] sm:text-xs text-muted-foreground">{followersCount} seguidores</p>
                        </div>
                        {content.creator?.id && <FollowButton creatorId={content.creator.id} size="sm" />}
                      </div>

                      {/* Right - Actions */}
                      <div className="w-full sm:w-auto overflow-x-auto scrollbar-hide -mx-3 px-3 sm:mx-0 sm:px-0">
                        <ContentActions 
                          contentId={content.id} 
                          isCourse={isCourse}
                          contentTitle={content.title}
                          onAddToStudy={() => setShowAddToStudyModal(true)}
                        />
                      </div>
                    </div>
                  )}

                  {/* Collapsible Description Card - YouTube Style */}
                  <div 
                    className="bg-secondary/50 rounded-lg sm:rounded-xl p-2.5 sm:p-3 cursor-pointer hover:bg-secondary/70 transition-colors"
                    onClick={() => setDescExpanded(!descExpanded)}
                  >
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">
                      {formatCount(content.views_count || 0)} visualizações • {formatDistanceToNow(new Date(content.created_at || Date.now()), { addSuffix: true, locale: ptBR })}
                      {content.tags && content.tags.length > 0 && (
                        <span className="ml-2">
                          {content.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')}
                        </span>
                      )}
                    </p>
                    <div className={`text-xs sm:text-sm ${!descExpanded ? 'line-clamp-2' : ''}`}>
                      {isCourse && currentLesson && currentLesson.description && (
                        <p className="mb-2">{currentLesson.description}</p>
                      )}
                      {content.description && <p>{content.description}</p>}
                      {descExpanded && isCourse && content.what_you_learn && (
                        <div className="mt-4 pt-4 border-t border-border">
                          <h4 className="font-semibold mb-2">O que você vai aprender</h4>
                          <p className="text-muted-foreground">{content.what_you_learn}</p>
                        </div>
                      )}
                      {descExpanded && isCourse && content.requirements && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-2">Requisitos</h4>
                          <p className="text-muted-foreground">{content.requirements}</p>
                        </div>
                      )}
                    </div>
                    {!descExpanded && (content.description || (isCourse && currentLesson?.description)) && (
                      <span className="text-xs sm:text-sm font-semibold mt-1 inline-block">...mais</span>
                    )}
                  </div>

                  {!isCourse && <ContentComments contentId={content.id} />}
                </div>

                <div className={`shrink-0 space-y-4 ${theaterMode ? 'w-full grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6' : 'w-full lg:w-80 xl:w-96'}`}>
                  {isCourse ? (
                    <>
                      <WatchNotes
                        contentId={currentLesson?.content_id || null}
                        courseId={content.id}
                        currentLessonId={currentLesson?.id}
                        onSeekTo={(seconds) => setSeekToTime(seconds)}
                        onLessonChange={(lessonId) => {
                          // Encontrar a lesson pelo ID e trocar
                          const lesson = courseModules
                            .flatMap(m => m.lessons)
                            .find(l => l.id === lessonId);
                          if (lesson) {
                            setCurrentLesson(lesson);
                          }
                        }}
                        refreshTrigger={notesRefreshTrigger}
                        key={currentLesson?.id}
                      />
                      
                      <CourseCurriculum
                        modules={courseModules}
                        currentLesson={currentLesson}
                        onLessonSelect={setCurrentLesson}
                        hasAccess={hasAccess}
                      />
                    </>
                  ) : (
                    <>
                      <WatchNotes
                        contentId={content.id}
                        onSeekTo={(seconds) => setSeekToTime(seconds)}
                        refreshTrigger={notesRefreshTrigger}
                      />

                      <WatchRelated
                        contentId={content.id}
                        categoryId={content.category_id}
                        tags={content.tags}
                        contentType={content.content_type}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>
          </main>
      </div>
    </div>
  );
}

export default function Watch() {
  return (
    <SidebarProvider defaultOpen={true}>
      <WatchContent />
    </SidebarProvider>
  );
}
