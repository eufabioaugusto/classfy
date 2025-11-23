import { useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRewardSystem } from "@/hooks/useRewardSystem";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eye, Heart, Clock, CheckCircle, XCircle, AlertCircle, BookmarkPlus } from "lucide-react";
import { ContentActions } from "@/components/ContentActions";
import { ContentComments } from "@/components/ContentComments";
import { FollowButton } from "@/components/FollowButton";
import { AddToStudyModal } from "@/components/AddToStudyModal";
import { WatchVideoPlayer } from "@/components/WatchVideoPlayer";
import { Header } from "@/components/Header";
import { AppSidebar } from "@/components/AppSidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useState, useEffect } from "react";
import { GlobalLoader } from "@/components/GlobalLoader";
import { toast } from "sonner";
import { UpgradeModal } from "@/components/UpgradeModal";
import { PurchaseModal } from "@/components/PurchaseModal";
import { WatchNotes } from "@/components/WatchNotes";
import { CourseCurriculum } from "@/components/CourseCurriculum";
import { WatchRelated } from "@/components/WatchRelated";

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

export default function Watch() {
  const { id } = useParams();
  const { user, profile, loading, role } = useAuth();
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
    complete: false
  });
  const [view15sRecorded, setView15sRecorded] = useState(false);
  const [showAddToStudyModal, setShowAddToStudyModal] = useState(false);
  const [notesRefreshTrigger, setNotesRefreshTrigger] = useState(0);
  const [seekToTime, setSeekToTime] = useState<number | null>(null);
  const { processReward } = useRewardSystem();
  
  // Course-specific state
  const [isCourse, setIsCourse] = useState(false);
  const [courseModules, setCourseModules] = useState<any[]>([]);
  const [currentLesson, setCurrentLesson] = useState<any>(null);

  useEffect(() => {
    if (id && user && !loading && role) {
      fetchContent();
    }
  }, [id, user, loading, role]);

  const fetchContent = async () => {
    try {
      // First, try to fetch as regular content
      let query = supabase
        .from('contents')
        .select(`
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
          creator:profiles!creator_id(id, display_name, avatar_url)
        `)
        .eq('id', id);

      // Only filter by approved status if user is not admin
      if (role !== 'admin') {
        query = query.eq('status', 'approved');
      }

      let { data, error } = await query.maybeSingle();

      // If not found as content, try as course
      if (!data || error) {
        let courseQuery = supabase
          .from('courses')
          .select(`
            id,
            title,
            description,
            thumbnail_url,
            visibility,
            price,
            total_duration_seconds,
            views_count,
            status,
            creator_id,
            tags,
            total_lessons,
            level,
            what_you_learn,
            requirements,
            creator:profiles!creator_id(id, display_name, avatar_url)
          `)
          .eq('id', id);

        if (role !== 'admin') {
          courseQuery = courseQuery.eq('status', 'approved');
        }

        const courseResult = await courseQuery.maybeSingle();
        
        if (courseResult.error || !courseResult.data) {
          setContent(null);
          setLoadingContent(false);
          return;
        }

        // Fetch course modules and lessons
        const { data: modules } = await supabase
          .from('course_modules')
          .select(`
            *,
            lessons:course_lessons(*)
          `)
          .eq('course_id', id)
          .order('order_index', { ascending: true });

        setCourseModules(modules || []);
        
        // Get first lesson as current
        if (modules && modules.length > 0 && modules[0].lessons && modules[0].lessons.length > 0) {
          setCurrentLesson(modules[0].lessons[0]);
        }

        setIsCourse(true);
        setContent({
          ...courseResult.data,
          content_type: 'curso' as any,
          duration_seconds: courseResult.data.total_duration_seconds || 0,
          file_url: '', // Courses don't have single file_url
          likes_count: 0,
          category_id: null,
        } as Content);
        
        checkAccess(courseResult.data as any);
        setLoadingContent(false);
        return;
      }

      setIsCourse(false);
      setContent(data);
      checkAccess(data);

      // Register unique view only if not admin previewing pending content
      const isAdminPreview = role === 'admin' && data.status === 'pending';
      if (!isAdminPreview && user) {
        try {
          const { data: viewResult, error: viewError } = await supabase
            .rpc('increment_content_view', {
              p_user_id: user.id,
              p_content_id: id
            });
          
          if (viewError) {
            console.error('Error registering view:', viewError);
          } else {
            console.log('View registered:', viewResult);
          }
        } catch (error) {
          console.error('Error incrementing view:', error);
        }
      }
    } catch (error: any) {
      console.error(error);
    } finally {
      setLoadingContent(false);
    }
  };

  const checkAccess = async (content: Content) => {
    if (!profile || !user) return;

    // Admins always have access
    if (role === 'admin') {
      setHasAccess(true);
      return;
    }

    const userPlan = profile.plan || 'free';

    // Check if content is paid and user has purchased it
    if (content.visibility === 'paid') {
      const { data: purchase } = await supabase
        .from('purchased_contents')
        .select('id')
        .eq('user_id', user.id)
        .eq('content_id', content.id)
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
    if (content.visibility === 'free') {
      setHasAccess(true);
    } else if (content.visibility === 'pro') {
      if (['pro', 'premium'].includes(userPlan)) {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan('pro');
        setShowUpgradeModal(true);
      }
    } else if (content.visibility === 'premium') {
      if (userPlan === 'premium') {
        setHasAccess(true);
      } else {
        setHasAccess(false);
        setRequiredUpgradePlan('premium');
        setShowUpgradeModal(true);
      }
    } else {
      setHasAccess(false);
    }
  };

  const recordMetric = async (event: 'start' | 'half' | 'complete') => {
    if (metricsRecorded[event] || !user || !id) return;

    try {
      await supabase
        .from('content_metrics')
        .insert({
          content_id: id,
          user_id: user.id,
          event
        });

      setMetricsRecorded(prev => ({ ...prev, [event]: true }));
    } catch (error) {
      console.error('Error recording metric:', error);
    }
  };

  const checkBingeWatch = async () => {
    if (!user) return;
    
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCompletions } = await supabase
      .from('content_metrics')
      .select('content_id')
      .eq('user_id', user.id)
      .eq('event', 'complete')
      .gte('created_at', oneHourAgo)
      .order('created_at', { ascending: false })
      .limit(3);

    if (recentCompletions && recentCompletions.length >= 3) {
      await processReward({
        actionKey: 'BINGE_WATCH',
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
      .from('content_metrics')
      .select('id')
      .eq('user_id', user.id)
      .eq('event', 'start')
      .gte('created_at', startOfWeek.toISOString())
      .limit(1);

    if (!weeklyViews || weeklyViews.length === 0) {
      await processReward({
        actionKey: 'FIRST_CONTENT_WEEK',
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
        actionKey: 'VIEW_15S',
        userId: user.id,
        contentId: content.id,
        metadata: { watch_time: currentTime }
      });
      setView15sRecorded(true);
    }

    if (!metricsRecorded.start && currentTime > 0) {
      await recordMetric('start');
      await checkFirstContentWeek();
    }

    if (!metricsRecorded.half && currentTime > duration / 2) {
      await recordMetric('half');
    }

    if (!metricsRecorded.complete && currentTime > duration * 0.95) {
      await recordMetric('complete');
      await checkBingeWatch();
    }
  };

  const handleApprove = async () => {
    if (!content) return;
    
    try {
      // Check if admin
      if (role !== 'admin') {
        toast.error("Apenas administradores podem aprovar conteúdo.");
        return;
      }

      // Update content status using service role through edge function
      const { data: updateData, error: updateError } = await supabase.functions.invoke('approve-content', {
        body: { contentId: id }
      });

      if (updateError) throw updateError;

      toast.success("Conteúdo aprovado! O criador foi notificado.");
      window.location.href = '/admin/contents';
    } catch (error: any) {
      console.error('Error approving content:', error);
      toast.error(error.message || "Não foi possível aprovar o conteúdo.");
    }
  };

  const handleReject = async () => {
    if (!content) return;
    
    try {
      // Check if admin
      if (role !== 'admin') {
        toast.error("Apenas administradores podem reprovar conteúdo.");
        return;
      }

      // Update content status using service role through edge function
      const { data: updateData, error: updateError } = await supabase.functions.invoke('reject-content', {
        body: { contentId: id }
      });

      if (updateError) throw updateError;

      toast.success("Conteúdo reprovado. O criador foi notificado.");
      window.location.href = '/admin/contents';
    } catch (error: any) {
      console.error('Error rejecting content:', error);
      toast.error(error.message || "Não foi possível reprovar o conteúdo.");
    }
  };

  if (loading || loadingContent) {
    return <GlobalLoader />;
  }

  if (!user) return <Navigate to="/auth" replace />;
  if (!content) return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="p-8 text-center">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h2 className="text-2xl font-bold mb-2">Conteúdo não encontrado</h2>
        <p className="text-muted-foreground">O conteúdo que você está procurando não existe ou foi removido.</p>
      </Card>
    </div>
  );
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          <Header />
          
          <UpgradeModal 
            open={showUpgradeModal} 
            onOpenChange={setShowUpgradeModal}
            requiredPlan={requiredUpgradePlan}
          />
          
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
                creator_name: content.creator.display_name
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
              <div className="flex flex-col lg:flex-row gap-6 p-6">
                <div className="flex-1 min-w-0 space-y-4">
                  {isCourse && currentLesson ? (
                    <WatchVideoPlayer
                      content={{
                        id: currentLesson.id,
                        title: currentLesson.title,
                        file_url: currentLesson.video_url || '',
                        thumbnail_url: content.thumbnail_url,
                        content_type: 'aula' as any,
                        duration_seconds: currentLesson.duration_seconds || 0,
                      }}
                      onTimeUpdate={handleTimeUpdate}
                      onCreateNote={() => setNotesRefreshTrigger(prev => prev + 1)}
                      seekToTime={seekToTime}
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
                      }}
                      onTimeUpdate={handleTimeUpdate}
                      onCreateNote={() => setNotesRefreshTrigger(prev => prev + 1)}
                      seekToTime={seekToTime}
                    />
                  ) : null}

            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold">
                  {isCourse && currentLesson ? currentLesson.title : content.title}
                </h1>
                {content.status === 'pending' && role === 'admin' && (
                  <Badge variant="outline" className="flex items-center gap-1 border-yellow-500 text-yellow-600 dark:text-yellow-400">
                    <AlertCircle className="h-3 w-3" />
                    PENDENTE
                  </Badge>
                )}
                {isCourse && (
                  <Badge variant="secondary">CURSO</Badge>
                )}
              </div>
              
              <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                <span className="flex items-center gap-1">
                  <Eye className="h-4 w-4" />
                  {content.views_count || 0} visualizações
                </span>
                {!isCourse && (
                  <span className="flex items-center gap-1">
                    <Heart className="h-4 w-4" />
                    {content.likes_count || 0} curtidas
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {isCourse && currentLesson 
                    ? `${Math.floor((currentLesson.duration_seconds || 0) / 60)} min`
                    : `${Math.floor((content.duration_seconds || 0) / 60)} min`
                  }
                </span>
                {isCourse && content.total_lessons && (
                  <span>📚 {content.total_lessons} aulas</span>
                )}
              </div>

              {content.status === 'pending' && role === 'admin' ? (
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
                <div className="flex items-center gap-2">
                  <ContentActions contentId={content.id} />
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowAddToStudyModal(true)}
                    className="flex items-center gap-2"
                  >
                    <BookmarkPlus className="h-4 w-4" />
                    Adicionar ao Estudo
                  </Button>
                </div>
              )}
            </div>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar>
                    <AvatarImage src={content.creator.avatar_url || ''} />
                    <AvatarFallback>{content.creator.display_name[0]}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold">{content.creator.display_name}</p>
                  </div>
                </div>
                <FollowButton creatorId={content.creator.id} size="sm" />
              </div>
              {isCourse && currentLesson && currentLesson.description && (
                <div className="mb-4">
                  <h2 className="text-xl font-semibold mb-2">Sobre esta aula</h2>
                  <p className="text-muted-foreground">{currentLesson.description}</p>
                </div>
              )}
              {content.description && (
                <div>
                  <h2 className="text-xl font-semibold mb-2">
                    {isCourse ? 'Sobre o curso' : 'Descrição'}
                  </h2>
                  <p className="text-muted-foreground">{content.description}</p>
                </div>
              )}
              {isCourse && content.what_you_learn && (
                <div className="mt-4">
                  <h3 className="font-semibold mb-2">O que você vai aprender</h3>
                  <p className="text-sm text-muted-foreground">{content.what_you_learn}</p>
                </div>
              )}
              {isCourse && content.requirements && (
                <div className="mt-4">
                  <h3 className="font-semibold mb-2">Requisitos</h3>
                  <p className="text-sm text-muted-foreground">{content.requirements}</p>
                </div>
              )}
            </Card>

                  {!isCourse && <ContentComments contentId={content.id} />}
                </div>

                <div className="w-full lg:w-80 xl:w-96 shrink-0 space-y-4">
                  {isCourse ? (
                    <CourseCurriculum
                      modules={courseModules}
                      currentLesson={currentLesson}
                      onLessonSelect={setCurrentLesson}
                      hasAccess={hasAccess}
                    />
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
    </SidebarProvider>
  );
}
