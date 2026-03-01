import { Check, Gift, Lock } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { MilestoneWithProgress } from '@/hooks/useCreatorMilestones';

interface CreatorMilestoneItemProps {
  milestone: MilestoneWithProgress;
  onClaim: (milestoneId: string) => void;
  claiming?: boolean;
  compact?: boolean;
}

export function CreatorMilestoneItem({ 
  milestone, 
  onClaim, 
  claiming,
  compact = false 
}: CreatorMilestoneItemProps) {
  const IconComponent = (LucideIcons as any)[
    milestone.icon.split('-').map((word, i) => 
      i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word.charAt(0).toUpperCase() + word.slice(1)
    ).join('')
  ] || LucideIcons.Trophy;

  const formatValue = (value: number, type: string) => {
    if (type === 'earnings') {
      return `R$ ${value.toLocaleString('pt-BR')}`;
    }
    if (type === 'engagement') {
      return `${value}%`;
    }
    return value.toLocaleString('pt-BR');
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'contents': return 'Conteúdos';
      case 'followers': return 'Seguidores';
      case 'earnings': return 'Ganhos';
      case 'views': return 'Visualizações';
      case 'engagement': return 'Engajamento';
      default: return type;
    }
  };

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-3 p-3 rounded-lg border transition-colors",
        milestone.isClaimed 
          ? "bg-muted/50 border-muted" 
          : milestone.isCompleted 
            ? "bg-primary/5 border-primary/30" 
            : "bg-card border-border hover:border-primary/30"
      )}>
        <div className={cn(
          "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
          milestone.isClaimed 
            ? "bg-muted text-muted-foreground" 
            : milestone.isCompleted 
              ? "bg-primary text-primary-foreground" 
              : "bg-muted text-muted-foreground"
        )}>
          {milestone.isClaimed ? (
            <Check className="w-5 h-5" />
          ) : (
            <IconComponent className="w-5 h-5" />
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <p className={cn(
            "font-medium text-sm truncate",
            milestone.isClaimed && "text-muted-foreground"
          )}>
            {milestone.title}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <Progress value={milestone.percentComplete} className="h-1.5 flex-1" />
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {formatValue(milestone.currentValue, milestone.milestone_type)} / {formatValue(milestone.milestone_value, milestone.milestone_type)}
            </span>
          </div>
        </div>

        {milestone.isCompleted && !milestone.isClaimed && (
          <Button 
            size="sm" 
            onClick={() => onClaim(milestone.id)}
            disabled={claiming}
            className="shrink-0"
          >
            <Gift className="w-4 h-4 mr-1" />
            Resgatar
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn(
      "p-4 rounded-xl border transition-all",
      milestone.isClaimed 
        ? "bg-muted/30 border-muted" 
        : milestone.isCompleted 
          ? "bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30 shadow-sm" 
          : "bg-card border-border hover:border-primary/20 hover:shadow-sm"
    )}>
      <div className="flex items-start gap-4">
        <div className={cn(
          "w-14 h-14 rounded-xl flex items-center justify-center shrink-0 transition-all",
          milestone.isClaimed 
            ? "bg-muted text-muted-foreground" 
            : milestone.isCompleted 
              ? "bg-primary text-primary-foreground shadow-lg" 
              : "bg-muted/50 text-muted-foreground"
        )}>
          {milestone.isClaimed ? (
            <Check className="w-7 h-7" />
          ) : milestone.isCompleted ? (
            <Gift className="w-7 h-7" />
          ) : (
            <IconComponent className="w-7 h-7" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className={cn(
                "font-semibold",
                milestone.isClaimed && "text-muted-foreground"
              )}>
                {milestone.title}
              </h4>
              <p className="text-sm text-muted-foreground mt-0.5">
                {milestone.description}
              </p>
            </div>
            
            <div className="text-right shrink-0">
              <span className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                milestone.isClaimed 
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/10 text-primary"
              )}>
                {getTypeLabel(milestone.milestone_type)}
              </span>
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-muted-foreground">
                Progresso: {formatValue(milestone.currentValue, milestone.milestone_type)} / {formatValue(milestone.milestone_value, milestone.milestone_type)}
              </span>
              <span className={cn(
                "font-medium",
                milestone.percentComplete >= 100 ? "text-primary" : "text-foreground"
              )}>
                {milestone.percentComplete}%
              </span>
            </div>
            <Progress value={milestone.percentComplete} className="h-2" />
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">XP:</span>
                <span className="font-semibold text-primary">+{milestone.points_reward}</span>
              </div>
               <div className="flex items-center gap-1.5 text-sm">
                <span className="text-muted-foreground">Pontos:</span>
                <span className="font-semibold text-accent">+{milestone.points_reward}</span>
              </div>
            </div>

            {milestone.isClaimed ? (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Check className="w-4 h-4" />
                Resgatado
              </span>
            ) : milestone.isCompleted ? (
              <Button 
                onClick={() => onClaim(milestone.id)}
                disabled={claiming}
                className="gap-2"
              >
                <Gift className="w-4 h-4" />
                Resgatar Recompensa
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Lock className="w-4 h-4" />
                Bloqueado
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
