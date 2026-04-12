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

interface Props {
  contentId: string;
  refreshTrigger?: number;
}

export function ContentRewardProgress({ contentId, refreshTrigger }: Props) {
  const { user } = useAuth();
  const [actions, setActions] = useState<ActionState[]>([]);
  const [earnedPP, setEarnedPP] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !contentId) return;
    load();
  }, [user, contentId, refreshTrigger]);

  async function load() {
    setLoading(true);
    try {
      // Fetch PP config and earned events in parallel
      const [configResult, eventsResult, trackingResult] = await Promise.all([
        supabase
          .from("reward_actions_config")
          .select("action_key, points_user")
          .in("action_key", TRACKED_ACTIONS.map(a => a.key))
          .eq("active", true),
        supabase
          .from("reward_events")
          .select("action_key, points")
          .eq("user_id", user!.id)
          .eq("content_id", contentId),
        supabase
          .from("reward_action_tracking")
          .select("action_key")
          .eq("user_id", user!.id)
          .like("action_key", `%${contentId}%`),
      ]);

      const configMap: Record<string, number> = {};
      (configResult.data || []).forEach(r => { configMap[r.action_key] = r.points_user; });

      // Earned actions from tracking table (key format: ACTION_KEY_contentId)
      const earnedKeys = new Set(
        (trackingResult.data || []).map(r => r.action_key.split(`_${contentId}`)[0])
      );

      // Sum PP from events
      const totalPP = (eventsResult.data || []).reduce((sum, e) => sum + (e.points || 0), 0);

      const built: ActionState[] = TRACKED_ACTIONS.map(a => ({
        ...a,
        earned: earnedKeys.has(a.key),
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
