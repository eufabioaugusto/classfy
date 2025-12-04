import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
  creator: {
    id: string;
    display_name: string;
    avatar_url: string | null;
  };
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
  const { user, profile, loading, role } = useAuth();
  const { setOpen: setSidebarOpen } = useSidebar();
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
  const { processReward } = useRewardSystem();

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

  useEffect(() => {
    if (id && user && !loading && role) {
      fetchContent();
    }
  }, [id, user, loading, role]);

  const fetchContent = async () => {
    try {
      // First, try to fetch as regular content
      let query = supabase
        .from("contents")
        .select(
          `
          id,
          content_type,
          title,
          description,
          file_url,
          thumbnail_url,
          visibility,
          price,
          duration_seconds,
          views_count,
          likes_count,
          status,
          creator_id,
          category_id,
          tags,
          created_at,
          creator:profiles!creator_id(id, display_name, avatar_url)
        `,
        )
        .eq("id", id);

      // Only filter by approved status if user is not admin
      if (role !== "admin") {
        query = query.eq("status", "approved");
      }

      let { data, error } = await query.maybeSingle();

      // If not found as content, try as course
      if (!data || error) {
        let courseQuery = supabase
          .from("courses")
          .select(
            `
            id,
            title,
            description,
            thumbnail_url,
            visibility,
            price,
            total_duration_seconds,
            views_count,
            likes_count,
            status,
            creator_id,
            tags,
            total_lessons,
            level,
            what_you_learn,
            requirements,
            created_at,
            creator:profiles!creator_id(id, display_name, avatar_url)
          `,
          )
          .eq("id", id);

        const courseResult = await courseQuery.maybeSingle();

        if (courseResult.error || !courseResult.data) {
          setContent(null);
          setLoadingContent(false);
          return;
        }

        // Only allow non-admins to view pending courses if they are the creator
        if (role !== "admin" && courseResult.data.status !== "approved" && courseResult.data.creator_id !== user?.id) {
          setContent(null);
          setLoadingContent(false);
          return;
        }

        // Fetch course modules and lessons
        const { data: modules } = await supabase
          .from("course_modules")
          .select(
            `
            *,
            lessons:course_lessons(*)
          `,
          )
          .eq("course_id", id)
          .order("order_index", { ascending: true });

        setCourseModules(modules || []);

        // Get first lesson as current
        if (modules && modules.length > 0 && modules[0].lessons && modules[0].lessons.length > 0) {
          setCurrentLesson(modules[0].lessons[0]);
        }

        setIsCourse(true);
        setContent({
          ...courseResult.data,
          content_type: "curso" as any,
          duration_seconds: courseResult.data.total_duration_seconds || 0,
          file_url: "", // Courses don't have single file_url
          likes_count: courseResult.data.likes_count || 0,
          category_id: null,
        } as Content);

        checkAccess(courseResult.data as any);

        // Register view for course using the new RPC
        const isAdminPreview = role === "admin" && courseResult.data.status === "pending";
        if (!isAdminPreview && user) {
          try {
            const { data: viewResult, error: viewError } = await supabase.rpc("increment_course_view", {
              p_user_id: user.id,
              p_course_id: id,
            });

            if (viewError) {
              console.error("Error registering course view:", viewError);
            } else {
              console.log("Course view registered:", viewResult);
            }
          } catch (error) {
            console.error("Error incrementing course view:", error);
          }
        }

        setLoadingContent(false);
        return;
      }

      setIsCourse(false);
      setContent(data);
      checkAccess(data);

      // Register unique view only if not admin previewing pending content
      const isAdminPreview = role === "admin" && data.status === "pending";
      if (!isAdminPreview && user) {
        try {
          const { data: viewResult, error: viewError } = await supabase.rpc("increment_content_view", {
            p_user_id: user.id,
            p_content_id: id,
          });

          if (viewError) {
            console.error("Error registering view:", viewError);
          } else {
            console.log("View registered:", viewResult);
          }
        } catch (error) {
          console.error("Error incrementing view:", error);
        }
      }
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

  // Trigger followers count when content changes
  useEffect(() => {
    if (content?.creator?.id) {
      fetchFollowersCount(content.creator.id);
    }
  }, [content?.creator?.id]);

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

  if (loading || loadingContent) {
    return <GlobalLoader />;
  }

  if (!user) return <Navigate to="/auth" replace />;
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
                creator_name: content.creator.display_name,
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
              <div className={`flex gap-6 p-6 ${theaterMode ? 'flex-col' : 'flex-col lg:flex-row'}`}>
                <div className={`min-w-0 space-y-4 ${theaterMode ? 'w-full' : 'flex-1'}`}>
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
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-xl font-bold">
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
                    <div className="flex items-center justify-between flex-wrap gap-4 py-3">
                      {/* Left - Creator info */}
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={content.creator.avatar_url || ""} />
                          <AvatarFallback>{content.creator.display_name[0]}</AvatarFallback>
                        </Avatar>
                        <div className="mr-2">
                          <p className="font-semibold text-sm">{content.creator.display_name}</p>
                          <p className="text-xs text-muted-foreground">{followersCount} seguidores</p>
                        </div>
                        <FollowButton creatorId={content.creator.id} size="sm" />
                      </div>

                      {/* Right - Actions */}
                      <ContentActions 
                        contentId={content.id} 
                        isCourse={isCourse}
                        contentTitle={content.title}
                        onAddToStudy={() => setShowAddToStudyModal(true)}
                      />
                    </div>
                  )}

                  {/* Collapsible Description Card - YouTube Style */}
                  <div 
                    className="bg-secondary/50 rounded-xl p-3 cursor-pointer hover:bg-secondary/70 transition-colors"
                    onClick={() => setDescExpanded(!descExpanded)}
                  >
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      {formatCount(content.views_count || 0)} visualizações • {formatDistanceToNow(new Date(content.created_at || Date.now()), { addSuffix: true, locale: ptBR })}
                      {content.tags && content.tags.length > 0 && (
                        <span className="ml-2">
                          {content.tags.slice(0, 3).map(tag => `#${tag}`).join(' ')}
                        </span>
                      )}
                    </p>
                    <div className={`text-sm ${!descExpanded ? 'line-clamp-2' : ''}`}>
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
                      <span className="text-sm font-semibold mt-1 inline-block">...mais</span>
                    )}
                  </div>

                  {!isCourse && <ContentComments contentId={content.id} />}
                </div>

                <div className={`shrink-0 space-y-4 ${theaterMode ? 'w-full grid grid-cols-1 md:grid-cols-2 gap-6' : 'w-full lg:w-80 xl:w-96'}`}>
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
