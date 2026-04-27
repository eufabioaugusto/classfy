import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useNavigate } from "react-router-dom";
import {
  CheckCircle2, RefreshCw, TrendingUp, PartyPopper,
  UserPlus, Share2, Star, Zap, ShoppingCart, Calendar, PlayCircle,
  Heart, ArrowUpCircle, ChevronDown, Lock,
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
  totalPP?: number;
}

export function QualificacaoCard({
  estimatedPoolShare,
  performancePoints,
  poolTotal,
  totalPP,
}: QualificacaoCardProps = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [qualified, setQualified] = useState(false);
  const [qp, setQp] = useState(0);
  const [threshold, setThreshold] = useState(60);
  const [plan, setPlan] = useState('free');
  const [details, setDetails] = useState<QualDetails | null>(null);
  const [maturationDays, setMaturationDays] = useState<number | null>(null);
  const [accountAgeDays, setAccountAgeDays] = useState<number>(0);
  const [collapsed, setCollapsed] = useState(true);

  const isHeroMode = estimatedPoolShare !== undefined;
  const ppPercent = totalPP && totalPP > 0 && performancePoints
    ? (performancePoints / totalPP) * 100
    : 0;
  const progressPct = threshold > 0 ? Math.min(100, (qp / threshold) * 100) : 0;
  const isBlockedByMaturation = maturationDays !== null && accountAgeDays < maturationDays;

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
        .select('plan, created_at')
        .eq('id', user.id)
        .single();
      const userPlan = profile?.plan || 'free';
      setPlan(userPlan);
      setMaturationDays(planConfig?.[userPlan]?.maturation_days ?? null);
      if (profile?.created_at) {
        const age = Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000);
        setAccountAgeDays(age);
      }

      if (!cycle) { setLoading(false); setRefreshing(false); return; }

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

  if (loading) {
    return (
      <Card className="p-5 animate-pulse">
        <div className="h-4 bg-muted rounded w-1/3 mb-3" />
        <div className="h-7 bg-muted rounded w-1/2 mb-2" />
        <div className="h-2 bg-muted rounded" />
      </Card>
    );
  }


  return (
    <Card className={qualified ? 'border-green-500/30 bg-gradient-to-br from-green-500/5 to-emerald-500/5' : ''}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-4">
          {/* Left: main info */}
          <div className="flex-1 min-w-0">
            {isHeroMode ? (
              qualified ? (
                <>
                  <p className="text-sm text-muted-foreground mb-2">Sua parte do pool este mês</p>
                  <div className="text-4xl font-bold text-accent flex items-center gap-2">
                    <TrendingUp className="w-8 h-8 shrink-0" />
                    R$ {estimatedPoolShare!.toFixed(2)}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-sm text-muted-foreground">
                    {ppPercent > 0 && <span>{ppPercent.toFixed(1)}% do pool</span>}
                    {ppPercent > 0 && poolTotal !== undefined && <span>·</span>}
                    {poolTotal !== undefined && <span>R$ {poolTotal.toFixed(2)} disponível</span>}
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-2">Pool Mensal</p>
                  <div className="text-3xl font-bold text-foreground">
                    R$ {(poolTotal ?? 0).toFixed(2)}
                    <span className="text-base font-normal text-muted-foreground ml-2">disponível este ciclo</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5">
                    Complete os critérios abaixo para participar da distribuição
                  </p>
                </>
              )
            ) : (
              <p className="font-semibold text-base">Participação no Pool Mensal</p>
            )}
          </div>

          {/* Right: badge + collapse */}
          <div className="flex items-center gap-2 shrink-0">
            {qualified ? (
              <Badge
                className="gap-1 bg-green-600 hover:bg-green-700 cursor-pointer select-none"
                onClick={() => loadQualification(true)}
              >
                <CheckCircle2 className="w-3 h-3" />
                Participando
                <RefreshCw className={`w-3 h-3 ml-0.5 ${refreshing ? 'animate-spin' : ''}`} />
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="gap-1 text-muted-foreground hover:border-foreground/40 cursor-pointer select-none"
                onClick={() => setCollapsed(c => !c)}
              >
                {isBlockedByMaturation ? (
                  <><Lock className="w-3 h-3" /> Bloqueado</>
                ) : (
                  'Como participar'
                )}
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

      {!collapsed && (
        <CardContent className="space-y-5">
          {isHeroMode && <Separator className="-mt-2 mb-1" />}

          {/* Status summary line */}
          {qualified ? (
            <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1.5">
              <PartyPopper className="w-3.5 h-3.5 shrink-0" />
              Você está dentro — sua parte será calculada ao fechar o ciclo.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Plano: <strong className="capitalize text-foreground">{plan}</strong>
            </p>
          )}

          {/* Critérios — estilo YouTube */}
          <div className="space-y-5">
            {/* 1. Maturação — sempre primeiro */}
            {maturationDays !== null && (
              <div>
                <Progress
                  value={Math.min(100, (accountAgeDays / maturationDays) * 100)}
                  className="h-1.5 mb-2"
                  indicatorClassName={!isBlockedByMaturation ? 'bg-green-500' : 'bg-primary'}
                />
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className={`text-sm leading-snug ${!isBlockedByMaturation ? 'text-green-600 dark:text-green-400 font-medium' : ''}`}>
                      {accountAgeDays} {accountAgeDays === 1 ? 'dia' : 'dias'} de conta
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {isBlockedByMaturation
                        ? <>Faltam <strong>{maturationDays - accountAgeDays} dias</strong> · <button onClick={() => navigate('/planos')} className="text-accent underline-offset-2 hover:underline">libere antes com Pro ou Premium</button></>
                        : 'período de carência cumprido'}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground tabular-nums shrink-0">{maturationDays} dias</span>
                </div>
              </div>
            )}

            {/* 2. Outros critérios */}
            {details ? Object.entries(CHECKPOINT_META).map(([key, { label, tip }]) => {
              const cp = (details as any)[key] as CheckpointDetail | undefined;
              if (!cp) return null;
              const completed = cp.qp > 0 || cp.active === true;

              let leftLabel = label;
              let rightLabel: string | null = null;
              let pct = completed ? 100 : 0;

              if (cp.count !== undefined && cp.required !== undefined) {
                // Critério com contagem e meta definida
                leftLabel = `${cp.count.toLocaleString()} ${label.toLowerCase()}`;
                rightLabel = cp.required.toLocaleString();
                pct = Math.min(100, (cp.count / cp.required) * 100);
              } else if (cp.count !== undefined) {
                // Critério com contagem mas sem meta explícita — mínimo 1
                leftLabel = `${cp.count.toLocaleString()} ${label.toLowerCase()}`;
                rightLabel = '1';
                pct = completed ? 100 : 0;
              } else if (cp.active !== undefined) {
                // Critério binário (ativo/inativo)
                rightLabel = 'Ativo';
              }

              return (
                <div key={key}>
                  <Progress
                    value={pct}
                    className="h-1.5 mb-2"
                    indicatorClassName={completed ? 'bg-green-500' : 'bg-primary'}
                  />
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className={`text-sm leading-snug ${completed ? 'text-green-600 dark:text-green-400 font-medium' : ''}`}>
                        {leftLabel}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{tip}</p>
                    </div>
                    {rightLabel && (
                      <span className="text-sm text-muted-foreground tabular-nums shrink-0">{rightLabel}</span>
                    )}
                  </div>
                </div>
              );
            }) : (
              <p className="text-sm text-center text-muted-foreground py-3">
                Expanda para verificar seus critérios.
              </p>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
