import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Calculator, ArrowUp } from "lucide-react";

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
    const percentGain = currentEstimate > 0 ? (difference / currentEstimate) * 100 : 0;

    return { newPP, newShare, difference, percentGain };
  }, [activityIncrease, currentPP, totalPP, prm, currentEstimate]);

  return (
    <div className="rounded-lg bg-foreground px-4 py-2.5 flex items-center gap-3 flex-wrap sm:flex-nowrap">
      <div className="flex items-center gap-1.5 shrink-0">
        <Calculator className="w-3.5 h-3.5 text-accent" />
        <span className="text-xs font-medium text-background whitespace-nowrap">Simulador</span>
      </div>

      <div className="flex-1 min-w-[120px] max-w-[200px]">
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

      <div className="h-3 w-px bg-background/20 shrink-0" />

      <div className="flex items-center gap-3 text-xs shrink-0">
        <span className="text-background/60">Atual: <span className="text-background font-semibold">R$ {currentEstimate.toFixed(2)}</span></span>
        <span className="text-background/60">Projeção: <span className="text-accent font-semibold">R$ {simulation.newShare.toFixed(2)}</span></span>
        {simulation.difference > 0 && (
          <span className="inline-flex items-center gap-0.5 font-medium text-green-400">
            <ArrowUp className="w-3 h-3" />+R$ {simulation.difference.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}
