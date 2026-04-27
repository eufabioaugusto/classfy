import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, XCircle, RefreshCw, Lock, TrendingUp, PartyPopper,
  UserPlus, Share2, Star, Zap, ShoppingCart, Calendar, PlayCircle,
  Heart, ArrowUpCircle, ChevronDown,
  type LucideIcon,
} from "lucide-react";

interface CheckpointDetail {
  count?: number;
  active?: boolean;
  qp: number;
  required?: number;
}

interface QualDetails {
  threshold: number;
  plan: string;
  share_content?: CheckpointDetail;
  referral_signup?: CheckpointDetail;
  referral_upgrade?: CheckpointDetail;
  subscription_paid?: CheckpointDetail;
  boost_purchased?: CheckpointDetail;
  content_purchased?: CheckpointDetail;
  active_days?: CheckpointDetail;
  content_completed?: CheckpointDetail;
  engagement?: CheckpointDetail;
}

const CHECKPOINT_META: Record<string, { label: string; Icon: LucideIcon; tip: string }> = {
  referral_upgrade:  { label: 'Indicação convertida',  Icon: ArrowUpCircle, tip: 'Indicado fez upgrade pago' },
  referral_signup:   { label: 'Indicação cadastrada',  Icon: UserPlus,      tip: 'Novo usuário pelo seu link' },
  share_content:     { label: 'Compartilhou conteúdo', Icon: Share2,        tip: 'Shares de conteúdo no mês' },
  subscription_paid: { label: 'Plano pago ativo',      Icon: Star,          tip: 'Pro ou Premium ativo' },
  boost_purchased:   { label: 'Boost comprado',        Icon: Zap,           tip: 'Boost adquirido no mês' },
  content_purchased: { label: 'Conteúdo comprado',     Icon: ShoppingCart,  tip: 'Compra de conteúdo pago' },
  active_days:       { label: 'Dias ativos',           Icon: Calendar,      tip: 'Mínimo de dias no mês' },
  content_completed: { label: 'Conteúdos completados', Icon: PlayCircle,    tip: 'Assistidos até o fim' },
  engagement:        { label: 'Engajamento',           Icon: Heart,         tip: 'Likes, saves e comentários' },
};

interface QualificacaoCardProps {
  estimatedPoolShare?: number;
  performancePoints?: number;
  poolTotal?: number;
}

export function QualificacaoCard({ estimatedPoolShare, performancePoints, poolTotal }: QualificacaoCardProps = {}) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qualified, setQualified] = useState(false);
  const [qp, setQp] = useState(0);
  const [threshold, setThreshold] = useState(60);
  const [plan, setPlan] = useState('free');
  const [details, setDetails] = useState<QualDetails | null>(null);
  const [maturationDays, setMaturationDays] = useState<number | null>(null);

  const isHeroMode = estimatedPoolShare !== undefined;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (user) loadQualification(false);
  }, [user]);

  const loadQualification = async (forceRefresh = false) => {
    if (!user) return;
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const now = new Date();
      const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const { data: cycle } = await supabase
        .from('economic_cycles')
        .select('id')
        .eq('year_month', yearMonth)
        .maybeSingle();

      const { data: settings } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'economic')
        .single();
      const planConfig = (settings?.value as any)?.plan_config;

      const { data: profile } = await supabase
        .from('profiles')
        .select('plan')
        .eq('id', user.id)
        .single();
      const userPlan = profile?.plan || 'free';
      setPlan(userPlan);
      setMaturationDays(planConfig?.[userPlan]?.maturation_days ?? null);

      if (!cycle) {
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (forceRefresh) {
        await supabase.rpc('evaluate_pool_qualification', {
          p_user_id: user.id,
          p_cycle_id: cycle.id,
        });
      }

      const { data: ecu } = await supabase
        .from('economic_cycle_users')
        .select('qualified_for_pool, qualification_points, qualification_details')
        .eq('cycle_id', cycle.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (ecu) {
        setQualified(ecu.qualified_for_pool);
        setQp(Number(ecu.qualification_points));
        const d = ecu.qualification_details as QualDetails;
        setDetails(d);
        setThreshold(d?.threshold ?? 60);
      } else if (forceRefresh) {
        const { data: res } = await supabase.rpc('evaluate_pool_qualification', {
          p_user_id: user.id,
          p_cycle_id: cycle.id,
        });
        if (res) {
          setQualified(res.qualified);
          setQp(res.qualification_points);
          setDetails(res.details);
          setThreshold(res.threshold);
        }
      }
    } catch (err) {
      console.error('Error loading qualification:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const progressPct = threshold > 0 ? Math.min(100, (qp / threshold) * 100) : 0;

  if (loading) {
    return (
      <Card className="p-6 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3 mb-4" />
        <div className="h-2 bg-muted rounded mb-3" />
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-10 bg-muted rounded" />)}
        </div>
      </Card>
    );
  }

  return (
    <Card className={isHeroMode && qualified ? 'border-green-500/30 bg-gradient-to-br from-green-500/5 to-emerald-500/5' : ''}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            {isHeroMode ? (
              <>
                <p className="text-sm text-muted-foreground mb-2">Estimativa do Pool Mensal</p>
                <div className="text-4xl font-bold text-accent flex items-center gap-2">
                  <TrendingUp className="w-8 h-8 shrink-0" />
                  R$ {estimatedPoolShare!.toFixed(2)}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-sm text-muted-foreground">
                  {performancePoints !== undefined && (
                    <span>{performancePoints.toLocaleString()} PP neste ciclo</span>
                  )}
                  {performancePoints !== undefined && poolTotal !== undefined && <span>·</span>}
                  {poolTotal !== undefined && <span>Pool: R$ {poolTotal.toFixed(2)}</span>}
                </div>
              </>
            ) : (
              <p className="font-semibold text-base">Qualificação para o Pool</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {qualified ? (
              <Badge
                className="gap-1 bg-green-600 hover:bg-green-700 cursor-pointer select-none"
                onClick={() => loadQualification(true)}
              >
                <CheckCircle2 className="w-3 h-3" />
                Qualificado
                <RefreshCw className={`w-3 h-3 ml-0.5 ${refreshing ? 'animate-spin' : ''}`} />
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 text-muted-foreground hover:border-foreground/40 cursor-pointer select-none"
                onClick={() => loadQualification(true)}
              >
                <Lock className="w-3 h-3" />
                Não qualificado
                <RefreshCw className={`w-3 h-3 ml-0.5 ${refreshing ? 'animate-spin' : ''}`} />
              </Badge>
            )}
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => setCollapsed(c => !c)}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`} />
            </Button>
          </div>
        </div>
      </CardHeader>

      {!collapsed && <CardContent className="space-y-4">
        {isHeroMode && <Separator className="-mt-1 mb-1" />}

        {/* QP Progress */}
        <div>
          <div className="flex justify-between text-sm mb-1.5">
            <span className="text-muted-foreground">Pontos de qualificação</span>
            <span className="font-semibold">
              {qp.toFixed(0)}
              <span className="text-muted-foreground font-normal"> / {threshold} QP</span>
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
          {qualified ? (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1.5">
              <PartyPopper className="w-3.5 h-3.5 shrink-0" />
              Você está no pool deste ciclo!
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-1.5">
              Faltam {Math.max(0, threshold - qp).toFixed(0)} QP para qualificar.
            </p>
          )}
        </div>

        {/* Plano + maturação */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
          <span>Plano: <strong className="capitalize text-foreground">{plan}</strong></span>
          {maturationDays !== null && (
            <>
              <span>·</span>
              <span>Maturação: <strong className="text-foreground">{maturationDays} dias</strong></span>
            </>
          )}
        </div>

        {/* Checkpoints — 2 colunas */}
        {details && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {Object.entries(CHECKPOINT_META).map(([key, { label, Icon, tip }]) => {
              const cp = (details as any)[key] as CheckpointDetail | undefined;
              if (!cp) return null;
              const completed = cp.qp > 0 || cp.active === true;

              return (
                <div
                  key={key}
                  className={`flex items-center justify-between p-2 rounded-lg border ${
                    completed
                      ? 'border-green-500/30 bg-green-500/10'
                      : 'border-border bg-background'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${completed ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-none truncate">{label}</p>
                      {cp.count !== undefined && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {cp.count}{cp.required ? ` / ${cp.required}` : ''}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {completed ? (
                      <>
                        <span className="text-xs font-semibold text-green-600 dark:text-green-400">+{cp.qp}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-muted-foreground">+?</span>
                        <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!details && (
          <p className="text-sm text-center text-muted-foreground py-4">
            Clique em atualizar para calcular sua qualificação.
          </p>
        )}
      </CardContent>}
    </Card>
  );
}
