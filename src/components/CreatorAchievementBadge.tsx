import { cn } from '@/lib/utils';
import * as LucideIcons from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { MilestoneWithProgress } from '@/hooks/useCreatorMilestones';

interface CreatorAchievementBadgeProps {
  milestone: MilestoneWithProgress;
  size?: 'sm' | 'md' | 'lg';
}

export function CreatorAchievementBadge({ milestone, size = 'md' }: CreatorAchievementBadgeProps) {
  const IconComponent = (LucideIcons as any)[
    milestone.icon.split('-').map((word: string, i: number) => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join('')
  ] || LucideIcons.Trophy;

  const isUnlocked = milestone.isClaimed;
  
  const sizeClasses = {
    sm: 'w-16 h-18',
    md: 'w-24 h-28',
    lg: 'w-32 h-36'
  };

  const hexagonSize = {
    sm: 'w-14 h-16',
    md: 'w-20 h-24',
    lg: 'w-28 h-32'
  };

  const iconSize = {
    sm: 'w-6 h-6',
    md: 'w-10 h-10',
    lg: 'w-14 h-14'
  };

  const valueSize = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl'
  };

  const formatMilestoneValue = (value: number, type: string) => {
    if (type === 'earnings') {
      if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
      return value;
    }
    if (type === 'engagement') return `${value}%`;
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
    return value;
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'contents': return LucideIcons.Video;
      case 'followers': return LucideIcons.Users;
      case 'earnings': return LucideIcons.Wallet;
      case 'views': return LucideIcons.Eye;
      case 'engagement': return LucideIcons.Heart;
      default: return LucideIcons.Trophy;
    }
  };

  const TypeIcon = getTypeIcon(milestone.milestone_type);

  return (
    <div className={cn("flex flex-col items-center gap-2", sizeClasses[size])}>
      {/* Hexagon Badge */}
      <div className="relative">
        {/* Hexagon shape with gradient */}
        <div 
          className={cn(
            "relative flex items-center justify-center transition-all duration-300",
            hexagonSize[size],
            isUnlocked 
              ? "drop-shadow-lg" 
              : "grayscale opacity-70"
          )}
          style={{
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)'
          }}
        >
          {/* Background gradient */}
          <div 
            className={cn(
              "absolute inset-0",
              isUnlocked 
                ? "bg-gradient-to-b from-orange-400 via-pink-500 to-purple-600"
                : "bg-gradient-to-b from-gray-300 via-gray-400 to-gray-500"
            )}
          />
          
          {/* Inner hexagon (slightly smaller for border effect) */}
          <div 
            className="absolute inset-[3px] flex flex-col items-center justify-center"
            style={{
              clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
              background: isUnlocked 
                ? 'linear-gradient(135deg, rgba(251,146,60,0.9), rgba(236,72,153,0.9), rgba(147,51,234,0.9))'
                : 'linear-gradient(135deg, rgba(200,200,200,0.9), rgba(150,150,150,0.9))'
            }}
          >
            {/* Value display */}
            <span className={cn(
              "font-black leading-none",
              valueSize[size],
              isUnlocked ? "text-white drop-shadow-md" : "text-gray-600"
            )}
            style={{
              textShadow: isUnlocked 
                ? '2px 2px 0 rgba(0,0,0,0.3), -1px -1px 0 rgba(255,255,255,0.2)'
                : '1px 1px 0 rgba(255,255,255,0.5)'
            }}>
              {formatMilestoneValue(milestone.milestone_value, milestone.milestone_type)}
            </span>
            
            {/* Type icon */}
            <TypeIcon className={cn(
              size === 'sm' ? 'w-3 h-3 mt-0.5' : size === 'md' ? 'w-4 h-4 mt-1' : 'w-5 h-5 mt-1.5',
              isUnlocked ? "text-white/90" : "text-gray-500"
            )} />
          </div>
        </div>

        {/* Progress bar below hexagon (only for locked badges) */}
        {!isUnlocked && milestone.percentComplete > 0 && (
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3/4">
            <div className="h-1 bg-gray-300 rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${milestone.percentComplete}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Label */}
      <div className="text-center">
        <p className={cn(
          "font-medium leading-tight",
          size === 'sm' ? 'text-[10px]' : size === 'md' ? 'text-xs' : 'text-sm',
          isUnlocked ? "text-foreground" : "text-muted-foreground"
        )}>
          {milestone.title.split(' ').slice(0, 2).join(' ')}
        </p>
        {isUnlocked && milestone.progress?.claimed_at && (
          <p className={cn(
            "text-muted-foreground",
            size === 'sm' ? 'text-[8px]' : 'text-[10px]'
          )}>
            {format(new Date(milestone.progress.claimed_at), "d 'de' MMM", { locale: ptBR })}
          </p>
        )}
      </div>
    </div>
  );
}
