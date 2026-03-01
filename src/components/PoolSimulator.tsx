import { useState, useMemo } from "react";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Calculator, ArrowUp, Zap } from "lucide-react";

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

  const tips = useMemo(() => {
    const items: string[] = [];
    if (activityIncrease[0] >= 10) items.push("Assista mais conteúdos até o final");
    if (activityIncrease[0] >= 25) items.push("Comente e curta conteúdos diariamente");
    if (activityIncrease[0] >= 50) items.push("Complete seu perfil e mantenha streak de login");
    if (activityIncrease[0] >= 75) items.push("Publique conteúdos originais");
    return items;
  }, [activityIncrease]);

  return (
    <div className="relative rounded-xl border border-accent/20 bg-gradient-to-r from-accent/5 via-transparent to-accent/5 p-[1px]">
      <div className="rounded-[11px] bg-card p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Calculator className="w-3.5 h-3.5 text-accent" />
            </div>
            <span className="text-sm font-semibold">Simulador de Ganhos</span>
          </div>
          <Badge variant="outline" className="text-xs border-accent/30 text-accent font-medium">
            +{activityIncrease[0]}%
          </Badge>
        </div>

        {/* Slider */}
        <div className="space-y-1.5">
          <Slider
            value={activityIncrease}
            onValueChange={setActivityIncrease}
            min={0}
            max={200}
            step={5}
            className="py-1"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Atual</span>
            <span>+100%</span>
            <span>+200%</span>
          </div>
        </div>

        {/* Compact results */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2.5 rounded-lg bg-muted/50 space-y-0.5">
            <p className="text-[10px] text-muted-foreground">Atual</p>
            <p className="text-sm font-bold">R$ {currentEstimate.toFixed(2)}</p>
          </div>
          <div className="p-2.5 rounded-lg bg-accent/10 border border-accent/15 space-y-0.5">
            <p className="text-[10px] text-muted-foreground">Projeção</p>
            <p className="text-sm font-bold text-accent">R$ {simulation.newShare.toFixed(2)}</p>
          </div>
        </div>

        {/* Difference inline */}
        {simulation.difference > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <ArrowUp className="w-3 h-3 text-green-500" />
            <span className="font-medium text-green-600 dark:text-green-400">
              +R$ {simulation.difference.toFixed(2)}/mês
            </span>
            <span className="text-muted-foreground">
              ({simulation.percentGain.toFixed(0)}% a mais)
            </span>
          </div>
        )}

        {/* Tips collapsed */}
        {tips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tips.map((tip, i) => (
              <span key={i} className="text-[10px] text-muted-foreground bg-muted/50 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-accent" />
                {tip}
              </span>
            ))}
          </div>
        )}

        <p className="text-[9px] text-muted-foreground/60">
          * Estimativa baseada no pool atual
        </p>
      </div>
    </div>
  );
}
