import { useParams, Navigate, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { useContentMetrics } from "@/hooks/useContentMetrics";
import { useContentActions } from "@/hooks/useContentActions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CheckCircle, XCircle, AlertCircle, Loader2, X } from "lucide-react";
import { ContentComments } from "@/components/ContentComments";
import { FollowButton } from "@/components/FollowButton";
import { AddToStudyModal } from "@/components/AddToStudyModal";
import { UnifiedVideoPlayer } from "@/components/unified/UnifiedVideoPlayer";
import { SocialBar } from "@/components/unified/SocialBar";
import { StudyToolbar, ToolPanel } from "@/components/unified/StudyToolbar";
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
import { AccessBlockedOverlay } from "@/components/watch/AccessBlockedOverlay";
import { AutoplayNextOverlay } from "@/components/watch/AutoplayNextOverlay";
import { ptBR } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileVideoPlayer } from "@/components/watch/MobileVideoPlayer";
import { MobileWatchLayout } from "@/components/watch/MobileWatchLayout";
import { MobileCommentsSheet } from "@/components/watch/MobileCommentsSheet";
import { MobileNotesSheet } from "@/components/watch/MobileNotesSheet";
import { MobileWatchOverlay } from "@/components/watch/MobileWatchOverlay";
import { MobileCurriculumSheet } from "@/components/watch/MobileCurriculumSheet";
import { StudyQuiz } from "@/components/StudyQuiz";
import { StudyNotes } from "@/components/StudyNotes";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

interface Content {
  id: string;
  content_type: "aula" | "short" | "podcast" | "curso" | "live";
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
   const [accessBlockedReason, setAccessBlockedReason] = useState<"plan" | "purchase" | null>(null);
  const [isPurchased, setIsPurchased] = useState(false);
  const [showAddToStudyModal, setShowAddToStudyModal] = useState(false);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState(0);
  const [seekToTime, setSeekToTime] = useState<number | null>(null);
  const { processReward, handleLike, handleSave, handleFavorite, reverseReward } = useRewardSystem();
  
  // Track current playback time for mini player
  const currentPlaybackTime = useRef(0);

  // Autoplay next video state
  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [nextContent, setNextContent] = useState<any>(null);
  const [autoplayCancelled, setAutoplayCancelled] = useState(false);

  // Theater mode state
  const [theaterMode, setTheaterMode] = useState(false);
  const previousSidebarState = useRef(true);
  
  // Study toolbar state
  const [activeStudyPanel, setActiveStudyPanel] = useState<ToolPanel>(null);
  const [transcription, setTranscription] = useState<string>("");
  const [transcriptionLoading, setTranscriptionLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
  const [showMobileCurriculum, setShowMobileCurriculum] = useState(false);
  const [relatedContents, setRelatedContents] = useState<any[]>([]);

  // Action states for mobile
  const [isLiked, setIsLiked] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [unlikeConfirmation, setUnlikeConfirmation] = useState<{ pending: boolean; rewardValue: number }>({
    pending: false,
    rewardValue: 0,
  });

  // Centralized content metrics hook — replaces inline metric tracking
  const {
    handleTimeUpdate: handleMetricsTimeUpdate,
    registerView,
    registerCourseView,
    resetMetrics,
    metricsRecorded,
  } = useContentMetrics({
    contentId: id || "",
    duration: content?.duration_seconds || 0,
  });

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
            creator:profiles!creator_id(id, display_name, avatar_url, creator_channel_name)
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
            creator:profiles!creator_id(id, display_name, avatar_url, creator_channel_name)
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
    
    const [likeData, savedData, favoriteData] = await Promise.all([
      supabase.from('actions').select('id').eq('user_id', user.id).eq('type', 'LIKE').eq(isCourse ? 'course_id' : 'content_id', content.id).maybeSingle(),
      supabase.from('saved_contents').select('id').eq('user_id', user.id).eq(isCourse ? 'course_id' : 'content_id', content.id).maybeSingle(),
      supabase.from('favorites').select('id').eq('user_id', user.id).eq(isCourse ? 'course_id' : 'content_id', content.id).maybeSingle(),
    ]);
    
    setIsLiked(!!likeData.data);
    setIsSaved(!!savedData.data);
    setIsFavorited(!!favoriteData.data);
    // Use likes_count from content (synced by database trigger)
    setLikesCount(content.likes_count || 0);
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

  // Refresh likes count from database (single source of truth)
  const refreshLikesCount = async () => {
    if (!content) return;

    const table = isCourse ? "courses" : "contents";
    const { data } = await supabase
      .from(table)
      .select("likes_count")
      .eq("id", content.id)
      .single();

    if (data) {
      const count = data.likes_count || 0;
      setLikesCount(count);
      setContent((prev) => (prev ? { ...prev, likes_count: count } : prev));
    }
  };

  // DB trigger update can be slightly async; refresh a few times to converge
  const refreshLikesCountEventually = async () => {
    // wait a bit for DB trigger to update counts
    await new Promise((r) => setTimeout(r, 250));
    await refreshLikesCount();
    await new Promise((r) => setTimeout(r, 250));
    await refreshLikesCount();
  };

  const getLikeRewardPoints = async (): Promise<number> => {
    if (!user || !content) return 0;

    const { data, error } = await supabase
      .from("reward_events")
      .select("performance_points, created_at")
      .eq("user_id", user.id)
      .eq("content_id", content.id)
      .eq("action_key", "LIKE_CONTENT")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return 0;
    return data?.performance_points || 0;
  };

  const performUnlike = async () => {
    if (!user || !content) return;

    const { data: deleted, error } = await supabase
      .from("actions")
      .delete()
      .eq("user_id", user.id)
      .eq("type", "LIKE")
      .eq(isCourse ? "course_id" : "content_id", content.id)
      .select("id");

    if (!error) {
      setIsLiked(false);
      if ((deleted?.length || 0) > 0) {
        setLikesCount((prev) => Math.max(0, prev - 1));
      }
    }

    await refreshLikesCountEventually();
  };

  const confirmUnlike = async () => {
    if (!user || !content || !unlikeConfirmation.pending) return;

    try {
      await reverseReward(user.id, content.id, "LIKE_CONTENT");
      await performUnlike();

      toast.success("Like removido. Performance Points deduzidos.");
    } finally {
      setUnlikeConfirmation({ pending: false, rewardValue: 0 });
    }
  };

  const cancelUnlike = () => {
    setUnlikeConfirmation({ pending: false, rewardValue: 0 });
  };

  const toggleLike = async () => {
    if (!user || !content) return;

    try {
      if (isLiked) {
        const rewardPoints = await getLikeRewardPoints();
        console.log("[toggleLike] attempting unlike", {
          contentId: content.id,
          hasReward: rewardPoints > 0,
          rewardPoints,
        });

        if (rewardPoints > 0) {
          setUnlikeConfirmation({ pending: true, rewardValue: rewardPoints });
          return;
        }

        await performUnlike();
        return;
      }

      // Add like
      const { error } = await supabase.from("actions").insert({
        user_id: user.id,
        type: "LIKE",
        [isCourse ? "course_id" : "content_id"]: content.id,
      });

      if (!error) {
        setIsLiked(true);
        setLikesCount((prev) => prev + 1);
        if (hasAccess) {
          await handleLike(user.id, content.id, true);
        }
      } else if (error.code === "23505") {
        setIsLiked(true);
      }

      await refreshLikesCountEventually();
    } catch (error) {
      console.error("Error toggling like:", error);
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
    // Reset access state
    setAccessBlockedReason(null);
    
    if (!profile || !user) {
      // User not logged in - block access for non-free content
      if (content.visibility !== "free") {
        setHasAccess(false);
        if (content.visibility === "paid") {
          setAccessBlockedReason("purchase");
        } else {
          setAccessBlockedReason("plan");
          setRequiredUpgradePlan(content.visibility === "premium" ? "premium" : "pro");
        }
      } else {
        setHasAccess(true);
      }
      return;
    }

    // Admins always have access
    if (role === "admin") {
      setHasAccess(true);
      return;
    }

    // Creator always has access to own content
    if (content.creator_id === user.id) {
      setHasAccess(true);
      return;
    }

    const userPlan = profile.plan || "free";

    // Check if content is paid and user has purchased/enrolled
    if (content.visibility === "paid") {
      if (isCourse) {
        // For courses, check enrollment instead of purchased_contents
        const { data: enrollment } = await supabase
          .from("course_enrollments")
          .select("id")
          .eq("user_id", user.id)
          .eq("course_id", content.id)
          .maybeSingle();

        if (enrollment) {
          setIsPurchased(true);
          setHasAccess(true);
          return;
        }
      } else {
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
        }
      }

      setIsPurchased(false);
      setHasAccess(false);
      setAccessBlockedReason("purchase");
      return;
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
        setAccessBlockedReason("plan");
      }
    } else if (content.visibility === "premium") {
      if (userPlan === "premium") {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan("premium");
        setAccessBlockedReason("plan");
      }
    } else {
      setHasAccess(false);
    }
  };

  // Unified time update handler — delegates to centralized hook
  const handleTimeUpdate = async (currentTime: number) => {
    if (!content || !user) return;
    
    // Store current time for mini player
    currentPlaybackTime.current = currentTime;

    // Delegate all metric tracking to the centralized hook
    await handleMetricsTimeUpdate(currentTime);
  };

  // Handle video end - show autoplay overlay
  const handleVideoEnd = () => {
    if (nextContent && !isCourse && !autoplayCancelled) {
      setShowAutoplayOverlay(true);
    }
  };

  // Pick next content from related list once it's available
  useEffect(() => {
    if (!content || isCourse) return;
    // Reset autoplay state when content changes
    setShowAutoplayOverlay(false);
    setAutoplayCancelled(false);
    setNextContent(null);
  }, [content?.id, isCourse]);

  // Update nextContent whenever relatedContents changes
  useEffect(() => {
    if (relatedContents.length > 0) {
      setNextContent(relatedContents[0]);
    } else {
      setNextContent(null);
    }
  }, [relatedContents]);

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

  // Load transcription for study tools
  const loadTranscription = async (contentId: string) => {
    setTranscriptionLoading(true);
    try {
      const { data } = await supabase
        .from("transcriptions")
        .select("text")
        .eq("content_id", contentId)
        .maybeSingle();
      setTranscription(data?.text || "");
    } catch (error) {
      console.error("Error loading transcription:", error);
    } finally {
      setTranscriptionLoading(false);
    }
  };

  // Generate transcription manually
  const generateTranscription = async () => {
    if (!content) return;
    setTranscriptionLoading(true);
    try {
      const { error } = await supabase.functions.invoke("transcribe-content", {
        body: { contentId: content.id },
      });
      if (error) throw error;
      toast.success("Transcrição sendo gerada. Aguarde alguns minutos.");
    } catch (error) {
      console.error("Error generating transcription:", error);
      toast.error("Erro ao gerar transcrição");
    } finally {
      setTranscriptionLoading(false);
    }
  };

  // Highlight search results in transcription
  const highlightSearchResults = (text: string, query: string) => {
    if (!query.trim()) return text;
    const regex = new RegExp(`(${query})`, "gi");
    return text.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">$1</mark>');
  };

  // Load transcription when panel opens
  useEffect(() => {
    if (activeStudyPanel === 'transcription' && content) {
      loadTranscription(content.id);
    }
  }, [activeStudyPanel, content?.id]);

// Debug logs
  console.log("🎬 Watch render - loading:", loading, "loadingContent:", loadingContent, "user:", !!user, "content:", !!content);

  // First check auth loading - if auth is still loading, show loader
  if (loading) {
    console.log("⏳ Showing loader: auth loading");
    return <GlobalLoader />;
  }

  // Show content loader while fetching content
  if (loadingContent) {
    console.log("⏳ Showing loader: content loading");
    return <GlobalLoader />;
  }

  // Check if content exists
  if (!content) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Conteúdo não encontrado</h2>
          <p className="text-muted-foreground">O conteúdo que você está procurando não existe ou foi removido.</p>
        </Card>
      </div>
    );
  }

  // If no user and content is not free, redirect to auth
  if (!user && content.visibility !== "free") {
    console.log("🚪 Redirecting to /auth - restricted content requires login");
    return <Navigate to="/auth" replace />;
  }
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
        {/* First child: Player area (or blocked overlay) */}
        <div className="bg-black">
          {!hasAccess && accessBlockedReason ? (
            <AccessBlockedOverlay
              reason={accessBlockedReason}
              requiredPlan={requiredUpgradePlan}
              price={content.price}
              thumbnail={content.thumbnail_url}
              onUpgradeClick={() => setShowUpgradeModal(true)}
              onPurchaseClick={() => setShowPurchaseModal(true)}
            />
          ) : (
            <MobileVideoPlayer
              src={isCourse && currentLesson ? currentLesson.video_url : content.file_url}
              poster={content.thumbnail_url}
              title={isCourse && currentLesson ? currentLesson.title : content.title}
              artist={content.creator?.display_name}
              onTimeUpdate={handleTimeUpdate}
              onNoteClick={() => setShowMobileNotes(true)}
              onMinimize={handleMinimize}
              seekToTime={seekToTime}
              isPodcast={content.content_type === "podcast"}
            />
          )}
        </div>

        {/* Rest of children: Scrollable content area */}
        <>
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
          <MobileCurriculumSheet 
            open={showMobileCurriculum} 
            onOpenChange={setShowMobileCurriculum} 
            modules={courseModules}
            currentLesson={currentLesson}
            onLessonSelect={setCurrentLesson}
            hasAccess={hasAccess}
          />
          
          {/* Study Tool Sheets */}
          <Sheet open={activeStudyPanel === 'transcription'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl p-0 flex flex-col">
              <SheetHeader className="px-4 py-3 border-b flex-row items-center justify-between">
                <SheetTitle className="text-base font-semibold">Transcrição</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-auto p-4">
                {transcriptionLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : transcription ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                    {transcription}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <p className="text-muted-foreground text-sm mb-4">Transcrição não disponível</p>
                    <Button onClick={generateTranscription} disabled={transcriptionLoading}>
                      Gerar Transcrição
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={activeStudyPanel === 'quiz'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl p-0 flex flex-col">
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="text-base font-semibold">Quiz</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-auto p-4">
                <StudyQuiz 
                  studyId={content.id} 
                  contentId={content.id}
                  contentTitle={content.title}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={activeStudyPanel === 'notes'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl p-0 flex flex-col">
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="text-base font-semibold">Anotações</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-auto">
                <StudyNotes
                  studyId={content.id}
                  activeContentId={content.id}
                  onSeekToTimestamp={(time) => {
                    setSeekToTime(time);
                    setActiveStudyPanel(null);
                  }}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Sheet open={activeStudyPanel === 'recommendations'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl p-0 flex flex-col">
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="text-base font-semibold">Sugestões</SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-auto p-4">
                <WatchRelated 
                  contentId={content.id}
                  categoryId={content.category_id}
                  tags={content.tags}
                  contentType={content.content_type as "aula" | "short" | "podcast" | "curso"}
                />
              </div>
            </SheetContent>
          </Sheet>

          <div className="pb-20">
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
              unlikeConfirmation={unlikeConfirmation}
              onConfirmUnlike={confirmUnlike}
              onCancelUnlike={cancelUnlike}
              onAddToStudy={() => setShowAddToStudyModal(true)}
              onShowComments={() => setShowMobileComments(true)}
              onShowCurriculum={() => setShowMobileCurriculum(true)}
              onShowStudyTool={(panel) => setActiveStudyPanel(panel)}
              isCourse={isCourse}
              totalLessons={courseModules.reduce((acc, mod) => acc + (mod.lessons?.length || 0), 0)}
              relatedContents={relatedContents}
              onContentClick={(nextId) =>
                navigate(`/watch/${nextId}`, {
                  state: {
                    backgroundLocation: (location.state as any)?.backgroundLocation ?? location,
                  },
                })
              }
            />
          </div>
        </>
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
                  {/* Study Toolbar */}
                  <div className="flex items-center gap-2 bg-card/50 backdrop-blur-sm border border-border rounded-lg p-2">
                    <StudyToolbar
                      activePanel={activeStudyPanel}
                      onPanelChange={setActiveStudyPanel}
                      disabled={!hasAccess}
                    />
                  </div>

                  {/* Access Blocked Overlay - shown when user doesn't have access */}
                  {!hasAccess && accessBlockedReason ? (
                    <AccessBlockedOverlay
                      reason={accessBlockedReason}
                      requiredPlan={requiredUpgradePlan}
                      price={content.price}
                      thumbnail={content.thumbnail_url}
                      onUpgradeClick={() => setShowUpgradeModal(true)}
                      onPurchaseClick={() => setShowPurchaseModal(true)}
                    />
                  ) : isCourse && currentLesson ? (
                    <UnifiedVideoPlayer
                      content={{
                        id: currentLesson.id,
                        title: currentLesson.title,
                        file_url: currentLesson.video_url || "",
                        thumbnail_url: content.thumbnail_url,
                        content_type: "aula" as const,
                        duration_seconds: currentLesson.duration_seconds || 0,
                        content_id: currentLesson.content_id || null,
                        lesson_id: currentLesson.id,
                      }}
                      mode="watch"
                      onTimeUpdate={handleTimeUpdate}
                      onNoteCreated={() => setNotesRefreshTrigger((prev) => prev + 1)}
                      seekToTime={seekToTime}
                      theaterMode={theaterMode}
                      onTheaterModeToggle={handleTheaterModeToggle}
                    />
                  ) : !isCourse ? (
                    <div className="relative">
                      <UnifiedVideoPlayer
                        content={{
                          id: content.id,
                          title: content.title,
                          file_url: content.file_url,
                          thumbnail_url: content.thumbnail_url,
                          content_type: content.content_type,
                          duration_seconds: content.duration_seconds,
                          content_id: content.id,
                        }}
                        mode="watch"
                        onTimeUpdate={handleTimeUpdate}
                        onVideoEnded={handleVideoEnd}
                        onNoteCreated={() => setNotesRefreshTrigger((prev) => prev + 1)}
                        seekToTime={seekToTime}
                        theaterMode={theaterMode}
                        onTheaterModeToggle={handleTheaterModeToggle}
                      />
                      {/* Autoplay Next Overlay */}
                      <AutoplayNextOverlay
                        nextContent={nextContent}
                        show={showAutoplayOverlay}
                        onCancel={() => { setShowAutoplayOverlay(false); setAutoplayCancelled(true); }}
                      />
                    </div>
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
                    <div className="py-2 sm:py-3">
                      <SocialBar
                        contentId={content.id}
                        isCourse={isCourse}
                        contentTitle={content.title}
                        contentThumbnail={content.thumbnail_url || undefined}
                        creator={content.creator ? {
                          id: content.creator.id,
                          display_name: content.creator.display_name,
                          avatar_url: content.creator.avatar_url,
                          channel_name: content.creator.creator_channel_name
                        } : null}
                        followersCount={followersCount}
                        hasAccess={hasAccess}
                        onAddToStudy={() => setShowAddToStudyModal(true)}
                        showCreator={true}
                      />
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

          {/* Study Tool Panels - Sheets */}
          {/* Transcription Sheet */}
          <Sheet open={activeStudyPanel === 'transcription'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Transcrição</SheetTitle>
                <SheetDescription className="line-clamp-1">{content.title}</SheetDescription>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                {!transcription && !transcriptionLoading ? (
                  <div className="space-y-4">
                    <div className="text-muted-foreground text-sm">
                      <p>A transcrição deste conteúdo está sendo processada automaticamente.</p>
                      <p className="mt-2">
                        Isso acontece em segundo plano quando o conteúdo é aprovado. Recarregue a página em alguns minutos.
                      </p>
                    </div>
                    <Button onClick={generateTranscription} disabled={transcriptionLoading} variant="outline" size="sm">
                      Tentar Gerar Novamente
                    </Button>
                  </div>
                ) : transcriptionLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <p className="text-sm">Carregando transcrição...</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Buscar na transcrição..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex-1"
                      />
                      {searchQuery && (
                        <Button variant="ghost" size="icon" onClick={() => setSearchQuery("")}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="prose prose-sm max-w-none text-foreground">
                      <div 
                        dangerouslySetInnerHTML={{ 
                          __html: highlightSearchResults(transcription, searchQuery) 
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          {/* Quiz Sheet */}
          <Sheet open={activeStudyPanel === 'quiz'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Quiz</SheetTitle>
                <SheetDescription className="line-clamp-1">Teste seus conhecimentos</SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <StudyQuiz 
                  studyId={content.id}
                  contentId={content.id}
                  contentTitle={content.title}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* Notes Sheet */}
          <Sheet open={activeStudyPanel === 'notes'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Anotações</SheetTitle>
                <SheetDescription>Suas anotações de estudo</SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <StudyNotes
                  studyId={content.id}
                  activeContentId={content.id}
                  onSeekToTimestamp={(time) => setSeekToTime(time)}
                  key={notesRefreshTrigger}
                />
              </div>
            </SheetContent>
          </Sheet>

          {/* Comments Sheet */}
          <Sheet open={activeStudyPanel === 'comments'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Comentários</SheetTitle>
                <SheetDescription className="line-clamp-1">Discussões sobre {content.title}</SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <ContentComments contentId={content.id} />
              </div>
            </SheetContent>
          </Sheet>

          {/* Recommendations Sheet */}
          <Sheet open={activeStudyPanel === 'recommendations'} onOpenChange={(open) => !open && setActiveStudyPanel(null)}>
            <SheetContent side="right" className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Recomendações</SheetTitle>
                <SheetDescription>Conteúdos relacionados</SheetDescription>
              </SheetHeader>
              <div className="mt-6">
                <WatchRelated
                  contentId={content.id}
                  categoryId={content.category_id}
                  tags={content.tags}
                  contentType={content.content_type}
                />
              </div>
            </SheetContent>
          </Sheet>
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
