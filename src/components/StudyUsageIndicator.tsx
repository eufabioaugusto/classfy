import { MessageSquare, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
  const isPremium = plan === 'premium';

  // Color thresholds based on percentage of limit
  const isGreen = percent < 60;
  const isYellow = percent >= 60 && percent < 80;
  const isRed = percent >= 80;

  // Don't show for premium users
  if (isPremium) return null;

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-1.5 text-xs px-2 py-1 rounded-full",
        isGreen && "bg-emerald-500/10 text-emerald-600",
        isYellow && "bg-amber-500/10 text-amber-600",
        isRed && "bg-destructive/10 text-destructive"
      )}>
        <MessageSquare className="w-3 h-3" />
        <span>{messageCount}/{maxMessages}</span>
      </div>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs",
      isGreen && "bg-emerald-500/10",
      isYellow && "bg-amber-500/10",
      isRed && "bg-destructive/10"
    )}>
      <MessageSquare className={cn(
        "w-3 h-3",
        isGreen && "text-emerald-600",
        isYellow && "text-amber-600",
        isRed && "text-destructive"
      )} />
      <span className={cn(
        "font-medium tabular-nums",
        isGreen && "text-emerald-600",
        isYellow && "text-amber-600",
        isRed && "text-destructive"
      )}>
        {messageCount}/{maxMessages}
      </span>
      <Progress 
        value={percent} 
        className={cn(
          "h-1 w-12",
          isGreen && "[&>div]:bg-emerald-500",
          isYellow && "[&>div]:bg-amber-500",
          isRed && "[&>div]:bg-destructive"
        )} 
      />
      {isRed && (
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-5 px-1.5 text-[10px] gap-0.5 text-destructive hover:text-destructive"
          onClick={() => navigate('/planos')}
        >
          <Zap className="w-2.5 h-2.5" />
          Upgrade
        </Button>
      )}
    </div>
  );
}
