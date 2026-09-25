import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CreditCard, Eye, MousePointerClick, Plus, Rocket, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/layout";
import { GlobalLoader } from "@/components/GlobalLoader";
import { CreatorTemplate } from "@/components/templates";
import { StudioMetricCard } from "@/components/studio/StudioMetricCard";
import { StudioNavigation } from "@/components/studio/StudioNavigation";
import { V2Button, V2Card, V2EmptyState, V2SectionHeader, V2Skeleton } from "@/components/v2";
import "@/styles/studio-v2.css";

type Boost = {
  id: string;
  objective: string;
  content_id: string | null;
  course_id: string | null;
  audience_type: string;
  audience_filters: Record<string, unknown> | null;
  daily_budget: number;
  duration_days: number;
  total_budget: number | null;
  impressions_count: number | null;
  clicks_count: number | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  contents: { title: string; thumbnail_url: string | null } | null;
  courses: { title: string; thumbnail_url: string | null } | null;
};

const statusLabels: Record<string, string> = {
  pending_payment: "Aguardando pagamento",
  active: "Ativo",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const formatMoney = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export default function StudioBoosts() {
  const { user, role, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [boosts, setBoosts] = useState<Boost[]>([]);
  const [loading, setLoading] = useState(true);

  const loadBoosts = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("boosts")
        .select("*, contents(title, thumbnail_url), courses(title, thumbnail_url)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setBoosts((data || []) as unknown as Boost[]);
    } catch (error) {
      console.error("Error loading boosts:", error);
      toast.error("Não foi possível carregar seus boosts.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) void loadBoosts();
  }, [loadBoosts, user]);

  const summary = useMemo(() => {
    const impressions = boosts.reduce((sum, boost) => sum + Number(boost.impressions_count || 0), 0);
    const clicks = boosts.reduce((sum, boost) => sum + Number(boost.clicks_count || 0), 0);
    const invested = boosts.filter((boost) => boost.status !== "cancelled").reduce((sum, boost) => sum + Number(boost.total_budget || boost.daily_budget * boost.duration_days), 0);
    return { active: boosts.filter((boost) => boost.status === "active").length, impressions, clicks, invested };
  }, [boosts]);

  const handleRetryPayment = async (boost: Boost) => {
    try {
      const { data, error } = await supabase.functions.invoke("create-boost-payment", {
        body: {
          boostData: {
            objective: boost.objective,
            contentId: boost.content_id,
            courseId: boost.course_id,
            itemType: boost.course_id ? "curso" : "aula",
            audienceType: boost.audience_type,
            audienceFilters: boost.audience_filters || {},
            dailyBudget: boost.daily_budget,
            durationDays: boost.duration_days,
            boostId: boost.id,
          },
        },
      });
      if (error) throw error;
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
        toast.success("Abrindo o pagamento do boost...");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível abrir o pagamento.");
    }
  };

  const handleCancelBoost = async (boostId: string) => {
    if (!window.confirm("Cancelar este boost? Esta ação não pode ser desfeita.")) return;
    try {
      const { error } = await supabase.from("boosts").delete().eq("id", boostId);
      if (error) throw error;
      toast.success("Boost cancelado.");
      await loadBoosts();
    } catch (error) {
      console.error("Error cancelling boost:", error);
      toast.error("Não foi possível cancelar o boost.");
    }
  };

  if (authLoading) return <GlobalLoader label="Carregando boosts" />;
  if (!user || (role !== "creator" && role !== "admin")) return <Navigate to="/" replace />;

  return (
    <AppShell variant="studio" title="Boosts" contentClassName="studio-page-shell">
      <CreatorTemplate
        className="studio-template"
        width="wide"
        density="comfortable"
        header={
          <PageHeader
            eyebrow="Alcance pago"
            title="Leve seu conteúdo mais longe."
            description="Acompanhe campanhas, investimento e resposta da audiência em um só lugar."
            action={<V2Button variant="primary" leadingIcon={<Plus className="h-4 w-4" />} onClick={() => navigate("/studio/contents")}>Criar novo boost</V2Button>}
          />
        }
        toolbar={<StudioNavigation />}
      >
        <div className="studio-stack">
          <section className="studio-section">
            <V2SectionHeader eyebrow="Resumo" title="Resultado das campanhas" description="Veja quanto foi investido e o alcance gerado pelos seus boosts." />
            <div className="studio-metrics">
              <StudioMetricCard icon={Rocket} label="Boosts ativos" value={summary.active} detail={`${boosts.length} campanhas no histórico`} tone="accent" />
              <StudioMetricCard icon={Eye} label="Impressões" value={summary.impressions.toLocaleString("pt-BR")} detail="Exibições acumuladas" tone="success" />
              <StudioMetricCard icon={MousePointerClick} label="Cliques" value={summary.clicks.toLocaleString("pt-BR")} detail={summary.impressions > 0 ? `${((summary.clicks / summary.impressions) * 100).toFixed(1)}% de taxa de clique` : "Aguardando interações"} />
              <StudioMetricCard icon={Wallet} label="Investimento" value={formatMoney(summary.invested)} detail="Campanhas não canceladas" tone="warning" />
            </div>
          </section>

          <section className="studio-section">
            <V2SectionHeader eyebrow="Campanhas" title="Seus boosts" description="Acompanhe o status e os principais resultados de cada campanha." />
            {loading ? (
              <div className="studio-boost-grid" aria-label="Carregando boosts">
                {[1, 2, 3].map((item) => <V2Card className="studio-boost-card" key={item}><V2Skeleton className="block aspect-[16/8] rounded-none" /><div className="studio-boost-card__content"><V2Skeleton className="h-5 w-3/4" /><V2Skeleton className="h-20 w-full" /></div></V2Card>)}
              </div>
            ) : boosts.length === 0 ? (
              <V2EmptyState icon={<Rocket className="h-5 w-5" />} title="Nenhuma campanha criada" description="Escolha um conteúdo publicado, defina o público e acompanhe o resultado por aqui." action={<V2Button onClick={() => navigate("/studio/contents")}>Escolher conteúdo para impulsionar</V2Button>} />
            ) : (
              <div className="studio-boost-grid">
                {boosts.map((boost) => {
                  const total = Number(boost.total_budget || boost.daily_budget * boost.duration_days);
                  const promotedItem = boost.contents || boost.courses;
                  return (
                    <V2Card className="studio-boost-card" key={boost.id}>
                      <div className="studio-boost-card__media">
                        {promotedItem?.thumbnail_url ? <img src={promotedItem.thumbnail_url} alt="" /> : <div className="grid h-full place-items-center"><Rocket className="h-7 w-7 text-[var(--cf2-ink-subtle)]" /></div>}
                        <span className="studio-status" data-status={boost.status}>{statusLabels[boost.status] || boost.status}</span>
                      </div>
                      <div className="studio-boost-card__content">
                        <div><span className="studio-boost-card__objective">{boost.objective === "profile" ? "Boost de perfil" : boost.course_id ? "Boost de curso" : "Boost de conteúdo"}</span><h3 className="studio-boost-card__title">{boost.objective === "profile" ? "Alcance do perfil" : promotedItem?.title || "Conteúdo"}</h3></div>
                        <div className="studio-boost-card__metrics">
                          <div className="studio-boost-card__metric"><span>Orçamento diário</span><strong>{formatMoney(Number(boost.daily_budget))}</strong></div>
                          <div className="studio-boost-card__metric"><span>Duração</span><strong>{boost.duration_days} dias</strong></div>
                          <div className="studio-boost-card__metric"><span>Impressões</span><strong>{Number(boost.impressions_count || 0).toLocaleString("pt-BR")}</strong></div>
                          <div className="studio-boost-card__metric"><span>Cliques</span><strong>{Number(boost.clicks_count || 0).toLocaleString("pt-BR")}</strong></div>
                        </div>
                        {(boost.start_date || boost.end_date) && <p className="studio-boost-card__objective">{boost.start_date ? `De ${format(new Date(boost.start_date), "dd MMM", { locale: ptBR })}` : ""}{boost.end_date ? ` até ${format(new Date(boost.end_date), "dd MMM", { locale: ptBR })}` : ""}</p>}
                        <div className="studio-boost-card__footer">
                          <div><span>Investimento total</span><strong>{formatMoney(total)}</strong></div>
                          {boost.status === "pending_payment" && <div className="flex gap-2"><V2Button size="sm" leadingIcon={<CreditCard className="h-3.5 w-3.5" />} onClick={() => void handleRetryPayment(boost)}>Pagar</V2Button><V2Button variant="danger" size="icon" aria-label="Cancelar boost" onClick={() => void handleCancelBoost(boost.id)}><Trash2 className="h-4 w-4" /></V2Button></div>}
                        </div>
                      </div>
                    </V2Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </CreatorTemplate>
    </AppShell>
  );
}
