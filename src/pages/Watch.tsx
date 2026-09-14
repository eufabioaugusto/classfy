import {
  useParams,
  Navigate,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMiniPlayer } from "@/contexts/MiniPlayerContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
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
import { ContentRewardProgress } from "@/components/watch/ContentRewardProgress";
import {
  evaluateContentEntitlement,
  type ContentEntitlement,
} from "@/lib/access/contentEntitlement";
import { StudyQuiz } from "@/components/StudyQuiz";
import { StudyNotes } from "@/components/StudyNotes";
import { HighlightedText } from "@/components/chat/HighlightedText";
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
  is_curated?: boolean;
  attribution_text?: string | null;
  license_type?: string | null;
  source_url?: string | null;
  media_asset_id?: string | null;
  video_provider?: string | null;
  bunny_video_id?: string | null;
  bunny_library_id?: string | null;
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

interface NextContent {
  id: string;
  title: string;
  thumbnail_url?: string | null;
  duration_seconds?: number | null;
  views_count?: number | null;
  visibility?: Content["visibility"] | null;
  price?: number | null;
  creator_id: string;
  creator?: { display_name?: string | null } | null;
}

interface NextContentAccess extends ContentEntitlement {
  checking: boolean;
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
  const {
    startMiniPlayer,
    closeMiniPlayer,
    state: miniPlayerState,
  } = useMiniPlayer();
  const locationState = (location.state || {}) as {
    studyId?: string;
    studyTitle?: string;
    study?: { id?: string; title?: string };
  };
  const searchParams = new URLSearchParams(location.search);
  const activeStudyId =
    searchParams.get("studyId") ||
    locationState.studyId ||
    locationState.study?.id ||
    null;
  const activeStudyTitle =
    searchParams.get("studyTitle") ||
    locationState.studyTitle ||
    locationState.study?.title ||
    null;
  const [content, setContent] = useState<Content | null>(null);
  const [loadingContent, setLoadingContent] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [requiredUpgradePlan, setRequiredUpgradePlan] = useState<
    "pro" | "premium"
  >("pro");
  const [accessBlockedReason, setAccessBlockedReason] = useState<
    "plan" | "purchase" | null
  >(null);
  const [isPurchased, setIsPurchased] = useState(false);
  const [showAddToStudyModal, setShowAddToStudyModal] = useState(false);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState(0);
  const [rewardRefreshTrigger, setRewardRefreshTrigger] = useState(0);
  const triggerRewardRefresh = () => setRewardRefreshTrigger((n) => n + 1);
  const [liveActionStates, setLiveActionStates] = useState({
    isLiked: false,
    isSaved: false,
    isFavorited: false,
  });
  const [seekToTime, setSeekToTime] = useState<number | null>(null);
  const {
    processReward,
    handleLike,
    handleSave,
    handleFavorite,
    reverseReward,
  } = useRewardSystem();

  // Track current playback time for mini player
  const currentPlaybackTime = useRef(0);

  // Autoplay next video state
  const [showAutoplayOverlay, setShowAutoplayOverlay] = useState(false);
  const [nextContent, setNextContent] = useState<NextContent | null>(null);
  const [nextContentAccess, setNextContentAccess] =
    useState<NextContentAccess>({
      checking: false,
      hasAccess: false,
      reason: null,
      requiredPlan: "pro",
    });
  const [autoplayCancelled, setAutoplayCancelled] = useState(false);
  const [purchaseTarget, setPurchaseTarget] = useState<NextContent | null>(null);

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
  const [unlikeConfirmation, setUnlikeConfirmation] = useState<{
    pending: boolean;
    rewardValue: number;
  }>({
    pending: false,
    rewardValue: 0,
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
        startMiniPlayer(
          {
            id: currentContent.id,
            title: currentContent.title,
            subtitle: currentContent.creator?.display_name,
            thumbnail_url: currentContent.thumbnail_url,
            file_url: currentContent.file_url,
            duration_seconds: currentContent.duration_seconds,
            creator: currentContent.creator
              ? { display_name: currentContent.creator.display_name }
              : undefined,
          },
          playbackTime,
        );
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
    setLoadingContent(true);
    setHasAccess(false);
    setAccessBlockedReason(null);
    setIsPurchased(false);

    try {
      // Fetch content and course in parallel for speed
      const [contentResult, courseResult] = await Promise.all([
        supabase
          .from("contents")
          .select(
            `
            id, content_type, title, description, file_url, thumbnail_url,
            visibility, price, duration_seconds, views_count, likes_count,
            status, creator_id, category_id, tags, created_at,
            is_curated, attribution_text, license_type, source_url,
            video_provider, bunny_library_id, bunny_video_id, media_asset_id,
            creator:profiles!creator_id(id, display_name, avatar_url, creator_channel_name)
          `,
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("courses")
          .select(
            `
            id, title, description, thumbnail_url, visibility, price,
            total_duration_seconds, views_count, likes_count, status,
            creator_id, tags, total_lessons, level, what_you_learn,
            requirements, created_at,
            creator:profiles!creator_id(id, display_name, avatar_url, creator_channel_name)
          `,
          )
          .eq("id", id)
          .maybeSingle(),
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
        await checkAccess(data, "content");

        // Register view in background (don't await)
        const isAdminPreview = role === "admin" && data.status === "pending";
        if (!isAdminPreview && user) {
          supabase
            .rpc("increment_content_view", {
              p_user_id: user.id,
              p_content_id: id,
            })
            .then(({ error }) => {
              if (error) console.error("Error registering view:", error);
            });
        }

        setLoadingContent(false);
        return;
      }

      // Handle course
      if (courseData) {
        if (
          role !== "admin" &&
          courseData.status !== "approved" &&
          courseData.creator_id !== user?.id
        ) {
          setContent(null);
          setLoadingContent(false);
          return;
        }

        // Fetch modules (needed for course display)
        const { data: modules } = await supabase
          .from("course_modules")
          .select(
            `*, lessons:course_lessons(*, content:contents(file_url, thumbnail_url, duration_seconds, video_provider, bunny_video_id, bunny_library_id, media_asset_id))`,
          )
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

        await checkAccess(courseData as any, "course");

        // Register view in background
        const isAdminPreview =
          role === "admin" && courseData.status === "pending";
        if (!isAdminPreview && user) {
          supabase
            .rpc("increment_course_view", {
              p_user_id: user.id,
              p_course_id: id,
            })
            .then(({ error }) => {
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
      supabase
        .from("actions")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "LIKE")
        .eq(isCourse ? "course_id" : "content_id", content.id)
        .maybeSingle(),
      supabase
        .from("saved_contents")
        .select("id")
        .eq("user_id", user.id)
        .eq(isCourse ? "course_id" : "content_id", content.id)
        .maybeSingle(),
      supabase
        .from("favorites")
        .select("id")
        .eq("user_id", user.id)
        .eq(isCourse ? "course_id" : "content_id", content.id)
        .maybeSingle(),
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
      .from("contents")
      .select(
        "id, title, thumbnail_url, duration_seconds, views_count, visibility, price, creator_id, creator:profiles!creator_id(display_name)",
      )
      .eq("status", "approved")
      .neq("id", content.id)
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

    let query = supabase
      .from("reward_events")
      .select("points, created_at")
      .eq("user_id", user.id)
      .eq("action_key", "LIKE")
      .order("created_at", { ascending: false })
      .limit(1);
    query = isCourse
      ? query.contains("metadata", { course_id: content.id })
      : query.eq("content_id", content.id);
    const { data, error } = await query.maybeSingle();

    if (error) return 0;
    return data?.points || 0;
  };

  const performUnlike = async () => {
    if (!user || !content) return;

    const reversal = await reverseReward(user.id, content.id, "LIKE");
    if (!reversal) throw new Error("Reward reversal failed");

    setIsLiked(false);
    if (reversal.action_removed) {
      setLikesCount((prev) => Math.max(0, prev - 1));
    }

    await refreshLikesCountEventually();
  };

  const confirmUnlike = async () => {
    if (!user || !content || !unlikeConfirmation.pending) return;

    try {
      const reversal = await reverseReward(user.id, content.id, "LIKE");
      if (!reversal) throw new Error("Reward reversal failed");
      setIsLiked(false);
      if (reversal.action_removed) {
        setLikesCount((prev) => Math.max(0, prev - 1));
      }
      await refreshLikesCountEventually();

      const revertedPoints = Number(reversal.points || 0);
      toast.success(
        revertedPoints > 0
          ? `Like removido. ${revertedPoints} Points deduzidos.`
          : "Like removido.",
      );
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
      setIsLiked(true);
      setLikesCount((prev) => prev + 1);
      const { error } = await supabase.from("actions").insert({
        user_id: user.id,
        type: "LIKE",
        [isCourse ? "course_id" : "content_id"]: content.id,
      });

      if (!error) {
        if (hasAccess) {
          await handleLike(user.id, content.id, true);
        }
      } else if (error.code === "23505") {
        setIsLiked(true);
      } else {
        setIsLiked(false);
        setLikesCount((prev) => Math.max(0, prev - 1));
        throw error;
      }

      await refreshLikesCountEventually();
    } catch (error) {
      console.error("Error toggling like:", error);
    }
  };

  const toggleSave = async () => {
    if (!user || !content) return;
    if (isSaved) {
      const reversal = await reverseReward(user.id, content.id, "SAVE");
      if (!reversal) throw new Error("Reward reversal failed");
      setIsSaved(false);
    } else {
      setIsSaved(true);
      const { error } = await supabase
        .from("saved_contents")
        .insert({
          user_id: user.id,
          [isCourse ? "course_id" : "content_id"]: content.id,
        });
      if (error) {
        setIsSaved(false);
        throw error;
      }
      await handleSave(user.id, content.id);
    }
  };

  const toggleFavorite = async () => {
    if (!user || !content) return;
    if (isFavorited) {
      const reversal = await reverseReward(user.id, content.id, "FAVORITE");
      if (!reversal) throw new Error("Reward reversal failed");
      setIsFavorited(false);
    } else {
      setIsFavorited(true);
      const { error } = await supabase
        .from("favorites")
        .insert({
          user_id: user.id,
          [isCourse ? "course_id" : "content_id"]: content.id,
        });
      if (error) {
        setIsFavorited(false);
        throw error;
      }
      await handleFavorite(user.id, content.id);
    }
  };

  // Log content fetch errors for debugging
  useEffect(() => {
    if (content && !content.creator) {
      console.warn(
        "⚠️ Content loaded but creator is null - possible RLS/network issue",
      );
    }
  }, [content]);

  const checkAccess = async (
    item: Content,
    itemType: "content" | "course",
  ) => {
    setHasAccess(false);
    setAccessBlockedReason(null);
    setIsPurchased(false);

    let purchased = false;

    if (user && item.visibility === "paid" && item.creator_id !== user.id) {
      if (itemType === "course") {
        const { data: enrollment } = await supabase
          .from("course_enrollments")
          .select("id")
          .eq("user_id", user.id)
          .eq("course_id", item.id)
          .maybeSingle();
        purchased = Boolean(enrollment);
      } else {
        const { data: purchase } = await supabase
          .from("purchased_contents")
          .select("id")
          .eq("user_id", user.id)
          .eq("content_id", item.id)
          .in("status", ["confirmed", "legacy_confirmed"])
          .maybeSingle();
        purchased = Boolean(purchase);
      }
    }

    const entitlement = evaluateContentEntitlement({
      visibility: item.visibility,
      userPlan: profile?.plan,
      isAuthenticated: Boolean(user),
      isOwner: Boolean(user && item.creator_id === user.id),
      isAdmin: role === "admin",
      isModerationPreview: role === "admin" && item.status !== "approved",
      isPurchased: purchased,
    });

    setIsPurchased(purchased);
    setHasAccess(entitlement.hasAccess);
    setRequiredUpgradePlan(entitlement.requiredPlan);
    setAccessBlockedReason(
      entitlement.reason === "plan" || entitlement.reason === "purchase"
        ? entitlement.reason
        : null,
    );

    return entitlement;
  };

  // Unified time update handler — delegates to centralized hook
  const handleTimeUpdate = (currentTime: number) => {
    if (!content || !user) return;

    // Store current time for mini player
    currentPlaybackTime.current = currentTime;
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
      setNextContentAccess({
        checking: true,
        hasAccess: false,
        reason: null,
        requiredPlan: "pro",
      });
      setNextContent(relatedContents[0]);
    } else {
      setNextContent(null);
      setNextContentAccess({
        checking: false,
        hasAccess: false,
        reason: null,
        requiredPlan: "pro",
      });
    }
  }, [relatedContents]);

  useEffect(() => {
    let active = true;

    const resolveNextContentAccess = async () => {
      if (!nextContent) return;

      setNextContentAccess((current) => ({
        ...current,
        checking: true,
        hasAccess: false,
      }));

      let purchased = false;
      if (
        user &&
        nextContent.visibility === "paid" &&
        nextContent.creator_id !== user.id
      ) {
        const { data: purchase } = await supabase
          .from("purchased_contents")
          .select("id")
          .eq("user_id", user.id)
          .eq("content_id", nextContent.id)
          .in("status", ["confirmed", "legacy_confirmed"])
          .maybeSingle();
        purchased = Boolean(purchase);
      }

      const entitlement = evaluateContentEntitlement({
        visibility: nextContent.visibility,
        userPlan: profile?.plan,
        isAuthenticated: Boolean(user),
        isOwner: Boolean(user && nextContent.creator_id === user.id),
        isAdmin: role === "admin",
        isModerationPreview: false,
        isPurchased: purchased,
      });

      if (active) {
        setNextContentAccess({ ...entitlement, checking: false });
      }
    };

    void resolveNextContentAccess();
    return () => {
      active = false;
    };
  }, [nextContent, profile?.plan, role, user]);

  const handleFindAccessibleContent = () => {
    setShowAutoplayOverlay(false);
    setAutoplayCancelled(true);

    const alternative = relatedContents.find((item) => {
      if (item.id === nextContent?.id || item.visibility === "paid") {
        return false;
      }
      return evaluateContentEntitlement({
        visibility: item.visibility,
        userPlan: profile?.plan,
        isAuthenticated: Boolean(user),
        isOwner: Boolean(user && item.creator_id === user.id),
        isAdmin: role === "admin",
        isModerationPreview: false,
      }).hasAccess;
    });

    navigate(alternative ? `/watch/${alternative.id}` : "/?mode=explore");
  };

  const openCurrentPurchase = () => {
    setPurchaseTarget(null);
    setShowPurchaseModal(true);
  };

  const openNextPurchase = () => {
    if (!nextContent) return;
    setPurchaseTarget(nextContent);
    setShowPurchaseModal(true);
  };

  const handlePurchaseModalChange = (open: boolean) => {
    setShowPurchaseModal(open);
    if (!open) setPurchaseTarget(null);
  };

  const handlePurchaseComplete = () => {
    const purchasedNextId = purchaseTarget?.id;
    setShowPurchaseModal(false);
    setPurchaseTarget(null);

    if (purchasedNextId) {
      navigate(`/watch/${purchasedNextId}`);
      return;
    }

    void fetchContent();
  };

  const handleApprove = async () => {
    if (!content) return;

    try {
      // Check if admin
      if (role !== "admin") {
        toast.error("Apenas administradores podem aprovar conteúdo.");
        return;
      }
      const reason = window.prompt("Motivo da aprovação (obrigatório):");
      if (!reason?.trim()) return;

      // Update content status using service role through edge function
      const { data: updateData, error: updateError } =
        await supabase.functions.invoke("approve-content", {
          body: { contentId: id, itemType: "content", reason: reason.trim() },
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
      const reason = window.prompt("Motivo da reprovação (obrigatório):");
      if (!reason?.trim()) return;

      // Update content status using service role through edge function
      const { data: updateData, error: updateError } =
        await supabase.functions.invoke("reject-content", {
          body: { contentId: id, itemType: "content", reason: reason.trim() },
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

  // Load transcription when panel opens
  useEffect(() => {
    if (activeStudyPanel === "transcription" && content) {
      loadTranscription(content.id);
    }
  }, [activeStudyPanel, content?.id]);

  // Debug logs
  console.log(
    "🎬 Watch render - loading:",
    loading,
    "loadingContent:",
    loadingContent,
    "user:",
    !!user,
    "content:",
    !!content,
  );

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
          <p className="text-muted-foreground">
            O conteúdo que você está procurando não existe ou foi removido.
          </p>
        </Card>
      </div>
    );
  }

  // Toda reproducao na Classfy exige sessao, inclusive conteudo Free.
  if (!user) {
    console.log("🚪 Redirecting to /auth - Classfy content requires login");
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
          file_url:
            isCourse && currentLesson
              ? currentLesson.video_url
              : content.file_url,
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
              onPurchaseClick={openCurrentPurchase}
            />
          ) : (
            <MobileVideoPlayer
              key={isCourse && currentLesson ? currentLesson.id : content.id}
              src={
                isCourse && currentLesson
                  ? currentLesson.video_url
                  : content.file_url
              }
              poster={content.thumbnail_url}
              title={
                isCourse && currentLesson ? currentLesson.title : content.title
              }
              artist={content.creator?.display_name}
              onTimeUpdate={handleTimeUpdate}
              onNoteClick={() => setShowMobileNotes(true)}
              onMinimize={handleMinimize}
              seekToTime={seekToTime}
              isPodcast={content.content_type === "podcast"}
              mediaAssetId={
                isCourse && currentLesson
                  ? currentLesson.media_asset_id ||
                    currentLesson.content?.media_asset_id
                  : content.media_asset_id
              }
              videoProvider={
                isCourse && currentLesson
                  ? currentLesson.content?.video_provider
                  : content.video_provider
              }
              contentId={isCourse ? null : content.id}
              courseProgress={
                isCourse && currentLesson
                  ? { courseId: content.id, lessonId: currentLesson.id }
                  : undefined
              }
              onMilestone={triggerRewardRefresh}
            />
          )}
        </div>

        {/* Rest of children: Scrollable content area */}
        <>
          <UpgradeModal
            open={showUpgradeModal}
            onOpenChange={setShowUpgradeModal}
            requiredPlan={requiredUpgradePlan}
          />
          <PurchaseModal
            open={showPurchaseModal}
            onOpenChange={handlePurchaseModalChange}
            content={{
              id: purchaseTarget?.id || content.id,
              title: purchaseTarget?.title || content.title,
              thumbnail_url:
                purchaseTarget?.thumbnail_url || content.thumbnail_url,
              price: purchaseTarget?.price || content.price,
              discount: 0,
              creator_name:
                purchaseTarget?.creator?.display_name ||
                content.creator?.display_name ||
                "Criador",
            }}
            onPurchaseComplete={handlePurchaseComplete}
          />
          <AddToStudyModal
            open={showAddToStudyModal}
            onOpenChange={setShowAddToStudyModal}
            contentId={content.id}
            contentTitle={content.title}
          />
          <MobileCommentsSheet
            open={showMobileComments}
            onOpenChange={setShowMobileComments}
            contentId={content.id}
          />
          <MobileNotesSheet
            open={showMobileNotes}
            onOpenChange={setShowMobileNotes}
            contentId={content.id}
            onSeekTo={setSeekToTime}
            refreshTrigger={notesRefreshTrigger}
          />
          <MobileCurriculumSheet
            open={showMobileCurriculum}
            onOpenChange={setShowMobileCurriculum}
            modules={courseModules}
            currentLesson={currentLesson}
            onLessonSelect={setCurrentLesson}
            hasAccess={hasAccess}
          />

          {/* Study Tool Sheets */}
          <Sheet
            open={activeStudyPanel === "transcription"}
            onOpenChange={(open) => !open && setActiveStudyPanel(null)}
          >
            <SheetContent
              side="bottom"
              className="h-[80vh] rounded-t-3xl p-0 flex flex-col"
            >
              <SheetHeader className="px-4 py-3 border-b flex-row items-center justify-between">
                <SheetTitle className="text-base font-semibold">
                  Transcrição
                </SheetTitle>
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
                    <p className="text-muted-foreground text-sm mb-4">
                      Transcrição não disponível
                    </p>
                    <Button
                      onClick={generateTranscription}
                      disabled={transcriptionLoading}
                    >
                      Gerar Transcrição
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Sheet
            open={activeStudyPanel === "quiz"}
            onOpenChange={(open) => !open && setActiveStudyPanel(null)}
          >
            <SheetContent
              side="bottom"
              className="h-[80vh] rounded-t-3xl p-0 flex flex-col"
            >
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="text-base font-semibold">
                  Quiz
                </SheetTitle>
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

          <Sheet
            open={activeStudyPanel === "notes"}
            onOpenChange={(open) => !open && setActiveStudyPanel(null)}
          >
            <SheetContent
              side="bottom"
              className="h-[80vh] rounded-t-3xl p-0 flex flex-col"
            >
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="text-base font-semibold">
                  Anotações
                </SheetTitle>
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

          <Sheet
            open={activeStudyPanel === "recommendations"}
            onOpenChange={(open) => !open && setActiveStudyPanel(null)}
          >
            <SheetContent
              side="bottom"
              className="h-[80vh] rounded-t-3xl p-0 flex flex-col"
            >
              <SheetHeader className="px-4 py-3 border-b">
                <SheetTitle className="text-base font-semibold">
                  Sugestões
                </SheetTitle>
              </SheetHeader>
              <div className="flex-1 overflow-auto p-4">
                <WatchRelated
                  contentId={content.id}
                  categoryId={content.category_id}
                  tags={content.tags}
                  contentType={
                    content.content_type as
                      "aula" | "short" | "podcast" | "curso"
                  }
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
              totalLessons={courseModules.reduce(
                (acc, mod) => acc + (mod.lessons?.length || 0),
                0,
              )}
              relatedContents={relatedContents}
              onContentClick={(nextId) =>
                navigate(`/watch/${nextId}`, {
                  state: {
                    backgroundLocation:
                      (location.state as any)?.backgroundLocation ?? location,
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
        <Header className="!border-border/10" />

        <UpgradeModal
          open={showUpgradeModal}
          onOpenChange={setShowUpgradeModal}
          requiredPlan={requiredUpgradePlan}
        />

        {content && (
          <PurchaseModal
            open={showPurchaseModal}
            onOpenChange={handlePurchaseModalChange}
            content={{
              id: purchaseTarget?.id || content.id,
              title: purchaseTarget?.title || content.title,
              thumbnail_url:
                purchaseTarget?.thumbnail_url || content.thumbnail_url,
              price: purchaseTarget?.price || content.price,
              discount: 0,
              creator_name:
                purchaseTarget?.creator?.display_name ||
                content.creator?.display_name ||
                "Criador",
            }}
            onPurchaseComplete={handlePurchaseComplete}
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
            <div
              className={`flex gap-4 sm:gap-6 p-3 sm:p-6 ${theaterMode ? "flex-col" : "flex-col lg:flex-row"}`}
            >
              <div
                className={`min-w-0 space-y-3 sm:space-y-4 ${theaterMode ? "w-full" : "flex-1"}`}
              >
                {/* Access Blocked Overlay - shown when user doesn't have access */}
                {!hasAccess && accessBlockedReason ? (
                  <AccessBlockedOverlay
                    reason={accessBlockedReason}
                    requiredPlan={requiredUpgradePlan}
                    price={content.price}
                    thumbnail={content.thumbnail_url}
                    onUpgradeClick={() => setShowUpgradeModal(true)}
                    onPurchaseClick={openCurrentPurchase}
                  />
                ) : isCourse && currentLesson ? (
                  <UnifiedVideoPlayer
                    key={currentLesson.id}
                    content={{
                      id: currentLesson.id,
                      title: currentLesson.title,
                      file_url: currentLesson.video_url || "",
                      thumbnail_url: content.thumbnail_url,
                      content_type: "aula" as const,
                      duration_seconds: currentLesson.duration_seconds || 0,
                      content_id: currentLesson.content_id || null,
                      lesson_id: currentLesson.id,
                      video_provider: currentLesson.content?.video_provider,
                      bunny_video_id: currentLesson.content?.bunny_video_id,
                      bunny_library_id: currentLesson.content?.bunny_library_id,
                      media_asset_id:
                        currentLesson.media_asset_id ||
                        currentLesson.content?.media_asset_id,
                    }}
                    courseProgress={{
                      courseId: content.id,
                      lessonId: currentLesson.id,
                    }}
                    mode="watch"
                    onTimeUpdate={handleTimeUpdate}
                    onNoteCreated={() =>
                      setNotesRefreshTrigger((prev) => prev + 1)
                    }
                    onMilestone={triggerRewardRefresh}
                    seekToTime={seekToTime}
                    theaterMode={theaterMode}
                    onTheaterModeToggle={handleTheaterModeToggle}
                    toolbarSlot={
                      <StudyToolbar
                        activePanel={activeStudyPanel}
                        onPanelChange={setActiveStudyPanel}
                        disabled={!hasAccess}
                        surface="dark"
                      />
                    }
                  />
                ) : !isCourse ? (
                  <div className="relative">
                    <UnifiedVideoPlayer
                      key={content.id}
                      content={{
                        id: content.id,
                        title: content.title,
                        file_url: content.file_url,
                        thumbnail_url: content.thumbnail_url,
                        content_type: content.content_type,
                        duration_seconds: content.duration_seconds,
                        content_id: content.id,
                        video_provider: content.video_provider,
                        bunny_video_id: content.bunny_video_id,
                        bunny_library_id: content.bunny_library_id,
                        media_asset_id: content.media_asset_id,
                      }}
                      mode="watch"
                      onTimeUpdate={handleTimeUpdate}
                      onVideoEnded={handleVideoEnd}
                      onNoteCreated={() =>
                        setNotesRefreshTrigger((prev) => prev + 1)
                      }
                      onMilestone={triggerRewardRefresh}
                      seekToTime={seekToTime}
                      theaterMode={theaterMode}
                      onTheaterModeToggle={handleTheaterModeToggle}
                      toolbarSlot={
                        <StudyToolbar
                          activePanel={activeStudyPanel}
                          onPanelChange={setActiveStudyPanel}
                          disabled={!hasAccess}
                          surface="dark"
                        />
                      }
                    />
                    {/* Autoplay Next Overlay */}
                    <AutoplayNextOverlay
                      nextContent={nextContent}
                      show={showAutoplayOverlay}
                      canPlay={nextContentAccess.hasAccess}
                      checkingAccess={nextContentAccess.checking}
                      blockReason={
                        nextContentAccess.reason === "plan" ||
                        nextContentAccess.reason === "purchase"
                          ? nextContentAccess.reason
                          : null
                      }
                      requiredPlan={nextContentAccess.requiredPlan}
                      onUpgradeClick={() => {
                        setRequiredUpgradePlan(
                          nextContentAccess.requiredPlan,
                        );
                        setShowUpgradeModal(true);
                      }}
                      onPurchaseClick={openNextPurchase}
                      onFindFree={handleFindAccessibleContent}
                      onCancel={() => {
                        setShowAutoplayOverlay(false);
                        setAutoplayCancelled(true);
                      }}
                    />
                  </div>
                ) : null}

                {/* Reward progress bar */}
                {hasAccess && user && !isCourse && (
                  <ContentRewardProgress
                    contentId={content.id}
                    refreshTrigger={rewardRefreshTrigger}
                    liveStates={liveActionStates}
                    studyId={activeStudyId}
                    studyTitle={activeStudyTitle}
                  />
                )}

                {/* Attribution banner for curated content */}
                {content.is_curated && content.attribution_text && (
                  <div className="flex items-center gap-2 px-3 py-2 mt-1 rounded-lg bg-muted/50 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/70 shrink-0">
                      Curadoria Classfy
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>{content.attribution_text}</span>
                    {content.license_type && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">
                        {content.license_type}
                      </span>
                    )}
                    {content.source_url && (
                      <a
                        href={content.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        fonte
                      </a>
                    )}
                  </div>
                )}

                {/* Title */}
                <div className="flex items-start sm:items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                  <h1 className="text-lg sm:text-xl font-bold">
                    {isCourse && currentLesson
                      ? currentLesson.title
                      : content.title}
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
                    <Button
                      onClick={handleApprove}
                      className="flex items-center gap-2"
                    >
                      <CheckCircle className="h-4 w-4" />
                      Aprovar Conteúdo
                    </Button>
                    <Button
                      onClick={handleReject}
                      variant="destructive"
                      className="flex items-center gap-2"
                    >
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
                      creator={
                        content.creator
                          ? {
                              id: content.creator.id,
                              display_name: content.creator.display_name,
                              avatar_url: content.creator.avatar_url,
                              channel_name: (content.creator as any)
                                ?.creator_channel_name,
                            }
                          : null
                      }
                      followersCount={followersCount}
                      hasAccess={hasAccess}
                      onAddToStudy={() => setShowAddToStudyModal(true)}
                      showCreator={true}
                      onAction={triggerRewardRefresh}
                      onStateChange={setLiveActionStates}
                    />
                  </div>
                )}

                {/* Collapsible Description Card - YouTube Style */}
                <div
                  className="bg-secondary/50 rounded-lg sm:rounded-xl p-2.5 sm:p-3 cursor-pointer hover:bg-secondary/70 transition-colors"
                  onClick={() => setDescExpanded(!descExpanded)}
                >
                  <p className="text-xs sm:text-sm font-medium text-muted-foreground mb-1">
                    {formatCount(content.views_count || 0)} visualizações •{" "}
                    {formatDistanceToNow(
                      new Date(content.created_at || Date.now()),
                      { addSuffix: true, locale: ptBR },
                    )}
                    {content.tags && content.tags.length > 0 && (
                      <span className="ml-2">
                        {content.tags
                          .slice(0, 3)
                          .map((tag) => `#${tag}`)
                          .join(" ")}
                      </span>
                    )}
                  </p>
                  <div
                    className={`text-xs sm:text-sm ${!descExpanded ? "line-clamp-2" : ""}`}
                  >
                    {isCourse && currentLesson && currentLesson.description && (
                      <p className="mb-2">{currentLesson.description}</p>
                    )}
                    {content.description && <p>{content.description}</p>}
                    {descExpanded && isCourse && content.what_you_learn && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <h4 className="font-semibold mb-2">
                          O que você vai aprender
                        </h4>
                        <p className="text-muted-foreground">
                          {content.what_you_learn}
                        </p>
                      </div>
                    )}
                    {descExpanded && isCourse && content.requirements && (
                      <div className="mt-4">
                        <h4 className="font-semibold mb-2">Requisitos</h4>
                        <p className="text-muted-foreground">
                          {content.requirements}
                        </p>
                      </div>
                    )}
                  </div>
                  {!descExpanded &&
                    (content.description ||
                      (isCourse && currentLesson?.description)) && (
                      <span className="text-xs sm:text-sm font-semibold mt-1 inline-block">
                        ...mais
                      </span>
                    )}
                </div>

                {!isCourse && <ContentComments contentId={content.id} />}
              </div>

              <div
                className={`shrink-0 space-y-4 ${theaterMode ? "w-full grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6" : "w-full lg:w-80 xl:w-96"}`}
              >
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
                          .flatMap((m) => m.lessons)
                          .find((l) => l.id === lessonId);
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
        <Sheet
          open={activeStudyPanel === "transcription"}
          onOpenChange={(open) => !open && setActiveStudyPanel(null)}
        >
          <SheetContent
            side="right"
            className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>Transcrição</SheetTitle>
              <SheetDescription className="line-clamp-1">
                {content.title}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              {!transcription && !transcriptionLoading ? (
                <div className="space-y-4">
                  <div className="text-muted-foreground text-sm">
                    <p>
                      A transcrição deste conteúdo está sendo processada
                      automaticamente.
                    </p>
                    <p className="mt-2">
                      Isso acontece em segundo plano quando o conteúdo é
                      aprovado. Recarregue a página em alguns minutos.
                    </p>
                  </div>
                  <Button
                    onClick={generateTranscription}
                    disabled={transcriptionLoading}
                    variant="outline"
                    size="sm"
                  >
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
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setSearchQuery("")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <div className="prose prose-sm max-w-none whitespace-pre-wrap text-foreground">
                    <HighlightedText
                      text={transcription}
                      query={searchQuery}
                      markClassName="rounded bg-yellow-200 px-0.5 dark:bg-yellow-800"
                    />
                  </div>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>

        {/* Quiz Sheet */}
        <Sheet
          open={activeStudyPanel === "quiz"}
          onOpenChange={(open) => !open && setActiveStudyPanel(null)}
        >
          <SheetContent
            side="right"
            className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>Quiz</SheetTitle>
              <SheetDescription className="line-clamp-1">
                Teste seus conhecimentos
              </SheetDescription>
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
        <Sheet
          open={activeStudyPanel === "notes"}
          onOpenChange={(open) => !open && setActiveStudyPanel(null)}
        >
          <SheetContent
            side="right"
            className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto"
          >
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
        <Sheet
          open={activeStudyPanel === "comments"}
          onOpenChange={(open) => !open && setActiveStudyPanel(null)}
        >
          <SheetContent
            side="right"
            className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>Comentários</SheetTitle>
              <SheetDescription className="line-clamp-1">
                Discussões sobre {content.title}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6">
              <ContentComments contentId={content.id} />
            </div>
          </SheetContent>
        </Sheet>

        {/* Recommendations Sheet */}
        <Sheet
          open={activeStudyPanel === "recommendations"}
          onOpenChange={(open) => !open && setActiveStudyPanel(null)}
        >
          <SheetContent
            side="right"
            className="w-full sm:w-[500px] sm:max-w-[600px] overflow-y-auto"
          >
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
