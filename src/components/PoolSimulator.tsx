import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Calculator, ArrowUp, Zap } from "lucide-react";

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
    if (activityIncrease[0] >= 10) items.push("Assista mais conteúdos até o final (+PP por WATCH_100)");
    if (activityIncrease[0] >= 25) items.push("Comente e curta conteúdos diariamente");
    if (activityIncrease[0] >= 50) items.push("Complete seu perfil e mantenha streak de login");
    if (activityIncrease[0] >= 75) items.push("Publique conteúdos originais (PP de creator)");
    return items;
  }, [activityIncrease]);

  return (
    <Card className="bg-gradient-to-br from-primary/5 to-accent/5 border-primary/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Calculator className="w-6 h-6 text-primary" />
          <CardTitle>Simulador de Ganhos</CardTitle>
        </div>
        <CardDescription>
          Veja quanto ganharia se aumentasse sua atividade na plataforma
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Slider */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Aumento de atividade</span>
            <Badge variant="secondary" className="text-lg px-3 py-1 font-bold">
              +{activityIncrease[0]}%
            </Badge>
          </div>
          <Slider
            value={activityIncrease}
            onValueChange={setActivityIncrease}
            min={0}
            max={200}
            step={5}
            className="py-2"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Atual</span>
            <span>+50%</span>
            <span>+100%</span>
            <span>+200%</span>
          </div>
        </div>

        {/* Results */}
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 rounded-lg bg-background border border-border space-y-1">
            <p className="text-xs text-muted-foreground">Estimativa Atual</p>
            <p className="text-xl font-bold">R$ {currentEstimate.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{currentPP.toFixed(0)} PP</p>
          </div>
          <div className="p-4 rounded-lg bg-primary/10 border border-primary/20 space-y-1">
            <p className="text-xs text-muted-foreground">Com +{activityIncrease[0]}%</p>
            <p className="text-xl font-bold text-primary">R$ {simulation.newShare.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">{simulation.newPP.toFixed(0)} PP</p>
          </div>
        </div>

        {/* Difference */}
        {simulation.difference > 0 && (
          <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center gap-3">
            <ArrowUp className="w-5 h-5 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                +R$ {simulation.difference.toFixed(2)}/mês ({simulation.percentGain.toFixed(0)}% a mais)
              </p>
              <p className="text-xs text-muted-foreground">
                Ganho adicional estimado com mais atividade
              </p>
            </div>
          </div>
        )}

        {/* Tips */}
        {tips.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-accent" />
              Como aumentar sua atividade:
            </p>
            <ul className="space-y-1">
              {tips.map((tip, i) => (
                <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                  <TrendingUp className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          * Simulação baseada no pool atual. Valores reais dependem da atividade de todos os usuários e da receita mensal.
        </p>
      </CardContent>
    </Card>
  );
}
