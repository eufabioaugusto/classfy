import { Progress } from "@/components/ui/progress";
import { MessageSquare, AlertTriangle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

interface StudyUsageIndicatorProps {
  messageCount: number;
  maxMessages: number;
  plan: 'free' | 'pro' | 'premium';
  compact?: boolean;
}

export function StudyUsageIndicator({ 
  messageCount, 
  maxMessages, 
  plan,
  compact = false
}: StudyUsageIndicatorProps) {
  const navigate = useNavigate();
  const percent = Math.min(100, Math.round((messageCount / maxMessages) * 100));
  const isNearLimit = percent >= 80;
  const isAtLimit = percent >= 100;
  const isPremium = plan === 'premium';

  // Don't show for premium users
  if (isPremium) return null;

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full",
        isAtLimit && "bg-destructive/10 text-destructive",
        isNearLimit && !isAtLimit && "bg-amber-500/10 text-amber-600",
        !isNearLimit && "bg-muted text-muted-foreground"
      )}>
        <MessageSquare className="w-3 h-3" />
        <span>{messageCount}/{maxMessages}</span>
        {isNearLimit && <AlertTriangle className="w-3 h-3" />}
      </div>
    );
  }

  return (
    <div className={cn(
      "rounded-lg p-3 space-y-2 border",
      isAtLimit && "bg-destructive/5 border-destructive/30",
      isNearLimit && !isAtLimit && "bg-amber-500/5 border-amber-500/30",
      !isNearLimit && "bg-muted/30 border-border"
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className={cn(
            "w-4 h-4",
            isAtLimit && "text-destructive",
            isNearLimit && !isAtLimit && "text-amber-600",
            !isNearLimit && "text-muted-foreground"
          )} />
          <span className="text-sm font-medium">
            {messageCount} de {maxMessages} mensagens
          </span>
        </div>
        {isNearLimit && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="h-7 text-xs gap-1"
            onClick={() => navigate('/planos')}
          >
            <Zap className="w-3 h-3" />
            Upgrade
          </Button>
        )}
      </div>
      
      <Progress 
        value={percent} 
        className={cn(
          "h-1.5",
          isAtLimit && "[&>div]:bg-destructive",
          isNearLimit && !isAtLimit && "[&>div]:bg-amber-500",
        )} 
      />
      
      {isAtLimit && (
        <p className="text-xs text-destructive">
          Você atingiu o limite de mensagens. Arquive este estudo e crie um novo, ou faça upgrade.
        </p>
      )}
      {isNearLimit && !isAtLimit && (
        <p className="text-xs text-amber-600">
          Você está chegando ao limite de mensagens neste estudo.
        </p>
      )}
    </div>
  );
}
