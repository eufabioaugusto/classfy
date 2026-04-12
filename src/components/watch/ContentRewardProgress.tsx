import { useEffect, useState, useRef, useCallback } from "react";
import { Eye, Heart, Bookmark, MessageCircle, CheckCircle2, PlayCircle, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface ActionState {
  key: string;
  label: string;
  icon: React.ElementType;
  earned: boolean;
  points: number;
}

const TRACKED_ACTIONS = [
  { key: "VIEW_15S",       label: "Assistiu",      icon: Eye },
  { key: "WATCH_50",       label: "50% concluído", icon: PlayCircle },
  { key: "WATCH_100",      label: "Completou",     icon: CheckCircle2 },
  { key: "LIKE_CONTENT",   label: "Curtiu",        icon: Heart },
  { key: "SAVE_CONTENT",   label: "Salvou",        icon: Bookmark },
  { key: "COMMENT_CONTENT",label: "Comentou",      icon: MessageCircle },
];

const WATCH_KEYS = new Set(["VIEW_15S", "WATCH_50", "WATCH_100", "COMMENT_CONTENT"]);

interface LiveStates {
  isLiked: boolean;
  isSaved: boolean;
  isFavorited: boolean;
}

interface Props {
  contentId: string;
  refreshTrigger?: number;
  liveStates?: LiveStates;
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

export function ContentRewardProgress({ contentId, refreshTrigger, liveStates }: Props) {
  const { user } = useAuth();
  const [actions, setActions] = useState<ActionState[]>([]);
  const [earnedPP, setEarnedPP] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [burstKeys, setBurstKeys] = useState<Set<string>>(new Set());

  // Keep a ref to current actions for use inside async load
  const actionsRef = useRef<ActionState[]>([]);
  actionsRef.current = actions;

  const triggerBurst = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setBurstKeys(prev => {
      const next = new Set(prev);
      keys.forEach(k => next.add(k));
      return next;
    });
    setTimeout(() => {
      setBurstKeys(prev => {
        const next = new Set(prev);
        keys.forEach(k => next.delete(k));
        return next;
      });
    }, 650);
  }, []);

  // Initial load
  useEffect(() => {
    if (!user || !contentId) return;
    load(true);
  }, [user, contentId]);

  // Refresh after action (with delay for DB commit) — only burst watch milestones
  useEffect(() => {
    if (!refreshTrigger || refreshTrigger === 0) return;
    if (!user || !contentId) return;
    const t = setTimeout(() => load(false), 400);
    return () => clearTimeout(t);
  }, [refreshTrigger]);

  // Live dot update for LIKE/SAVE — detect gain and burst instantly
  useEffect(() => {
    if (!liveStates || actionsRef.current.length === 0) return;

    const prev = actionsRef.current;
    const toTrigger: string[] = [];

    const wasLiked = prev.find(a => a.key === "LIKE_CONTENT")?.earned ?? false;
    const wasSaved = prev.find(a => a.key === "SAVE_CONTENT")?.earned ?? false;

    if (!wasLiked && liveStates.isLiked) toTrigger.push("LIKE_CONTENT");
    if (!wasSaved && liveStates.isSaved) toTrigger.push("SAVE_CONTENT");

    setActions(current => current.map(a => {
      if (a.key === "LIKE_CONTENT") return { ...a, earned: liveStates.isLiked };
      if (a.key === "SAVE_CONTENT") return { ...a, earned: liveStates.isSaved };
      return a;
    }));

    triggerBurst(toTrigger);
  }, [liveStates?.isLiked, liveStates?.isSaved]);

  async function load(isInitial: boolean) {
    try {
      const uid = user!.id;

      const [configResult, eventsResult, likeResult, saveResult, commentResult, trackingResult] = await Promise.all([
        supabase
          .from("reward_actions_config")
          .select("action_key, points_user")
          .in("action_key", TRACKED_ACTIONS.map(a => a.key))
          .eq("active", true),
        supabase
          .from("reward_events")
          .select("action_key, points")
          .eq("user_id", uid)
          .eq("content_id", contentId),
        supabase.from("actions").select("id").eq("user_id", uid).eq("content_id", contentId).eq("type", "LIKE").maybeSingle(),
        supabase.from("saved_contents").select("id").eq("user_id", uid).eq("content_id", contentId).maybeSingle(),
        supabase.from("comments").select("id").eq("user_id", uid).eq("content_id", contentId).limit(1),
        supabase
          .from("reward_action_tracking")
          .select("action_key")
          .eq("user_id", uid)
          .like("action_key", `%${contentId}%`),
      ]);

      const configMap: Record<string, number> = {};
      (configResult.data || []).forEach(r => { configMap[r.action_key] = r.points_user; });

      const permanentKeys = new Set(
        (trackingResult.data || []).map(r => r.action_key.split(`_${contentId}`)[0])
      );

      const earnedMap: Record<string, boolean> = {
        VIEW_15S:        permanentKeys.has("VIEW_15S"),
        WATCH_50:        permanentKeys.has("WATCH_50"),
        WATCH_100:       permanentKeys.has("WATCH_100"),
        LIKE_CONTENT:    !!likeResult.data,
        SAVE_CONTENT:    !!saveResult.data,
        COMMENT_CONTENT: (commentResult.data?.length ?? 0) > 0,
      };

      const activeEvents = (eventsResult.data || []).filter(e => {
        if (e.action_key === "LIKE_CONTENT") return earnedMap.LIKE_CONTENT;
        if (e.action_key === "SAVE_CONTENT") return earnedMap.SAVE_CONTENT;
        return true;
      });
      const totalPP = activeEvents.reduce((sum, e) => sum + (e.points || 0), 0);

      const built: ActionState[] = TRACKED_ACTIONS.map(a => ({
        ...a,
        earned: earnedMap[a.key] ?? false,
        points: configMap[a.key] ?? 0,
      }));

      // On refresh (not initial load): burst only newly-earned watch/comment milestones
      if (!isInitial) {
        const prev = actionsRef.current;
        const newlyEarned = built
          .filter(a => WATCH_KEYS.has(a.key))
          .filter(a => a.earned && !(prev.find(x => x.key === a.key)?.earned ?? false))
          .map(a => a.key);
        triggerBurst(newlyEarned);
      }

      setActions(built);
      setEarnedPP(Math.round(totalPP * 10) / 10);
    } finally {
      if (isInitial) setInitialLoading(false);
    }
  }

  if (initialLoading) return null;
  if (actions.length === 0) return null;

  const availablePP = Math.round(
    actions.filter(a => !a.earned && a.points > 0).reduce((sum, a) => sum + a.points, 0) * 10
  ) / 10;

  const allDone = availablePP === 0;

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card/60 border border-border/40 backdrop-blur-sm"
      style={{ overflow: "visible" }}
    >
      {/* PP earned */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Zap className={cn("w-3.5 h-3.5", earnedPP > 0 ? "text-red-500" : "text-muted-foreground")} />
        <motion.span
          key={earnedPP}
          initial={{ scale: earnedPP > 0 ? 1.35 : 1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={cn("text-sm font-semibold tabular-nums", earnedPP > 0 ? "text-red-500" : "text-muted-foreground")}
        >
          +{earnedPP} PP
        </motion.span>
      </div>

      <div className="w-px h-4 bg-border/60 shrink-0" />

      {/* Action dots */}
      <div className="flex items-center gap-2 flex-1" style={{ overflow: "visible" }}>
        {actions.map((action) => {
          const Icon = action.icon;
          const isBursting = burstKeys.has(action.key);
          return (
            <div
              key={action.key}
              className="group relative"
              style={{ overflow: "visible" }}
              title={`${action.label}${action.points > 0 ? ` · +${action.points} PP` : ""}`}
            >
              <DotBurst isActive={isBursting} />
              <motion.div
                animate={isBursting ? { scale: [1, 1.4, 1] } : {}}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center transition-colors duration-300",
                  action.earned
                    ? "bg-red-500/15 text-red-500"
                    : "bg-muted/50 text-muted-foreground/40"
                )}
              >
                <Icon className="w-3 h-3" />
              </motion.div>

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border rounded-md text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50 shadow-md">
                <span className={action.earned ? "text-foreground" : "text-muted-foreground"}>
                  {action.label}
                </span>
                {action.points > 0 && (
                  <span className={cn("ml-1.5 font-medium", action.earned ? "text-red-500" : "text-muted-foreground")}>
                    +{action.points} PP
                  </span>
                )}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-border" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Available PP hint */}
      {!allDone && (
        <>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <span className="text-xs text-muted-foreground shrink-0">
            Ganhe até +{availablePP} PP
          </span>
        </>
      )}

      {allDone && earnedPP > 0 && (
        <>
          <div className="w-px h-4 bg-border/60 shrink-0" />
          <span className="text-xs text-emerald-500 shrink-0 font-medium">
            Completo
          </span>
        </>
      )}
    </div>
  );
}
