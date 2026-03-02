import { useState, useMemo, useEffect } from "react";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, Heart, Eye, Share2, MessageCircle, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface PoolSimulatorProps {
  currentPP: number;
  totalPP: number;
  prm: number;
  currentEstimate: number;
}

// Maps engagement filter keys to action_key values in reward_actions_config
const engagementTypes = [
  { key: "all", label: "Tudo", icon: Zap, actionKeys: ["LIKE_CONTENT", "COMMENT_CONTENT", "SAVE_CONTENT", "FAVORITE_CONTENT", "SHARE_CONTENT"] },
  { key: "likes", label: "Curtidas", icon: Heart, actionKeys: ["LIKE_CONTENT"] },
  { key: "views", label: "Views", icon: Eye, actionKeys: ["SAVE_CONTENT"] },
  { key: "shares", label: "Shares", icon: Share2, actionKeys: ["SHARE_CONTENT", "FAVORITE_CONTENT"] },
  { key: "comments", label: "Comentários", icon: MessageCircle, actionKeys: ["COMMENT_CONTENT"] },
];

// Default points per action (fallback if DB fetch fails)
const DEFAULT_ACTION_POINTS: Record<string, number> = {
  LIKE_CONTENT: 2, COMMENT_CONTENT: 5, SAVE_CONTENT: 2, FAVORITE_CONTENT: 3, SHARE_CONTENT: 5,
};

export function PoolSimulator({ currentPP, totalPP, prm, currentEstimate }: PoolSimulatorProps) {
  const [simulatedActions, setSimulatedActions] = useState([50]);
  const [selectedType, setSelectedType] = useState("all");
  const [actionPoints, setActionPoints] = useState<Record<string, number>>(DEFAULT_ACTION_POINTS);

  // Fetch real action point values from reward_actions_config
  useEffect(() => {
    supabase
      .from("reward_actions_config")
      .select("action_key, points_user, active")
      .eq("active", true)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const map: Record<string, number> = {};
          data.forEach((row) => {
            map[row.action_key] = row.points_user;
          });
          setActionPoints((prev) => ({ ...prev, ...map }));
        }
      });
  }, []);

  // Convert the number of actions into weighted points based on selected type
  const simulation = useMemo(() => {
    const actionCount = simulatedActions[0];
    const selected = engagementTypes.find((t) => t.key === selectedType) || engagementTypes[0];

    // Calculate simulated points from new actions
    let simulatedPP: number;
    let pointsPerAction: number;

    if (selected.actionKeys.length === 1) {
      pointsPerAction = actionPoints[selected.actionKeys[0]] ?? 1;
      simulatedPP = Math.round(actionCount * pointsPerAction);
    } else {
      // "Tudo": distribute actions equally across all types
      const actionsPerType = actionCount / selected.actionKeys.length;
      const totalPoints = selected.actionKeys.reduce(
        (sum, at) => sum + actionsPerType * (actionPoints[at] ?? 1),
        0
      );
      simulatedPP = Math.round(totalPoints);
      pointsPerAction = actionCount > 0 ? totalPoints / actionCount : 0;
    }

    // Calculate proportional value of simulated PP
    // Use a realistic baseline so early-month simulations aren't inflated
    // Min baseline ensures results stay grounded even when pool is nearly empty
    const MIN_POOL_BASELINE = 5000;
    const effectiveTotalPP = Math.max(totalPP, MIN_POOL_BASELINE);

    // The proportional share these simulated points would earn
    const poolWithSimulated = effectiveTotalPP + simulatedPP;
    const simulatedValue = poolWithSimulated > 0 ? (simulatedPP / poolWithSimulated) * prm : 0;

    return { simulatedValue, isEstimated: totalPP < MIN_POOL_BASELINE, simulatedPP, pointsPerAction };
  }, [simulatedActions, selectedType, actionPoints, currentPP, totalPP, prm, currentEstimate]);

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Left: controls */}
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Simule seus ganhos</p>
            <p className="text-xs text-muted-foreground">Veja quanto você ganharia com mais pontos no pool</p>
          </div>

          {/* Engagement type selector */}
          <div className="flex flex-wrap gap-1.5">
            {engagementTypes.map((type) => {
              const Icon = type.icon;
              const isActive = selectedType === type.key;
              return (
                <button
                  key={type.key}
                  onClick={() => setSelectedType(type.key)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {type.label}
                </button>
              );
            })}
          </div>

          {/* Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Se você fizesse</span>
              <span className="text-sm font-bold text-accent">{simulatedActions[0]} ações</span>
            </div>
            <Slider
              value={simulatedActions}
              onValueChange={setSimulatedActions}
              min={0}
              max={500}
              step={5}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0</span>
              <span>500</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              = {simulation.simulatedPP.toLocaleString('pt-BR')} pontos ({simulation.pointsPerAction.toFixed(0)} pts/ação)
            </p>
          </div>
        </div>

        {/* Right: result */}
        <div className="flex flex-col items-center justify-center rounded-lg bg-muted/50 p-4 text-center">
          <span className="text-xs text-muted-foreground mb-1">Esses pontos valeriam</span>
          <span className="text-2xl sm:text-3xl font-bold text-accent">
            R$ {simulation.simulatedValue.toFixed(2)}
          </span>
          {simulatedActions[0] === 0 && (
            <span className="text-xs text-muted-foreground mt-1.5">
              Mova o slider para simular
            </span>
          )}
          {simulation.isEstimated && simulatedActions[0] > 0 && (
            <span className="text-xs text-muted-foreground mt-1">
              * Estimativa baseada em projeção do pool
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
