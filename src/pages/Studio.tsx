import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  ArrowRight,
  BarChart3,
  CircleDollarSign,
  Eye,
  Heart,
  MessageSquare,
  Plus,
  Rocket,
  Sparkles,
  Target,
  Users,
  Video,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCreatorMilestones } from "@/hooks/useCreatorMilestones";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { GlobalLoader } from "@/components/GlobalLoader";
import { CreatorTemplate } from "@/components/templates";
import {
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2EmptyState,
  V2SectionHeader,
} from "@/components/v2";
import { StudioMetricCard } from "@/components/studio/StudioMetricCard";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import "@/styles/studio-v2.css";

type RecentContent = {
  id: string;
  title: string;
  status: string | null;
  created_at: string;
  views_count: number | null;
  thumbnail_url: string | null;
  content_type: string;
};

type RecentComment = {
  id: string;
  text: string;
  created_at: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
  contents: { id: string; title: string; creator_id: string } | null;
};

type RecentReward = {
  id: string;
  action_key: string;
  points: number;
  created_at: string;
};

const rewardLabels: Record<string, string> = {
  FIRST_CONTENT_WEEK: "Primeiro conteúdo assistido na semana",
  FIRST_UPLOAD: "Primeiro conteúdo enviado",
  CONTENT_APPROVED: "Conteúdo aprovado",
  CREATOR_MILESTONE: "Meta de creator alcançada",
  CREATOR_APPROVED: "Perfil de creator aprovado",
};

const statusLabels: Record<string, string> = {
  approved: "Publicado",
  pending: "Em análise",
  rejected: "Revisão necessária",
};

export default function Studio() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalContents: 0,
    totalViews: 0,
    followers: 0,
    earnings: 0,
    pendingContents: 0,
    totalComments: 0,
    activeBoosts: 0,
    last7DaysViews: 0,
    viewsTrend: 0,
  });
  const [recentContents, setRecentContents] = useState<RecentContent[]>([]);
  const [recentComments, setRecentComments] = useState<RecentComment[]>([]);
  const [recentRewards, setRecentRewards] = useState<RecentReward[]>([]);
  const { nextMilestones, totals, loading: milestonesLoading } = useCreatorMilestones(user?.id);

  useEffect(() => {
    if (!user) return;

    const fetchDashboardData = async () => {
      setIsLoading(true);
      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const fourteenDaysAgo = new Date();
        fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

        const [
          contentsCountRes,
          coursesCountRes,
          pendingCountRes,
          pendingCoursesCountRes,
          contentsViewsRes,
          coursesViewsRes,
          recentViewsRes,
          recentCourseViewsRes,
          previousViewsRes,
          previousCourseViewsRes,
          followersCountRes,
          walletRes,
          commentsCountRes,
          boostsRes,
          recentContentsRes,
          recentCoursesRes,
          recentCommentsRes,
          recentRewardsRes,
        ] = await Promise.all([
          supabase.from("contents").select("*", { count: "exact", head: true }).eq("creator_id", user.id),
          supabase.from("courses").select("*", { count: "exact", head: true }).eq("creator_id", user.id),
          supabase.from("contents").select("*", { count: "exact", head: true }).eq("creator_id", user.id).eq("status", "pending"),
          supabase.from("courses").select("*", { count: "exact", head: true }).eq("creator_id", user.id).eq("status", "pending"),
          supabase.from("contents").select("views_count").eq("creator_id", user.id),
          supabase.from("courses").select("views_count").eq("creator_id", user.id),
          supabase.from("content_views").select("view_count, contents!inner(creator_id)").eq("contents.creator_id", user.id).gte("view_date", sevenDaysAgo.toISOString().split("T")[0]),
          supabase.from("content_views").select("view_count, courses!inner(creator_id)").eq("courses.creator_id", user.id).gte("view_date", sevenDaysAgo.toISOString().split("T")[0]),
          supabase.from("content_views").select("view_count, contents!inner(creator_id)").eq("contents.creator_id", user.id).gte("view_date", fourteenDaysAgo.toISOString().split("T")[0]).lt("view_date", sevenDaysAgo.toISOString().split("T")[0]),
          supabase.from("content_views").select("view_count, courses!inner(creator_id)").eq("courses.creator_id", user.id).gte("view_date", fourteenDaysAgo.toISOString().split("T")[0]).lt("view_date", sevenDaysAgo.toISOString().split("T")[0]),
          supabase.from("follows").select("*", { count: "exact", head: true }).eq("following_id", user.id),
          supabase.from("wallets").select("total_earned").eq("user_id", user.id).single(),
          supabase.from("comments").select("*, contents!inner(creator_id)", { count: "exact", head: true }).eq("contents.creator_id", user.id),
          supabase.from("boosts").select("*", { count: "exact", head: true }).eq("user_id", user.id).eq("status", "active"),
          supabase.from("contents").select("id, title, status, created_at, views_count, thumbnail_url, content_type").eq("creator_id", user.id).order("created_at", { ascending: false }).limit(5),
          supabase.from("courses").select("id, title, status, created_at, views_count, thumbnail_url").eq("creator_id", user.id).order("created_at", { ascending: false }).limit(3),
          supabase.from("comments").select("id, text, created_at, profiles:user_id(display_name, avatar_url), contents!inner(id, title, creator_id)").eq("contents.creator_id", user.id).order("created_at", { ascending: false }).limit(5),
          supabase.from("reward_events").select("id, action_key, points, created_at").eq("user_id", user.id).eq("point_type", "creator").order("created_at", { ascending: false }).limit(5),
        ]);

        const totalViews = [...(contentsViewsRes.data || []), ...(coursesViewsRes.data || [])]
          .reduce((sum, item) => sum + (item.views_count || 0), 0);
        const last7DaysViews = [...(recentViewsRes.data || []), ...(recentCourseViewsRes.data || [])]
          .reduce((sum, view) => sum + Number(view.view_count || 0), 0);
        const previous7DaysViews = [...(previousViewsRes.data || []), ...(previousCourseViewsRes.data || [])]
          .reduce((sum, view) => sum + Number(view.view_count || 0), 0);
        const viewsTrend = previous7DaysViews > 0
          ? ((last7DaysViews - previous7DaysViews) / previous7DaysViews) * 100
          : 0;
        const allRecent = [
          ...(recentContentsRes.data || []),
          ...(recentCoursesRes.data || []).map((course) => ({ ...course, content_type: "curso" })),
        ]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 5) as RecentContent[];

        setRecentContents(allRecent);
        setRecentComments((recentCommentsRes.data || []) as unknown as RecentComment[]);
        setRecentRewards((recentRewardsRes.data || []) as RecentReward[]);
        setStats({
          totalContents: (contentsCountRes.count || 0) + (coursesCountRes.count || 0),
          totalViews,
          followers: followersCountRes.count || 0,
          earnings: Number(walletRes.data?.total_earned || 0),
          pendingContents: (pendingCountRes.count || 0) + (pendingCoursesCountRes.count || 0),
          totalComments: commentsCountRes.count || 0,
          activeBoosts: boostsRes.count || 0,
          last7DaysViews,
          viewsTrend,
        });
      } catch (error) {
        console.error("Error fetching dashboard data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchDashboardData();
  }, [user]);

  const engagementRate = stats.totalViews > 0
    ? (stats.totalComments / stats.totalViews) * 100
    : 0;
  const milestoneProgress = totals.total > 0
    ? Math.round((totals.claimed / totals.total) * 100)
    : 0;
  const spotlight = useMemo(() => {
    if (stats.totalContents === 0) {
      return {
        kicker: "Comece por aqui",
        title: "Publique seu primeiro conteúdo.",
        description: "Envie uma aula, podcast ou short e acompanhe toda a operação a partir deste painel.",
      };
    }
    return {
      kicker: "Sua semana no Studio",
      title: `${stats.last7DaysViews.toLocaleString("pt-BR")} ${stats.last7DaysViews === 1 ? "visualização" : "visualizações"} nos últimos 7 dias.`,
      description: stats.pendingContents > 0
        ? `${stats.pendingContents} ${stats.pendingContents === 1 ? "publicação está" : "publicações estão"} aguardando análise. Enquanto isso, acompanhe o desempenho do seu catálogo.`
        : "Seu catálogo está pronto para crescer. Publique com consistência e use os dados para decidir o próximo conteúdo.",
    };
  }, [stats.last7DaysViews, stats.pendingContents, stats.totalContents]);

  if (loading || isLoading) return <GlobalLoader label="Carregando Studio" />;

  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;

  return (
    <AppShell variant="studio" title="Studio" contentClassName="studio-page-shell">
      <CreatorTemplate
        className="studio-template"
        width="wide"
        density="comfortable"
        header={
          <PageHeader
            eyebrow="Studio Classfy"
            title="Seu conteúdo, sua operação."
            description="Publique, acompanhe o que está funcionando e encontre o próximo passo para crescer como creator."
            action={
              <div className="studio-header-action">
                <V2Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => navigate("/studio/upload?type=aula")}>
                  Publicar conteúdo
                </V2Button>
              </div>
            }
          />
        }
        toolbar={<StudioNavigation />}
      >
        <div className="studio-stack">
          <section className="studio-overview">
            <V2Card elevation="panel" className="studio-spotlight">
              <span className="studio-kicker">{spotlight.kicker}</span>
              <h2 className="studio-spotlight__title">{spotlight.title}</h2>
              <p className="studio-spotlight__description">{spotlight.description}</p>
              <div className="studio-spotlight__actions">
                <V2Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => navigate("/studio/upload?type=aula")}>Criar nova publicação</V2Button>
                <V2Button variant="secondary" trailingIcon={<ArrowRight className="h-4 w-4" />} onClick={() => navigate("/studio/analytics")}>Ver desempenho</V2Button>
              </div>
            </V2Card>

            <V2Card className="studio-health studio-panel">
              <V2CardHeader>
                <div className="studio-panel-heading">
                  <span className="studio-icon" data-tone="accent"><Sparkles /></span>
                  <div><h2>Agora no seu Studio</h2><p>Os sinais que pedem sua atenção.</p></div>
                </div>
              </V2CardHeader>
              <V2CardContent className="studio-health__content">
                <div className="studio-list">
                  <div className="studio-list__item"><MessageSquare className="h-4 w-4 text-[var(--cf2-ink-subtle)]" /><div className="studio-list__copy"><strong>Comentários</strong><p>Conversas recebidas no catálogo</p></div><span className="studio-list__value">{stats.totalComments}</span></div>
                  <div className="studio-list__item"><Rocket className="h-4 w-4 text-[var(--cf2-ink-subtle)]" /><div className="studio-list__copy"><strong>Boosts ativos</strong><p>Campanhas em circulação</p></div><span className="studio-list__value">{stats.activeBoosts}</span></div>
                  <div className="studio-list__item"><Heart className="h-4 w-4 text-[var(--cf2-ink-subtle)]" /><div className="studio-list__copy"><strong>Engajamento</strong><p>Comentários por visualização</p></div><span className="studio-list__value">{engagementRate.toFixed(1)}%</span></div>
                </div>
              </V2CardContent>
            </V2Card>
          </section>

          <section className="studio-section">
            <V2SectionHeader eyebrow="Visão geral" title="O que aconteceu com seu conteúdo" description="Dados essenciais para acompanhar alcance, audiência e retorno." />
            <div className="studio-metrics">
              <StudioMetricCard icon={Video} label="Publicações" value={stats.totalContents} detail={stats.pendingContents > 0 ? `${stats.pendingContents} em análise` : "Catálogo total"} tone="accent" />
              <StudioMetricCard icon={Eye} label="Visualizações" value={stats.totalViews.toLocaleString("pt-BR")} detail="Em todo o catálogo" tone="success" trend={stats.viewsTrend > 0 ? `+${stats.viewsTrend.toFixed(0)}% na semana` : undefined} />
              <StudioMetricCard icon={Users} label="Seguidores" value={stats.followers.toLocaleString("pt-BR")} detail="Pessoas acompanhando você" />
              <StudioMetricCard icon={CircleDollarSign} label="Total gerado" value={stats.earnings.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} detail="Valor acumulado na carteira" tone="warning" />
            </div>
          </section>

          <section className="studio-section">
            <V2SectionHeader eyebrow="Operação" title="Continue de onde parou" description="Revise suas publicações e acompanhe as conversas mais recentes." />
            <div className="studio-workspace-grid">
              <V2Card className="studio-panel">
                <V2CardHeader>
                  <div className="studio-panel-heading"><span className="studio-icon"><Video /></span><div><h3>Publicações recentes</h3><p>Os últimos itens enviados ao catálogo.</p></div></div>
                  <V2Button variant="quiet" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => navigate("/studio/contents")}>Ver catálogo</V2Button>
                </V2CardHeader>
                <V2CardContent>
                  {recentContents.length === 0 ? (
                    <V2EmptyState className="studio-empty-inline" icon={<Video className="h-5 w-5" />} title="Seu catálogo começa aqui" description="Publique o primeiro conteúdo para acompanhar status e resultados." action={<V2Button onClick={() => navigate("/studio/upload?type=aula")}>Publicar conteúdo</V2Button>} />
                  ) : (
                    <div className="studio-list">
                      {recentContents.map((content) => (
                        <button type="button" key={content.id} className="studio-list__item" onClick={() => navigate(`/watch/${content.id}${content.content_type === "curso" ? "?type=course" : ""}`, isMobile ? { state: { backgroundLocation: location } } : undefined)}>
                          <img className="studio-list__media" src={content.thumbnail_url || "/placeholder.svg"} alt="" />
                          <div className="studio-list__copy"><strong>{content.title}</strong><div className="studio-list__meta"><span className="studio-status" data-status={content.status || "unknown"}>{statusLabels[content.status || ""] || "Não informado"}</span><span>{content.content_type}</span><span>{formatDistanceToNow(new Date(content.created_at), { addSuffix: true, locale: ptBR })}</span></div></div>
                          <span className="studio-list__value">{content.views_count || 0} views</span>
                        </button>
                      ))}
                    </div>
                  )}
                </V2CardContent>
              </V2Card>

              <V2Card className="studio-panel">
                <V2CardHeader><div className="studio-panel-heading"><span className="studio-icon"><MessageSquare /></span><div><h3>Conversas recentes</h3><p>O que a audiência comentou.</p></div></div></V2CardHeader>
                <V2CardContent>
                  {recentComments.length === 0 ? (
                    <V2EmptyState className="studio-empty-inline" icon={<MessageSquare className="h-5 w-5" />} title="Nenhum comentário ainda" description="Quando alguém comentar, a conversa aparecerá aqui." />
                  ) : (
                    <div className="studio-list">
                      {recentComments.map((comment) => (
                        <div className="studio-list__item" key={comment.id}>
                          <img className="studio-list__avatar" src={comment.profiles?.avatar_url || "/placeholder.svg"} alt="" />
                          <div className="studio-list__copy"><strong>{comment.profiles?.display_name || "Usuário Classfy"}</strong><p>{comment.text}</p><div className="studio-list__meta"><span>{comment.contents?.title}</span><span>{formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: ptBR })}</span></div></div>
                        </div>
                      ))}
                    </div>
                  )}
                </V2CardContent>
              </V2Card>
            </div>
          </section>

          {!milestonesLoading && totals.total > 0 && (
            <section className="studio-section">
              <V2SectionHeader eyebrow="Evolução" title="Próximas metas" description="Acompanhe o que falta para liberar novas conquistas e Creator Points." />
              <V2Card className="studio-milestones">
                <V2CardHeader>
                  <div className="studio-milestones__summary"><div className="studio-milestones__copy"><span>{totals.claimed} de {totals.total} metas conquistadas</span><strong>{milestoneProgress}%</strong></div><div className="studio-progress"><span style={{ width: `${milestoneProgress}%` }} /></div></div>
                  <V2Button variant="quiet" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => navigate("/studio/goals")}>Ver todas</V2Button>
                </V2CardHeader>
                <div className="studio-milestones__items">
                  {nextMilestones.slice(0, 3).map((milestone) => (
                    <div className="studio-milestone" key={milestone.id}><strong>{milestone.title}</strong><span>{milestone.currentValue.toLocaleString("pt-BR")} de {milestone.milestone_value.toLocaleString("pt-BR")}</span><div className="studio-progress"><span style={{ width: `${milestone.percentComplete}%` }} /></div></div>
                  ))}
                </div>
              </V2Card>
            </section>
          )}

          <section className="studio-section">
            <V2SectionHeader eyebrow="Creator Points" title="Recompensas recentes" description="Ações de criação que já foram registradas na nova economia." action={<V2Button variant="quiet" size="sm" trailingIcon={<ArrowRight className="h-3.5 w-3.5" />} onClick={() => navigate("/rewards-history")}>Ver histórico</V2Button>} />
            <V2Card className="studio-panel">
              <V2CardContent>
                {recentRewards.length === 0 ? (
                  <V2EmptyState className="studio-empty-inline" icon={<Target className="h-5 w-5" />} title="Nenhuma recompensa de criação ainda" description="Quando uma ação elegível for concluída, ela será registrada aqui." />
                ) : (
                  <div className="studio-list">
                    {recentRewards.map((reward) => (
                      <div className="studio-list__item" key={reward.id}><span className="studio-icon" data-tone="success"><BarChart3 /></span><div className="studio-list__copy"><strong>{rewardLabels[reward.action_key] || reward.action_key}</strong><p>{formatDistanceToNow(new Date(reward.created_at), { addSuffix: true, locale: ptBR })}</p></div><span className="studio-list__value studio-list__value--positive">+{reward.points} Creator Points</span></div>
                    ))}
                  </div>
                )}
              </V2CardContent>
            </V2Card>
          </section>
        </div>
      </CreatorTemplate>
    </AppShell>
  );
}
