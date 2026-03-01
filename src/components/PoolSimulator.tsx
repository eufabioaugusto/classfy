import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { TrendingUp } from "lucide-react";

interface PoolSimulatorProps {
  currentPP: number;
  totalPP: number;
  prm: number;
  currentEstimate: number;
}

export function PoolSimulator({ currentPP, totalPP, prm, currentEstimate }: PoolSimulatorProps) {
  const [activityIncrease, setActivityIncrease] = useState([0]);

  const simulation = useMemo(() => {
    const increase = activityIncrease[0];
    const newPP = currentPP * (1 + increase / 100);
    const newTotalPP = totalPP - currentPP + newPP;
    const newShare = newTotalPP > 0 ? (newPP / newTotalPP) * prm : 0;
    const difference = newShare - currentEstimate;

    return { newShare, difference };
  }, [activityIncrease, currentPP, totalPP, prm, currentEstimate]);

  return (
    <div className="rounded-lg bg-foreground px-4 py-2.5 space-y-1.5">
      {/* Line 1: descriptive sentence with inline slider */}
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        <span className="text-xs text-background/70 whitespace-nowrap">💰 Se você engajar</span>
        <div className="w-[100px] shrink-0">
          <Slider
            value={activityIncrease}
            onValueChange={setActivityIncrease}
            min={0}
            max={200}
            step={5}
            className="py-0 [&_[data-radix-slider-track]]:h-1 [&_[data-radix-slider-track]]:bg-background/20 [&_[data-radix-slider-range]]:bg-accent [&_[data-radix-slider-thumb]]:h-3 [&_[data-radix-slider-thumb]]:w-3 [&_[data-radix-slider-thumb]]:border-accent"
          />
        </div>
        <span className="text-xs font-bold text-accent shrink-0">+{activityIncrease[0]}%</span>
        <span className="text-xs text-background/70 whitespace-nowrap">mais este mês...</span>
      </div>

      {/* Line 2: result */}
      <div className="flex items-center gap-1.5 text-xs">
        <span className="text-background/60">Você ganharia</span>
        <span className="font-semibold text-accent">R$ {simulation.newShare.toFixed(2)}</span>
        {simulation.difference > 0 && (
          <span className="inline-flex items-center gap-0.5 font-medium text-green-400">
            <TrendingUp className="w-3 h-3" />
            +R$ {simulation.difference.toFixed(2)} a mais
          </span>
        )}
      </div>
    </div>
  );
}
