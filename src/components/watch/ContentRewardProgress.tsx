import { useEffect, useState } from "react";
import { Eye, Heart, Bookmark, MessageCircle, CheckCircle2, PlayCircle, Zap } from "lucide-react";
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

export function ContentRewardProgress({ contentId, refreshTrigger, liveStates }: Props) {
  const { user } = useAuth();
  const [actions, setActions] = useState<ActionState[]>([]);
  const [earnedPP, setEarnedPP] = useState(0);
  const [loading, setLoading] = useState(true);

  // Initial load + PP refresh on trigger (delay para banco commitar)
  useEffect(() => {
    if (!user || !contentId) return;
    if (refreshTrigger === undefined || refreshTrigger === 0) {
      load();
    } else {
      const t = setTimeout(load, 400);
      return () => clearTimeout(t);
    }
  }, [user, contentId, refreshTrigger]);

  // Live dot state update — sem DB, instantâneo
  useEffect(() => {
    if (!liveStates || actions.length === 0) return;
    setActions(prev => prev.map(a => {
      if (a.key === "LIKE_CONTENT")    return { ...a, earned: liveStates.isLiked };
      if (a.key === "SAVE_CONTENT")    return { ...a, earned: liveStates.isSaved };
      return a;
    }));
  }, [liveStates?.isLiked, liveStates?.isSaved]);

  async function load() {
    setLoading(true);
    try {
      const uid = user!.id;

      // Fetch config + current real state of each reversible action in parallel
      const [configResult, eventsResult, likeResult, saveResult, favoriteResult, commentResult, trackingResult] = await Promise.all([
        supabase
          .from("reward_actions_config")
          .select("action_key, points_user")
          .in("action_key", TRACKED_ACTIONS.map(a => a.key))
          .eq("active", true),
        // PP total earned (reward_events never deleted even on unlike — reflects historical PP)
        supabase
          .from("reward_events")
          .select("action_key, points")
          .eq("user_id", uid)
          .eq("content_id", contentId),
        // Reversible: current like state
        supabase.from("actions").select("id").eq("user_id", uid).eq("content_id", contentId).eq("type", "LIKE").maybeSingle(),
        // Reversible: current save state
        supabase.from("saved_contents").select("id").eq("user_id", uid).eq("content_id", contentId).maybeSingle(),
        // Reversible: current favorite state
        supabase.from("favorites").select("id").eq("user_id", uid).eq("content_id", contentId).maybeSingle(),
        // Comment: check if user has commented
        supabase.from("comments").select("id").eq("user_id", uid).eq("content_id", contentId).limit(1),
        // Permanent: VIEW_15S, WATCH_50, WATCH_100 via tracking
        supabase
          .from("reward_action_tracking")
          .select("action_key")
          .eq("user_id", uid)
          .like("action_key", `%${contentId}%`),
      ]);

      const configMap: Record<string, number> = {};
      (configResult.data || []).forEach(r => { configMap[r.action_key] = r.points_user; });

      // Permanent actions (watching can't be "undone")
      const permanentKeys = new Set(
        (trackingResult.data || []).map(r => r.action_key.split(`_${contentId}`)[0])
      );

      // Real-time state for reversible actions
      const earnedMap: Record<string, boolean> = {
        VIEW_15S:        permanentKeys.has("VIEW_15S"),
        WATCH_50:        permanentKeys.has("WATCH_50"),
        WATCH_100:       permanentKeys.has("WATCH_100"),
        LIKE_CONTENT:    !!likeResult.data,
        SAVE_CONTENT:    !!saveResult.data,
        COMMENT_CONTENT: (commentResult.data?.length ?? 0) > 0,
      };

      // PP: sum only from currently active actions (removes PP if action reversed)
      const activeActions = (eventsResult.data || []).filter(e => {
        const key = e.action_key;
        // For reversible actions, only count if still active
        if (key === "LIKE_CONTENT") return earnedMap.LIKE_CONTENT;
        if (key === "SAVE_CONTENT") return earnedMap.SAVE_CONTENT;
        return true; // permanent actions always count
      });
      const totalPP = activeActions.reduce((sum, e) => sum + (e.points || 0), 0);

      const built: ActionState[] = TRACKED_ACTIONS.map(a => ({
        ...a,
        earned: earnedMap[a.key] ?? false,
        points: configMap[a.key] ?? 0,
      }));

      setActions(built);
      setEarnedPP(Math.round(totalPP * 10) / 10);
    } finally {
      setLoading(false);
    }
  }

  if (loading || actions.length === 0) return null;

  const availablePP = actions
    .filter(a => !a.earned && a.points > 0)
    .reduce((sum, a) => sum + a.points, 0);

  const allDone = availablePP === 0;

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card/60 border border-border/40 backdrop-blur-sm">
      {/* PP earned */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Zap className={cn("w-3.5 h-3.5", earnedPP > 0 ? "text-amber-400" : "text-muted-foreground")} />
        <span className={cn("text-sm font-semibold tabular-nums", earnedPP > 0 ? "text-amber-400" : "text-muted-foreground")}>
          +{earnedPP} PP
        </span>
      </div>

      <div className="w-px h-4 bg-border/60 shrink-0" />

      {/* Action dots */}
      <div className="flex items-center gap-2 flex-1">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <div
              key={action.key}
              className="group relative flex items-center justify-center"
              title={`${action.label}${action.points > 0 ? ` · +${action.points} PP` : ""}`}
            >
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300",
                action.earned
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/50 text-muted-foreground/40"
              )}>
                <Icon className="w-3 h-3" />
              </div>

              {/* Tooltip */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border rounded-md text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-50 shadow-md">
                <span className={action.earned ? "text-foreground" : "text-muted-foreground"}>
                  {action.label}
                </span>
                {action.points > 0 && (
                  <span className={cn("ml-1.5 font-medium", action.earned ? "text-amber-400" : "text-muted-foreground")}>
                    {action.earned ? `+${action.points} PP` : `+${action.points} PP`}
                  </span>
                )}
                {/* Arrow */}
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
            até +{availablePP} PP
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
