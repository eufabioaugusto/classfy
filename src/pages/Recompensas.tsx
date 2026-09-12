import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Award,
  BarChart3,
  Bookmark,
  Eye,
  Flame,
  Heart,
  History,
  MessageSquare,
  Sparkles,
  Star,
  Target,
  Trophy,
  Video,
  Wallet,
  Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { GlobalLoader } from "@/components/GlobalLoader";
import { AppShell, PageHeader } from "@/components/layout";
import { EconomyTemplate } from "@/components/templates";
import {
  V2Badge,
  V2Button,
  V2Card,
  V2CardContent,
  V2CardHeader,
  V2SectionHeader,
} from "@/components/v2";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreatorAchievementBadge } from "@/components/CreatorAchievementBadge";
import { LeaderboardSection } from "@/components/LeaderboardSection";
import { useCreatorMilestones } from "@/hooks/useCreatorMilestones";
import "@/styles/economy-v2.css";

interface UserStats {
  level: number;
  totalPoints: number;
  pointsToNextLevel: number;
  progressPercent: number;
  totalEarned: number;
  balance: number;
  currentStreak: number;
  longestStreak: number;
  cyclePoints: number;
  cycleDaysRemaining: number;
  engagementStats: {
    likes: number;
    saves: number;
    comments: number;
    completedContents: number;
  };
  creatorStats?: {
    totalContents: number;
    totalViews: number;
    totalLikes: number;
    avgEngagement: number;
  };
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export default function Recompensas() {
  const { user, loading: authLoading, role } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<UserStats | null>(null);
  const { milestones, loading: milestonesLoading } = useCreatorMilestones(user?.id);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }

    if (!user) return;

    const fetchStats = async () => {
      try {
        const [rewardEventsRes, walletRes, streaksRes, engagementRes] = await Promise.all([
          supabase.from("reward_events").select("points, point_type").eq("user_id", user.id).eq("point_type", "user"),
          supabase.from("wallets").select("balance, total_earned").eq("user_id", user.id).single(),
          supabase.from("user_login_streaks").select("current_streak, longest_streak").eq("user_id", user.id).maybeSingle(),
          supabase.from("reward_events").select("action_key").eq("user_id", user.id).eq("point_type", "user"),
        ]);

        const totalPoints = rewardEventsRes.data?.reduce((sum, event) => sum + event.points, 0) || 0;
        const getPointsForLevel = (level: number) => (500 * level * (level - 1)) / 2;
        let level = 1;
        while (getPointsForLevel(level + 1) <= totalPoints) level += 1;

        const pointsAtCurrentLevel = getPointsForLevel(level);
        const pointsAtNextLevel = getPointsForLevel(level + 1);
        const pointsNeededForNext = pointsAtNextLevel - pointsAtCurrentLevel;
        const pointsInCurrentLevel = totalPoints - pointsAtCurrentLevel;
        const pointsToNextLevel = Math.ceil(pointsNeededForNext - pointsInCurrentLevel);
        const progressPercent = (pointsInCurrentLevel / pointsNeededForNext) * 100;

        const actions = engagementRes.data || [];
        const engagementStats = {
          likes: actions.filter((action) => action.action_key === "LIKE").length,
          saves: actions.filter((action) => action.action_key === "SAVE").length,
          comments: actions.filter((action) => action.action_key === "COMMENT").length,
          completedContents: actions.filter((action) => action.action_key === "WATCH_100").length,
        };

        let creatorStats: UserStats["creatorStats"];
        if (role === "creator" || role === "admin") {
          const [contentsRes, coursesRes] = await Promise.all([
            supabase.from("contents").select("views_count, likes_count").eq("creator_id", user.id).eq("status", "approved"),
            supabase.from("courses").select("views_count, likes_count").eq("creator_id", user.id).eq("status", "approved"),
          ]);
          const items = [...(contentsRes.data || []), ...(coursesRes.data || [])];
          const totalViews = items.reduce((sum, item) => sum + (item.views_count || 0), 0);
          const totalLikes = items.reduce((sum, item) => sum + (item.likes_count || 0), 0);
          creatorStats = {
            totalContents: items.length,
            totalViews,
            totalLikes,
            avgEngagement: items.length > 0 && totalViews > 0 ? (totalLikes / totalViews) * 100 : 0,
          };
        }

        const now = new Date();
        const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const cycleClose = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const cycleDaysRemaining = Math.max(0, Math.ceil((cycleClose.getTime() - today.getTime()) / 86_400_000));
        const { data: cycle } = await supabase
          .from("economic_cycles")
          .select("id")
          .eq("year_month", yearMonth)
          .maybeSingle();

        let cyclePoints = 0;
        if (cycle) {
          const { data: userCycle } = await supabase
            .from("economic_cycle_users")
            .select("cycle_points")
            .eq("cycle_id", cycle.id)
            .eq("user_id", user.id)
            .maybeSingle();
          cyclePoints = Number(userCycle?.cycle_points || 0);
        }

        setStats({
          level,
          totalPoints,
          pointsToNextLevel,
          progressPercent,
          totalEarned: walletRes.data?.total_earned || 0,
          balance: walletRes.data?.balance || 0,
          currentStreak: streaksRes.data?.current_streak || 0,
          longestStreak: streaksRes.data?.longest_streak || 0,
          cyclePoints,
          cycleDaysRemaining,
          engagementStats,
          creatorStats,
        });
      } catch (error) {
        console.error("Error fetching stats:", error);
      } finally {
        setLoading(false);
      }
    };

    void fetchStats();
  }, [authLoading, navigate, role, user]);

  if (authLoading || loading || !stats || !user) return <GlobalLoader />;

  const isCreator = role === "creator" || role === "admin";
  const unlockedMilestones = milestones.filter((milestone) => milestone.isClaimed);
  const lockedMilestones = milestones.filter((milestone) => !milestone.isClaimed);
  const nextMilestone = isCreator
    ? [...lockedMilestones].sort((a, b) => b.percentComplete - a.percentComplete)[0]
    : null;
  const nextStreakReward = Math.max(1, 7 - (stats.currentStreak % 7));
  const cycleCloseLabel = stats.cycleDaysRemaining === 0
    ? "O ciclo fecha hoje"
    : `O ciclo fecha em ${stats.cycleDaysRemaining} ${stats.cycleDaysRemaining === 1 ? "dia" : "dias"}`;

  const engagementRows = [
    { Icon: Heart, label: "Curtidas", value: stats.engagementStats.likes },
    { Icon: Bookmark, label: "Salvos", value: stats.engagementStats.saves },
    { Icon: MessageSquare, label: "Comentários", value: stats.engagementStats.comments },
    { Icon: Target, label: "Conteúdos concluídos", value: stats.engagementStats.completedContents },
  ];

  const creatorRows = stats.creatorStats
    ? [
        { Icon: Video, label: "Publicações", value: stats.creatorStats.totalContents.toLocaleString("pt-BR") },
        { Icon: Eye, label: "Visualizações", value: stats.creatorStats.totalViews.toLocaleString("pt-BR") },
        { Icon: Heart, label: "Curtidas recebidas", value: stats.creatorStats.totalLikes.toLocaleString("pt-BR") },
        { Icon: BarChart3, label: "Engajamento médio", value: `${stats.creatorStats.avgEngagement.toFixed(1)}%` },
      ]
    : [];

  const typeLabel: Record<string, string> = {
    contents: "conteúdos",
    followers: "seguidores",
    views: "visualizações",
    earnings: "reais",
    engagement: "% de engajamento",
  };

  return (
    <AppShell variant="home" title="Recompensas" contentClassName="economy-page-shell">
      <EconomyTemplate
        className="economy-template"
        width="wide"
        header={
          <PageHeader
            eyebrow="Economia Classfy"
            title="Acompanhe seu progresso e suas recompensas."
            description="Veja quantos Points você acumulou, quais ações contaram e o que falta para avançar."
            action={
              <V2Button variant="secondary" leadingIcon={<History className="h-4 w-4" />} onClick={() => navigate("/rewards-history")}>
                Ver histórico
              </V2Button>
            }
          />
        }
      >
        <section className="economy-hero-grid">
          <V2Card elevation="panel" className="economy-balance-hero">
            <div className="economy-balance-hero__top">
              <span className="economy-kicker">Ciclo atual</span>
              <h2 className="economy-balance-hero__headline">Combine ações de estudo para evoluir sua participação.</h2>
              <span className="economy-balance-hero__label">Points acumulados neste ciclo</span>
              <div className="economy-balance-hero__value">
                {stats.cyclePoints.toLocaleString("pt-BR")} <small>Points</small>
              </div>
              <div className="economy-balance-hero__meta">
                <span><span className="economy-status-dot" />Somando Points agora</span>
                <span>{cycleCloseLabel}</span>
              </div>
            </div>
            <div className="economy-balance-hero__bottom economy-level">
              <div className="economy-level__row">
                <div>
                  <span className="economy-kicker">Nível {stats.level}</span>
                  <span className="economy-level__value">{stats.totalPoints.toLocaleString("pt-BR")} Points acumulados</span>
                </div>
                <V2Badge variant="accent">Próximo · N{stats.level + 1}</V2Badge>
              </div>
              <div className="economy-progress" aria-label={`${stats.progressPercent.toFixed(0)}% do nível concluído`}>
                <span style={{ width: `${Math.min(100, stats.progressPercent)}%` }} />
              </div>
              <div className="economy-progress-copy">
                <span>{stats.progressPercent.toFixed(0)}% concluído</span>
                <span>Faltam {stats.pointsToNextLevel.toLocaleString("pt-BR")} Points</span>
              </div>
            </div>
          </V2Card>
          <LeaderboardSection userId={user.id} />
        </section>

        <section className="economy-section" aria-labelledby="reward-overview-title">
          <V2SectionHeader
            eyebrow="Visão rápida"
            title="Seu progresso em números"
            description="Confira o resumo da sua evolução."
          />
          <div className="economy-metric-grid">
            {[
              { Icon: Zap, label: "Points acumulados", value: stats.totalPoints.toLocaleString("pt-BR"), detail: "Somados desde a sua entrada" },
              { Icon: Wallet, label: "Saldo disponível", value: formatMoney(stats.balance), detail: `${formatMoney(stats.totalEarned)} gerados no total` },
              { Icon: Flame, label: "Acessos consecutivos", value: `${stats.currentStreak} dias`, detail: `Seu recorde é de ${stats.longestStreak} dias` },
              { Icon: Target, label: "Conteúdos concluídos", value: stats.engagementStats.completedContents, detail: "Assistidos até o fim" },
            ].map(({ Icon, label, value, detail }) => (
              <V2Card key={label} className="economy-metric">
                <div className="economy-metric__top">
                  <span className="economy-metric__label">{label}</span>
                  <span className="economy-icon economy-icon--muted"><Icon aria-hidden="true" /></span>
                </div>
                <strong className="economy-metric__value">{value}</strong>
                <span className="economy-metric__detail">{detail}</span>
              </V2Card>
            ))}
          </div>
        </section>

        <section className="economy-section">
          <V2SectionHeader
            eyebrow="Conquistas"
            title="Metas e conquistas"
            description="Complete metas para desbloquear conquistas e acompanhar tudo o que já alcançou."
          />
          <div className="economy-content-grid">
            <V2Card className="economy-panel">
              <V2CardHeader>
                <div className="economy-panel-heading">
                  <span className="economy-icon"><Award aria-hidden="true" /></span>
                  <div>
                    <h2 className="economy-panel-title">Conquistas</h2>
                    <p className="economy-panel-copy">{unlockedMilestones.length} desbloqueadas de {milestones.length}</p>
                  </div>
                </div>
              </V2CardHeader>
              <V2CardContent>
                {milestonesLoading ? (
                  <div className="py-12 text-center text-sm text-muted-foreground">Carregando conquistas...</div>
                ) : (
                  <Tabs defaultValue="unlocked">
                    <TabsList className="economy-tabs-list">
                      <TabsTrigger value="unlocked">Desbloqueadas · {unlockedMilestones.length}</TabsTrigger>
                      <TabsTrigger value="locked">Em progresso · {lockedMilestones.length}</TabsTrigger>
                    </TabsList>
                    <TabsContent value="unlocked" className="mt-5">
                      {unlockedMilestones.length ? (
                        <div className="economy-achievement-grid">
                          {unlockedMilestones.map((milestone) => (
                            <CreatorAchievementBadge key={milestone.id} milestone={milestone} size="sm" variant="economy" />
                          ))}
                        </div>
                      ) : (
                        <div className="py-10 text-center">
                          <p className="economy-panel-title">Sua primeira conquista está próxima</p>
                          <p className="economy-panel-copy">Complete metas para marcar o início da sua coleção.</p>
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="locked" className="mt-5">
                      <div className="economy-achievement-grid">
                        {lockedMilestones.slice(0, 8).map((milestone) => (
                          <CreatorAchievementBadge key={milestone.id} milestone={milestone} size="sm" variant="economy" />
                        ))}
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </V2CardContent>
            </V2Card>

            <V2Card className="economy-panel">
              <V2CardHeader>
                <div className="economy-panel-heading">
                  <span className="economy-icon economy-icon--warning"><Flame aria-hidden="true" /></span>
                  <div>
                    <h2 className="economy-panel-title">Bônus por acesso diário</h2>
                    <p className="economy-panel-copy">Entre na Classfy em dias consecutivos para liberar bônus.</p>
                  </div>
                </div>
                <V2Badge className="economy-streak-badge" variant="warning">{stats.currentStreak} dias seguidos</V2Badge>
              </V2CardHeader>
              <V2CardContent>
                <div className="economy-stat-list">
                  <div className="economy-stat-row">
                    <span className="economy-stat-row__label"><Flame />Acessos consecutivos agora</span>
                    <strong className="economy-stat-row__value">{stats.currentStreak} dias</strong>
                  </div>
                  <div className="economy-stat-row">
                    <span className="economy-stat-row__label"><Trophy />Seu recorde de acessos</span>
                    <strong className="economy-stat-row__value">{stats.longestStreak} dias</strong>
                  </div>
                  <div className="economy-stat-row">
                    <span className="economy-stat-row__label"><Sparkles />Bônus por 7 dias seguidos</span>
                    <strong className="economy-stat-row__value">faltam {nextStreakReward} dias</strong>
                  </div>
                </div>
              </V2CardContent>
            </V2Card>
          </div>
        </section>

        <section className="economy-section">
          <V2SectionHeader eyebrow="Atividade" title={isCreator ? "Seu estudo e sua criação" : "Suas ações na Classfy"} description="Veja o que foi registrado na sua conta." />
          <div className="economy-content-grid">
            <V2Card className="economy-panel">
              <V2CardHeader>
                <div className="economy-panel-heading">
                  <span className="economy-icon economy-icon--muted"><Zap aria-hidden="true" /></span>
                    <div><h2 className="economy-panel-title">Ações registradas</h2><p className="economy-panel-copy">Curtidas, salvos, comentários e conclusões</p></div>
                </div>
              </V2CardHeader>
              <V2CardContent className="economy-stat-list">
                {engagementRows.map(({ Icon, label, value }) => (
                  <div className="economy-stat-row" key={label}>
                    <span className="economy-stat-row__label"><Icon />{label}</span>
                    <strong className="economy-stat-row__value">{value.toLocaleString("pt-BR")}</strong>
                  </div>
                ))}
              </V2CardContent>
            </V2Card>

            {isCreator && stats.creatorStats ? (
              <V2Card className="economy-panel">
                <V2CardHeader>
                  <div className="economy-panel-heading">
                    <span className="economy-icon economy-icon--muted"><Star aria-hidden="true" /></span>
                    <div><h2 className="economy-panel-title">Resultados dos seus conteúdos</h2><p className="economy-panel-copy">Dados dos conteúdos já aprovados</p></div>
                  </div>
                </V2CardHeader>
                <V2CardContent className="economy-stat-list">
                  {creatorRows.map(({ Icon, label, value }) => (
                    <div className="economy-stat-row" key={label}>
                      <span className="economy-stat-row__label"><Icon />{label}</span>
                      <strong className="economy-stat-row__value">{value}</strong>
                    </div>
                  ))}
                </V2CardContent>
              </V2Card>
            ) : (
              <V2Card className="economy-panel">
                <V2CardContent className="flex min-h-[18rem] flex-col items-start justify-center">
                  <span className="economy-kicker">Próximo passo</span>
                  <h2 className="economy-balance-hero__headline">Continue estudando para acumular Points.</h2>
                  <p className="economy-panel-copy mt-3">Assista a conteúdos e participe das ações que geram recompensa.</p>
                  <V2Button className="mt-6" onClick={() => navigate("/")}>Explorar conteúdos</V2Button>
                </V2CardContent>
              </V2Card>
            )}
          </div>
        </section>

        <section className="economy-section economy-content-grid">
          {nextMilestone && (
            <V2Card className="economy-panel">
              <V2CardHeader>
                <div className="economy-panel-heading">
                  <span className="economy-icon"><Trophy aria-hidden="true" /></span>
                  <div><h2 className="economy-panel-title">Próxima conquista</h2><p className="economy-panel-copy">{nextMilestone.title}</p></div>
                </div>
                <V2Badge>Reconhecimento</V2Badge>
              </V2CardHeader>
              <V2CardContent>
                <strong className="economy-metric__value">
                  {nextMilestone.milestone_value.toLocaleString("pt-BR")} {typeLabel[nextMilestone.milestone_type] || ""}
                </strong>
                <div className="economy-progress mt-6"><span style={{ width: `${Math.min(100, nextMilestone.percentComplete)}%` }} /></div>
                <div className="economy-progress-copy">
                  <span>{nextMilestone.currentValue.toLocaleString("pt-BR")} de {nextMilestone.milestone_value.toLocaleString("pt-BR")}</span>
                  <span>{nextMilestone.percentComplete.toFixed(0)}% concluído</span>
                </div>
              </V2CardContent>
            </V2Card>
          )}
          <V2Card className="economy-panel">
            <V2CardContent className="flex min-h-[13rem] flex-col items-start justify-center">
              <span className="economy-kicker">Transparência</span>
              <h2 className="economy-panel-title mt-3">Veja como seus Points foram ganhos.</h2>
              <p className="economy-panel-copy">Consulte cada ação, data, tipo de Point e conteúdo relacionado.</p>
              <V2Button variant="secondary" className="mt-6" onClick={() => navigate("/rewards-history")}>Abrir histórico completo</V2Button>
            </V2CardContent>
          </V2Card>
        </section>
      </EconomyTemplate>
    </AppShell>
  );
}
