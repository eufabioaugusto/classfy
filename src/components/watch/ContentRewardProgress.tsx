import { useEffect, useState, useRef, useCallback } from "react";
import {
  Eye,
  Heart,
  Bookmark,
  MessageCircle,
  Check,
  CheckCircle2,
  PlayCircle,
  Zap,
  Sparkles,
  Brain,
  Coins,
  ChevronRight,
  Star,
  Share2,
} from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import {
  fetchStudyJourneySummary,
  type StudyJourneySummary,
  toShortTitle,
} from "@/lib/study/getStudyJourneySummary";
import { subscribeToRewardEarned } from "@/lib/rewards/events";

interface ActionState {
  key: string;
  label: string;
  icon: React.ElementType;
  earned: boolean;
  points: number;
}

const TRACKED_ACTIONS = [
  { key: "VIEW_15S", label: "Assistiu", icon: Eye },
  { key: "WATCH_50", label: "50% concluído", icon: PlayCircle },
  { key: "WATCH_100", label: "Completou", icon: CheckCircle2 },
  { key: "LIKE", label: "Curtiu", icon: Heart },
  { key: "SAVE", label: "Salvou", icon: Bookmark },
  { key: "FAVORITE", label: "Favoritou", icon: Star },
  { key: "COMMENT", label: "Comentou", icon: MessageCircle },
  { key: "SHARE", label: "Compartilhou", icon: Share2 },
];

const WATCH_KEYS = new Set(["VIEW_15S", "WATCH_50", "WATCH_100", "COMMENT"]);

interface LiveStates {
  isLiked: boolean;
  isSaved: boolean;
  isFavorited: boolean;
}

interface Props {
  contentId: string;
  refreshTrigger?: number;
  liveStates?: LiveStates;
  studyId?: string | null;
  studyTitle?: string | null;
}

// Stable particle config (no re-randomize on re-render)
const PARTICLES = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  angle: (360 / 8) * i + (i % 2 === 0 ? 8 : -8),
  distance: 20 + (i % 3) * 6,
  size: 4 + (i % 2) * 2,
  delay: i * 0.02,
}));

function DotBurst({ isActive }: { isActive: boolean }) {
  return (
    <AnimatePresence>
      {isActive && (
        <div
          className="absolute pointer-events-none z-20"
          style={{ inset: 0, overflow: "visible" }}
        >
          {PARTICLES.map((p) => {
            const rad = (p.angle * Math.PI) / 180;
            return (
              <motion.div
                key={p.id}
                className="absolute rounded-full bg-red-500"
                style={{
                  width: p.size,
                  height: p.size,
                  top: "50%",
                  left: "50%",
                  marginTop: -p.size / 2,
                  marginLeft: -p.size / 2,
                }}
                initial={{ scale: 0, x: 0, y: 0, opacity: 1 }}
                animate={{
                  scale: [0, 1.4, 0.5],
                  x: Math.cos(rad) * p.distance,
                  y: Math.sin(rad) * p.distance,
                  opacity: [1, 0.9, 0],
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, delay: p.delay, ease: "easeOut" }}
              />
            );
          })}
        </div>
      )}
    </AnimatePresence>
  );
}

export function ContentRewardProgress({
  contentId,
  refreshTrigger,
  liveStates,
  studyId,
  studyTitle,
}: Props) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [actions, setActions] = useState<ActionState[]>([]);
  const [earnedPoints, setEarnedPoints] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [burstKeys, setBurstKeys] = useState<Set<string>>(new Set());
  const [resolvedStudyTitle, setResolvedStudyTitle] = useState(
    studyTitle?.trim() || "",
  );
  const [studySummary, setStudySummary] = useState<StudyJourneySummary | null>(
    null,
  );
  const [studyLoading, setStudyLoading] = useState(false);
  const [pointBurst, setPointBurst] = useState<{
    id: number;
    points: number;
  } | null>(null);
  const pointBurstSequence = useRef(0);
  const optimisticActionPointsRef = useRef<Map<string, number>>(new Map());
  const liveIsLiked = liveStates?.isLiked;
  const liveIsSaved = liveStates?.isSaved;
  const liveIsFavorited = liveStates?.isFavorited;

  // Keep a ref to current actions for use inside async load
  const actionsRef = useRef<ActionState[]>([]);
  actionsRef.current = actions;

  const triggerBurst = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setBurstKeys((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => next.add(k));
      return next;
    });
    setTimeout(() => {
      setBurstKeys((prev) => {
        const next = new Set(prev);
        keys.forEach((k) => next.delete(k));
        return next;
      });
    }, 650);
  }, []);

  // Initial load
  useEffect(() => {
    if (studyId) return;
    if (!user || !contentId) return;
    load(true);
  }, [user, contentId, studyId]);

  // Refresh after action (with delay for DB commit) — only burst watch milestones
  useEffect(() => {
    if (studyId) return;
    if (!refreshTrigger || refreshTrigger === 0) return;
    if (!user || !contentId) return;
    const t = setTimeout(() => load(false), 400);
    return () => clearTimeout(t);
  }, [refreshTrigger, studyId]);

  // O retorno confirmado da Edge Function atualiza a barra imediatamente.
  // A leitura posterior do banco continua sendo a reconciliacao definitiva.
  useEffect(() => {
    if (studyId || !user?.id || !contentId) return;

    let animationTimer: number | undefined;
    const unsubscribe = subscribeToRewardEarned((reward) => {
      if (
        reward.userId !== user.id ||
        reward.contentId !== contentId ||
        reward.points === 0
      )
        return;

      if (reward.points < 0) {
        const revertedActionKey = reward.actionKey.replace(/_REVERSED$/, "");
        optimisticActionPointsRef.current.delete(revertedActionKey);
        setEarnedPoints((current) =>
          Math.max(0, Math.round((current + reward.points) * 10) / 10),
        );
        setActions((current) =>
          current.map((action) =>
            action.key === revertedActionKey
              ? { ...action, earned: false }
              : action,
          ),
        );
        pointBurstSequence.current += 1;
        setPointBurst({
          id: pointBurstSequence.current,
          points: reward.points,
        });
        window.clearTimeout(animationTimer);
        animationTimer = window.setTimeout(() => setPointBurst(null), 900);
        return;
      }

      const optimisticPoints = optimisticActionPointsRef.current.get(
        reward.actionKey,
      );
      optimisticActionPointsRef.current.delete(reward.actionKey);

      if (optimisticPoints === undefined) {
        pointBurstSequence.current += 1;
        setPointBurst({
          id: pointBurstSequence.current,
          points: reward.points,
        });
        setEarnedPoints(
          (current) => Math.round((current + reward.points) * 10) / 10,
        );
        triggerBurst([reward.actionKey]);
      } else if (optimisticPoints !== reward.points) {
        setEarnedPoints(
          (current) =>
            Math.round((current + reward.points - optimisticPoints) * 10) / 10,
        );
      }

      setActions((current) =>
        current.map((action) =>
          action.key === reward.actionKey
            ? { ...action, earned: true }
            : action,
        ),
      );

      window.clearTimeout(animationTimer);
      animationTimer = window.setTimeout(() => setPointBurst(null), 900);
    });

    return () => {
      unsubscribe();
      window.clearTimeout(animationTimer);
    };
  }, [contentId, studyId, triggerBurst, user?.id]);

  useEffect(() => {
    setResolvedStudyTitle(studyTitle?.trim() || "");
  }, [studyId, studyTitle]);

  useEffect(() => {
    let cancelled = false;

    async function loadStudySummary() {
      if (!studyId || !user?.id) {
        setStudySummary(null);
        setStudyLoading(false);
        return;
      }

      setStudyLoading(true);
      try {
        let title = studyTitle?.trim() || resolvedStudyTitle;

        if (!title) {
          const { data, error } = await supabase
            .from("studies")
            .select("title")
            .eq("id", studyId)
            .eq("user_id", user.id)
            .maybeSingle();

          if (error) throw error;
          title = data?.title?.trim() || "Estudo";
        }

        if (cancelled) return;
        setResolvedStudyTitle(title);

        const summary = await fetchStudyJourneySummary({
          studyId,
          userId: user.id,
          title,
        });

        if (!cancelled) {
          setStudySummary(summary);
        }
      } catch (error) {
        console.error("Error loading study reward progress:", error);
        if (!cancelled) setStudySummary(null);
      } finally {
        if (!cancelled) setStudyLoading(false);
      }
    }

    loadStudySummary();

    return () => {
      cancelled = true;
    };
  }, [resolvedStudyTitle, studyId, studyTitle, user?.id, refreshTrigger]);

  // LIKE, SAVE e FAVORITE aparecem assim que a evidencia foi persistida.
  // O evento confirmado do servidor corrige qualquer diferenca e o load
  // posterior reconcilia o total definitivo do ledger.
  useEffect(() => {
    if (studyId) return;
    if (
      liveIsLiked === undefined ||
      liveIsSaved === undefined ||
      liveIsFavorited === undefined ||
      actionsRef.current.length === 0
    )
      return;

    const prev = actionsRef.current;
    const toTrigger: string[] = [];
    const rollbackKeys = new Set<string>();
    let rollbackPoints = 0;

    const wasLiked = prev.find((a) => a.key === "LIKE")?.earned ?? false;
    const wasSaved = prev.find((a) => a.key === "SAVE")?.earned ?? false;
    const wasFavorited =
      prev.find((a) => a.key === "FAVORITE")?.earned ?? false;

    if (!wasLiked && liveIsLiked) toTrigger.push("LIKE");
    if (!wasSaved && liveIsSaved) toTrigger.push("SAVE");
    if (!wasFavorited && liveIsFavorited) toTrigger.push("FAVORITE");

    // Se a gravacao da acao falhar, o pai desfaz o estado otimista. Removemos
    // tambem a previa visual dos Points; eventos ja confirmados nao ficam neste
    // mapa e, portanto, nunca sao revertidos apenas por estado de interface.
    if (!liveIsLiked && optimisticActionPointsRef.current.has("LIKE")) {
      rollbackPoints += optimisticActionPointsRef.current.get("LIKE") || 0;
      optimisticActionPointsRef.current.delete("LIKE");
      rollbackKeys.add("LIKE");
    }
    if (!liveIsSaved && optimisticActionPointsRef.current.has("SAVE")) {
      rollbackPoints += optimisticActionPointsRef.current.get("SAVE") || 0;
      optimisticActionPointsRef.current.delete("SAVE");
      rollbackKeys.add("SAVE");
    }
    if (!liveIsFavorited && optimisticActionPointsRef.current.has("FAVORITE")) {
      rollbackPoints += optimisticActionPointsRef.current.get("FAVORITE") || 0;
      optimisticActionPointsRef.current.delete("FAVORITE");
      rollbackKeys.add("FAVORITE");
    }

    if (rollbackPoints > 0) {
      setEarnedPoints((current) =>
        Math.max(0, Math.round((current - rollbackPoints) * 10) / 10),
      );
    }

    const optimisticPoints = toTrigger.reduce((sum, actionKey) => {
      const points =
        prev.find((action) => action.key === actionKey)?.points || 0;
      if (points > 0) optimisticActionPointsRef.current.set(actionKey, points);
      return sum + points;
    }, 0);

    if (optimisticPoints > 0) {
      pointBurstSequence.current += 1;
      setPointBurst({
        id: pointBurstSequence.current,
        points: optimisticPoints,
      });
      setEarnedPoints(
        (current) => Math.round((current + optimisticPoints) * 10) / 10,
      );
      window.setTimeout(() => setPointBurst(null), 900);
    }

    setActions((current) =>
      current.map((a) => {
        if (rollbackKeys.has(a.key)) return { ...a, earned: false };
        if (a.key === "LIKE") return { ...a, earned: a.earned || liveIsLiked };
        if (a.key === "SAVE") return { ...a, earned: a.earned || liveIsSaved };
        if (a.key === "FAVORITE")
          return { ...a, earned: a.earned || liveIsFavorited };
        return a;
      }),
    );

    triggerBurst(toTrigger);
  }, [liveIsFavorited, liveIsLiked, liveIsSaved, studyId, triggerBurst]);

  async function load(isInitial: boolean) {
    try {
      const uid = user!.id;

      const [configResult, eventsResult, trackingResult, settingsResult] =
        await Promise.all([
          supabase
            .from("reward_actions_config")
            .select("action_key, points_user")
            .in(
              "action_key",
              TRACKED_ACTIONS.map((a) => a.key),
            )
            .eq("active", true),
          supabase
            .from("reward_events")
            .select("action_key, points")
            .eq("user_id", uid)
            .eq("content_id", contentId),
          supabase
            .from("reward_action_tracking")
            .select("action_key")
            .eq("user_id", uid)
            .like("action_key", `%${contentId}%`),
          supabase.rpc("get_economic_v1_settings"),
        ]);

      const settings =
        settingsResult.data && typeof settingsResult.data === "object"
          ? (settingsResult.data as {
              user_points_multipliers?: Record<string, number>;
            })
          : null;
      const plan =
        profile?.plan === "pro" || profile?.plan === "premium"
          ? profile.plan
          : "free";
      const configuredMultiplier = Number(
        settings?.user_points_multipliers?.[plan] ?? 1,
      );
      const pointsMultiplier =
        Number.isFinite(configuredMultiplier) && configuredMultiplier > 0
          ? configuredMultiplier
          : 1;
      const configMap: Record<string, number> = {};
      (configResult.data || []).forEach((r) => {
        configMap[r.action_key] =
          Math.round(Number(r.points_user || 0) * pointsMultiplier * 100) / 100;
      });

      const permanentKeys = new Set(
        (trackingResult.data || []).map(
          (r) => r.action_key.split(`_${contentId}`)[0],
        ),
      );

      const earnedMap: Record<string, boolean> = {
        VIEW_15S: permanentKeys.has("VIEW_15S"),
        WATCH_50: permanentKeys.has("WATCH_50"),
        WATCH_100: permanentKeys.has("WATCH_100"),
        LIKE: permanentKeys.has("LIKE"),
        SAVE: permanentKeys.has("SAVE"),
        FAVORITE: permanentKeys.has("FAVORITE"),
        COMMENT: permanentKeys.has("COMMENT"),
        SHARE: permanentKeys.has("SHARE"),
      };

      // A barra representa apenas as recompensas deste conteudo. Bonus globais
      // (como primeiro conteudo da semana) aparecem no saldo, mas nao distorcem
      // o total "ganho x ainda disponivel" desta faixa.
      const trackedKeys = new Set(TRACKED_ACTIONS.map((action) => action.key));
      const activeEvents = (eventsResult.data || []).filter((event) =>
        trackedKeys.has(event.action_key),
      );
      const totalPoints = activeEvents.reduce(
        (sum, e) => sum + (e.points || 0),
        0,
      );

      const built: ActionState[] = TRACKED_ACTIONS.map((a) => ({
        ...a,
        earned: earnedMap[a.key] ?? false,
        points: configMap[a.key] ?? 0,
      }));

      // On refresh (not initial load): burst only newly-earned watch/comment milestones
      if (!isInitial) {
        const prev = actionsRef.current;
        const newlyEarned = built
          .filter((a) => WATCH_KEYS.has(a.key))
          .filter(
            (a) =>
              a.earned && !(prev.find((x) => x.key === a.key)?.earned ?? false),
          )
          .map((a) => a.key);
        triggerBurst(newlyEarned);
      }

      setActions(built);
      setEarnedPoints(Math.round(totalPoints * 10) / 10);
      optimisticActionPointsRef.current.clear();
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }

  if (studyId) {
    const title =
      studySummary?.shortTitle || toShortTitle(resolvedStudyTitle) || "Estudo";
    const progressPercent = studySummary?.progressPercent ?? 0;
    const stageLabel = studySummary?.stageLabel || "Em andamento";
    const rewardPoints = studySummary?.rewardPoints ?? 0;

    return (
      <button
        type="button"
        onClick={() => navigate(`/c/${studyId}`)}
        className="group w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-950 px-3 py-2.5 text-left text-white shadow-sm transition-colors hover:border-white/20 hover:bg-zinc-900"
      >
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 shrink-0 text-red-400" />
            <span className="min-w-0 flex-1 truncate font-semibold">
              {title}
            </span>
            {studyLoading && !studySummary ? (
              <span className="shrink-0 text-xs text-white/45">
                Carregando...
              </span>
            ) : (
              <>
                <span className="shrink-0 font-semibold tabular-nums text-white">
                  {progressPercent}%
                </span>
                <span className="hidden h-1 w-1 shrink-0 rounded-full bg-white/35 min-[420px]:block" />
                <span className="hidden shrink-0 items-center gap-1 text-white/70 min-[420px]:inline-flex">
                  <Brain className="h-3.5 w-3.5" />
                  {stageLabel}
                </span>
                <span className="hidden h-1 w-1 shrink-0 rounded-full bg-white/35 min-[560px]:block" />
                <span className="hidden shrink-0 items-center gap-1 font-semibold text-white min-[560px]:inline-flex">
                  <Coins className="h-3.5 w-3.5 text-white/60" />
                  {rewardPoints.toLocaleString("pt-BR")} Points
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Progress
              value={progressPercent}
              className="h-1.5 flex-1 rounded-full bg-white/15"
              indicatorClassName="bg-red-500"
            />
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-white/82 transition-colors group-hover:text-white">
              Plano de estudo
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </div>
      </button>
    );
  }

  if (initialLoading) return null;
  if (actions.length === 0) return null;

  const availablePoints =
    Math.round(
      actions
        .filter((a) => !a.earned && a.points > 0)
        .reduce((sum, a) => sum + a.points, 0) * 10,
    ) / 10;

  const allDone = availablePoints === 0;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card/60 border border-border/40 backdrop-blur-sm"
      style={{ overflow: "visible" }}
    >
      {/* Points ganhos */}
      <div
        className="relative flex items-center gap-1.5 shrink-0"
        style={{ overflow: "visible" }}
      >
        <DotBurst isActive={Boolean(pointBurst)} />
        <motion.div
          animate={
            pointBurst ? { scale: [1, 1.55, 1], rotate: [0, -12, 8, 0] } : {}
          }
          transition={{ duration: 0.48, ease: "easeOut" }}
        >
          <Zap
            className={cn(
              "w-3.5 h-3.5",
              earnedPoints > 0 ? "text-red-500" : "text-muted-foreground",
            )}
          />
        </motion.div>
        <motion.span
          key={earnedPoints}
          initial={{ scale: earnedPoints > 0 ? 1.35 : 1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={cn(
            "text-sm font-semibold tabular-nums",
            earnedPoints > 0 ? "text-red-500" : "text-muted-foreground",
          )}
        >
          +{earnedPoints} Points
        </motion.span>
        <AnimatePresence>
          {pointBurst && (
            <motion.span
              key={pointBurst.id}
              className="pointer-events-none absolute left-5 top-1/2 z-30 whitespace-nowrap text-xs font-bold text-red-500"
              initial={{ y: 2, scale: 0.7, opacity: 0 }}
              animate={{ y: -24, scale: [0.7, 1.18, 1], opacity: [0, 1, 1] }}
              exit={{ y: -34, opacity: 0 }}
              transition={{ duration: 0.72, ease: "easeOut" }}
            >
              {pointBurst.points > 0 ? "+" : ""}
              {pointBurst.points} Point
              {Math.abs(pointBurst.points) === 1 ? "" : "s"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="w-px h-4 bg-border/60 shrink-0" />

      {/* Action dots */}
      <div
        className="flex items-center gap-2 flex-1"
        style={{ overflow: "visible" }}
      >
        {actions.map((action) => {
          const Icon = action.icon;
          const isBursting = burstKeys.has(action.key);
          return (
            <div
              key={action.key}
              className="group relative"
              style={{ overflow: "visible" }}
              title={`${action.label}${action.points > 0 ? ` · +${action.points} pts` : ""}`}
            >
              <DotBurst isActive={isBursting} />
              <motion.div
                animate={isBursting ? { scale: [1, 1.4, 1] } : {}}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300",
                  action.earned
                    ? "bg-red-500/15 text-red-500"
                    : "bg-muted/50 text-muted-foreground/40",
                )}
              >
                <Icon className="w-3 h-3" />
              </motion.div>

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border rounded-md text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50 shadow-md">
                <span
                  className={
                    action.earned ? "text-foreground" : "text-muted-foreground"
                  }
                >
                  {action.label}
                </span>
                {action.points > 0 && (
                  <span
                    className={cn(
                      "ml-1.5 font-medium",
                      action.earned ? "text-red-500" : "text-muted-foreground",
                    )}
                  >
                    +{action.points} pts
                  </span>
                )}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Points ainda disponíveis */}
      {!allDone && (
        <>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <span className="text-xs text-muted-foreground shrink-0">
            Ainda disponíveis: +{availablePoints} Points
          </span>
        </>
      )}

      {allDone && earnedPoints > 0 && (
        <>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <motion.div
            className="relative isolate flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full border border-emerald-400/45 bg-emerald-500/12 px-2.5 py-1 text-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.12)]"
            animate={
              reduceMotion
                ? undefined
                : {
                    boxShadow: [
                      "0 0 10px rgba(16,185,129,0.10)",
                      "0 0 22px rgba(16,185,129,0.28)",
                      "0 0 10px rgba(16,185,129,0.10)",
                    ],
                  }
            }
            transition={{ duration: 2.8, ease: "easeInOut", repeat: Infinity }}
            aria-label="Todas as recompensas deste conteúdo foram conquistadas"
          >
            {!reduceMotion && (
              <motion.span
                aria-hidden="true"
                className="absolute inset-y-0 -left-8 w-7 skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/35 to-transparent"
                animate={{ x: [0, 150] }}
                transition={{
                  duration: 2.6,
                  ease: "easeInOut",
                  repeat: Infinity,
                  repeatDelay: 1.2,
                }}
              />
            )}
            <motion.span
              aria-hidden="true"
              className="relative grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.45)]"
              animate={reduceMotion ? undefined : { scale: [1, 1.08, 1] }}
              transition={{
                duration: 2.8,
                ease: "easeInOut",
                repeat: Infinity,
              }}
            >
              <Check className="h-3 w-3 stroke-[3.25]" />
            </motion.span>
            <span className="relative text-xs font-bold tracking-wide">
              Completo
            </span>
            <Sparkles aria-hidden="true" className="relative h-3 w-3" />
          </motion.div>
        </>
      )}
    </div>
  );
}
