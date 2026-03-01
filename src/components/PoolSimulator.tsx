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

// Maps engagement filter keys to action_type values in actions_config
const engagementTypes = [
  { key: "all", label: "Tudo", icon: Zap, actionTypes: ["VIEW", "LIKE", "COMMENT", "SAVE", "FAVORITE"] },
  { key: "likes", label: "Curtidas", icon: Heart, actionTypes: ["LIKE"] },
  { key: "views", label: "Views", icon: Eye, actionTypes: ["VIEW"] },
  { key: "shares", label: "Shares", icon: Share2, actionTypes: ["SAVE", "FAVORITE"] },
  { key: "comments", label: "Comentários", icon: MessageCircle, actionTypes: ["COMMENT"] },
];

// Default points per action (fallback if DB fetch fails)
const DEFAULT_ACTION_POINTS: Record<string, number> = {
  VIEW: 1, LIKE: 2, SAVE: 3, FAVORITE: 5, COMMENT: 10,
};

export function PoolSimulator({ currentPP, totalPP, prm, currentEstimate }: PoolSimulatorProps) {
  const [simulatedActions, setSimulatedActions] = useState([50]);
  const [selectedType, setSelectedType] = useState("all");
  const [actionPoints, setActionPoints] = useState<Record<string, number>>(DEFAULT_ACTION_POINTS);

  // Fetch real action point values from actions_config
  useEffect(() => {
    supabase
      .from("actions_config")
      .select("action_type, base_points, active")
      .eq("active", true)
      .then(({ data }) => {
        if (data && data.length > 0) {
          const map: Record<string, number> = {};
          data.forEach((row) => {
            map[row.action_type] = row.base_points;
          });
          setActionPoints((prev) => ({ ...prev, ...map }));
        }
      });
  }, []);

  // Convert the number of actions into weighted points based on selected type
  const simulation = useMemo(() => {
    const actionCount = simulatedActions[0];
    const selected = engagementTypes.find((t) => t.key === selectedType) || engagementTypes[0];

    // Calculate total simulated points
    let simulatedPP: number;
    let pointsPerAction: number;

    if (selected.actionTypes.length === 1) {
      // Single type: all actions are of this type
      pointsPerAction = actionPoints[selected.actionTypes[0]] ?? 1;
      simulatedPP = Math.round(actionCount * pointsPerAction);
    } else {
      // "Tudo": user does actionCount of EACH type (full engagement scenario)
      const totalPoints = selected.actionTypes.reduce(
        (sum, at) => sum + actionCount * (actionPoints[at] ?? 1),
        0
      );
      simulatedPP = Math.round(totalPoints);
      // Show total pts per "round" of all actions combined
      pointsPerAction = selected.actionTypes.reduce((sum, at) => sum + (actionPoints[at] ?? 1), 0);
    }

    const ESTIMATED_POOL_BASELINE = 5000;
    const effectiveTotalPP = totalPP > 0 ? totalPP : ESTIMATED_POOL_BASELINE;

    const newTotalPP = effectiveTotalPP - currentPP + simulatedPP;
    const newShare = newTotalPP > 0 ? (simulatedPP / newTotalPP) * prm : 0;
    const difference = newShare - currentEstimate;

    return { newShare, difference, isEstimated: totalPP === 0, simulatedPP, pointsPerAction };
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
          <span className="text-xs text-muted-foreground mb-1">Você ganharia</span>
          <span className="text-2xl sm:text-3xl font-bold text-accent">
            R$ {simulation.newShare.toFixed(2)}
          </span>
          {simulation.difference > 0 && (
            <span className="inline-flex items-center gap-1 mt-1.5 text-sm font-medium text-green-500">
              <TrendingUp className="w-3.5 h-3.5" />
              +R$ {simulation.difference.toFixed(2)} a mais
            </span>
          )}
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
