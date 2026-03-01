import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, Heart, Eye, Share2, MessageCircle, Zap } from "lucide-react";

interface PoolSimulatorProps {
  currentPP: number;
  totalPP: number;
  prm: number;
  currentEstimate: number;
}

const engagementTypes = [
  { key: "all", label: "Tudo", icon: Zap },
  { key: "likes", label: "Curtidas", icon: Heart },
  { key: "views", label: "Views", icon: Eye },
  { key: "shares", label: "Shares", icon: Share2 },
  { key: "comments", label: "Comentários", icon: MessageCircle },
];

export function PoolSimulator({ currentPP, totalPP, prm, currentEstimate }: PoolSimulatorProps) {
  const [activityIncrease, setActivityIncrease] = useState([30]);
  const [selectedType, setSelectedType] = useState("all");

  const simulation = useMemo(() => {
    const increase = activityIncrease[0];
    const newPP = currentPP * (1 + increase / 100);
    const newTotalPP = totalPP - currentPP + newPP;
    const newShare = newTotalPP > 0 ? (newPP / newTotalPP) * prm : 0;
    const difference = newShare - currentEstimate;

    return { newShare, difference };
  }, [activityIncrease, currentPP, totalPP, prm, currentEstimate]);

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {/* Left: controls */}
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Simule seus ganhos</p>
            <p className="text-xs text-muted-foreground">Veja quanto você ganharia engajando mais</p>
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
              <span className="text-xs text-muted-foreground">Aumento de engajamento</span>
              <span className="text-sm font-bold text-accent">+{activityIncrease[0]}%</span>
            </div>
            <Slider
              value={activityIncrease}
              onValueChange={setActivityIncrease}
              min={0}
              max={200}
              step={5}
            />
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
          {simulation.difference <= 0 && (
            <span className="text-xs text-muted-foreground mt-1.5">
              Mova o slider para simular
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
