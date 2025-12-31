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
      "flex items-center gap-2 px-2.5 py-1 rounded-full text-xs",
      isAtLimit && "bg-destructive/10 text-destructive",
      isNearLimit && !isAtLimit && "bg-amber-500/10 text-amber-600",
      !isNearLimit && "bg-muted/50 text-muted-foreground"
    )}>
      <MessageSquare className="w-3 h-3" />
      <span className="font-medium tabular-nums">
        {messageCount}/{maxMessages}
      </span>
      {isNearLimit && !isAtLimit && (
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-5 px-1.5 text-[10px] gap-0.5 text-amber-600 hover:text-amber-700"
          onClick={() => navigate('/planos')}
        >
          <Zap className="w-2.5 h-2.5" />
          Upgrade
        </Button>
      )}
      {isAtLimit && <AlertTriangle className="w-3 h-3" />}
    </div>
  );
}
