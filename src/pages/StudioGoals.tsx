import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Check,
  Eye,
  Gift,
  Heart,
  Lock,
  Plus,
  Target,
  Trophy,
  Users,
  Video,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  type CreatorMilestone,
  type MilestoneWithProgress,
  useCreatorMilestones,
} from "@/hooks/useCreatorMilestones";
import { AppShell, PageHeader } from "@/components/layout";
import { CreatorTemplate } from "@/components/templates";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import {
  V2Button,
  V2Card,
  V2EmptyState,
  V2SectionHeader,
  V2Table,
  V2TableWrap,
} from "@/components/v2";
import "@/styles/studio-v2.css";

type MilestoneType = CreatorMilestone["milestone_type"];

const milestoneTypes: Array<{
  id: "all" | MilestoneType;
  label: string;
  Icon: typeof Trophy;
}> = [
  { id: "all", label: "Todas", Icon: Trophy },
  { id: "contents", label: "Produção", Icon: Video },
  { id: "followers", label: "Audiência", Icon: Users },
  { id: "earnings", label: "Monetização", Icon: Wallet },
  { id: "views", label: "Alcance", Icon: Eye },
  { id: "engagement", label: "Engajamento", Icon: Heart },
];

const typeLabels: Record<MilestoneType, string> = {
  contents: "Produção",
  followers: "Audiência",
  earnings: "Monetização",
  views: "Alcance",
  engagement: "Engajamento",
};

const typeIcons: Record<MilestoneType, typeof Trophy> = {
  contents: Video,
  followers: Users,
  earnings: Wallet,
  views: Eye,
  engagement: Heart,
};

const formatValue = (value: number, type: MilestoneType) => {
  if (type === "earnings") {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  if (type === "engagement") return `${value.toLocaleString("pt-BR")}%`;
  return value.toLocaleString("pt-BR");
};

const rewardLabel = (milestone: MilestoneWithProgress) => {
  if (milestone.progress?.reward_status === "legacy_ignored") return "Conquista anterior · sem pagamento";
  if (milestone.progress?.reward_status === "awarded") {
    return `+${milestone.progress.reward_points.toLocaleString("pt-BR")} Creator Points recebidos`;
  }
  if (milestone.reward_enabled) return `+${milestone.reward_points.toLocaleString("pt-BR")} Creator Points`;
  return "Sem recompensa em Points";
};

function GoalStatus({ milestone }: { milestone: MilestoneWithProgress }) {
  if (milestone.isClaimed) {
    return <span className="studio-status" data-status="completed"><Check aria-hidden="true" />Reconhecida</span>;
  }
  if (milestone.isCompleted) {
    return <span className="studio-status" data-status="pending"><Gift aria-hidden="true" />Pronta para resgatar</span>;
  }
  return <span className="studio-status"><Lock aria-hidden="true" />Em progresso</span>;
}

function GoalProgress({ milestone }: { milestone: MilestoneWithProgress }) {
  return (
    <div className="studio-goal-progress">
      <div className="studio-goal-progress__copy">
        <span>{formatValue(milestone.currentValue, milestone.milestone_type)} de {formatValue(milestone.milestone_value, milestone.milestone_type)}</span>
        <strong>{milestone.percentComplete}%</strong>
      </div>
      <div className="studio-progress" aria-label={`${milestone.percentComplete}% concluído`}>
        <span style={{ width: `${milestone.percentComplete}%` }} />
      </div>
    </div>
  );
}

export default function StudioGoals() {
  const { user, role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [activeType, setActiveType] = useState<"all" | MilestoneType>("all");
  const {
    milestones,
    milestonesByType,
    stats,
    loading,
    claiming,
    claimMilestone,
    totals,
  } = useCreatorMilestones(user?.id);

  const overallProgress = totals.total > 0
    ? Math.round((totals.claimed / totals.total) * 100)
    : 0;
  const filteredMilestones = useMemo(
    () => activeType === "all" ? milestones : milestonesByType[activeType],
    [activeType, milestones, milestonesByType],
  );
  const remaining = Math.max(0, totals.total - totals.completed);

  if (authLoading || loading) {
    return (
      <div className="cf-v2 min-h-screen grid place-items-center bg-[var(--cf2-canvas)]">
        <div className="cf2-state"><span className="cf2-state__spinner" /><strong>Organizando suas metas...</strong></div>
      </div>
    );
  }

  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;

  const countForType = (type: "all" | MilestoneType) => (
    type === "all" ? milestones.length : milestonesByType[type].length
  );

  const renderAction = (milestone: MilestoneWithProgress) => {
    if (milestone.isClaimed) return <span className="studio-goal-action-label"><Check aria-hidden="true" />Concluída</span>;
    if (milestone.isCompleted) {
      return (
        <V2Button
          size="sm"
          leadingIcon={<Gift className="h-3.5 w-3.5" />}
          disabled={claiming === milestone.id}
          onClick={() => void claimMilestone(milestone.id)}
        >
          {claiming === milestone.id ? "Registrando..." : milestone.reward_enabled ? "Receber prêmio" : "Reconhecer"}
        </V2Button>
      );
    }

    const missing = Math.max(0, milestone.milestone_value - milestone.currentValue);
    return <span className="studio-goal-action-label">Faltam {formatValue(missing, milestone.milestone_type)}</span>;
  };

  return (
    <AppShell variant="studio" title="Metas" contentClassName="studio-page-shell">
      <CreatorTemplate
        className="studio-template"
        width="wide"
        density="comfortable"
        header={
          <PageHeader
            eyebrow="Metas do Studio"
            title="Transforme crescimento em conquistas."
            description="Veja exatamente o que conta para cada meta, quanto falta e quais Creator Points serão liberados."
            action={<V2Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => navigate("/studio/upload?type=aula")}>Publicar conteúdo</V2Button>}
          />
        }
        toolbar={<StudioNavigation />}
      >
        <div className="studio-stack">
          <section className="studio-section">
            <V2Card className="studio-goals-overview">
              <img className="studio-goals-overview__star" src="/progress_illustration.png" alt="" />
              <div className="studio-goals-overview__main">
                <span className="studio-kicker">Progresso geral</span>
                <h2>{totals.claimed} de {totals.total} metas reconhecidas</h2>
                <p>{totals.pendingClaims > 0 ? `${totals.pendingClaims} ${totals.pendingClaims === 1 ? "meta está pronta" : "metas estão prontas"} para resgate.` : "Avance nas metas para liberar conquistas e Creator Points."}</p>
                <div className="studio-progress" aria-label={`${overallProgress}% das metas reconhecidas`}><span style={{ width: `${overallProgress}%` }} /></div>
              </div>
              <div className="studio-goals-overview__totals">
                <div><strong>{totals.completed}</strong><span>Concluídas</span></div>
                <div><strong>{totals.pendingClaims}</strong><span>Para resgatar</span></div>
                <div><strong>{remaining}</strong><span>Em andamento</span></div>
              </div>
            </V2Card>
          </section>

          {stats && (
            <section className="studio-section">
              <V2SectionHeader eyebrow="Seus números" title="O que já conta para suas metas" description="Estes resultados são usados para calcular automaticamente seu progresso." />
              <V2Card className="studio-goals-snapshot">
                <div><Video aria-hidden="true" /><span>Publicações</span><strong>{stats.totalContents.toLocaleString("pt-BR")}</strong></div>
                <div><Users aria-hidden="true" /><span>Seguidores</span><strong>{stats.totalFollowers.toLocaleString("pt-BR")}</strong></div>
                <div><Eye aria-hidden="true" /><span>Visualizações</span><strong>{stats.totalViews.toLocaleString("pt-BR")}</strong></div>
                <div><Wallet aria-hidden="true" /><span>Ganhos</span><strong>{stats.totalEarnings.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></div>
                <div><BarChart3 aria-hidden="true" /><span>Engajamento</span><strong>{stats.engagementRate.toLocaleString("pt-BR")}%</strong></div>
              </V2Card>
            </section>
          )}

          <section className="studio-section">
            <V2SectionHeader eyebrow="Tabela de metas" title="Acompanhe cada conquista" description="Filtre por objetivo e consulte progresso, recompensa e situação sem sair da tela." />

            <div className="studio-goal-filters" role="group" aria-label="Filtrar metas por objetivo">
              {milestoneTypes.map(({ id, label, Icon }) => (
                <button type="button" key={id} data-active={activeType === id || undefined} onClick={() => setActiveType(id)}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  <small>{countForType(id)}</small>
                </button>
              ))}
            </div>

            {filteredMilestones.length === 0 ? (
              <V2EmptyState icon={<Target className="h-5 w-5" />} title="Nenhuma meta nesta categoria" description="Escolha outro objetivo para consultar as metas disponíveis." />
            ) : (
              <>
                <V2TableWrap className="studio-table-wrap studio-goal-table">
                  <V2Table>
                    <thead><tr><th>Meta</th><th>Seu progresso</th><th>Recompensa</th><th>Situação</th><th><span className="sr-only">Ação</span></th></tr></thead>
                    <tbody>
                      {filteredMilestones.map((milestone) => {
                        const Icon = typeIcons[milestone.milestone_type];
                        return (
                          <tr key={milestone.id}>
                            <td><div className="studio-goal-name"><span className="studio-icon"><Icon /></span><div><strong>{milestone.title}</strong><p>{milestone.description || typeLabels[milestone.milestone_type]}</p></div></div></td>
                            <td><GoalProgress milestone={milestone} /></td>
                            <td><span className="studio-goal-reward" data-awarded={milestone.progress?.reward_status === "awarded" || undefined}>{rewardLabel(milestone)}</span></td>
                            <td><GoalStatus milestone={milestone} /></td>
                            <td><div className="studio-row-actions">{renderAction(milestone)}</div></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </V2Table>
                </V2TableWrap>

                <div className="studio-goal-mobile-list">
                  {filteredMilestones.map((milestone) => {
                    const Icon = typeIcons[milestone.milestone_type];
                    return (
                      <V2Card className="studio-goal-mobile-card" key={milestone.id}>
                        <div className="studio-goal-mobile-card__header"><span className="studio-icon"><Icon /></span><GoalStatus milestone={milestone} /></div>
                        <div><h3>{milestone.title}</h3><p>{milestone.description || typeLabels[milestone.milestone_type]}</p></div>
                        <GoalProgress milestone={milestone} />
                        <div className="studio-goal-mobile-card__footer"><span className="studio-goal-reward">{rewardLabel(milestone)}</span>{renderAction(milestone)}</div>
                      </V2Card>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      </CreatorTemplate>
    </AppShell>
  );
}
