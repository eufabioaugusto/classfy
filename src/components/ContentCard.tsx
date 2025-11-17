import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Play, Clock, BookOpen, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ContentCardProps {
  id: string;
  title: string;
  description?: string;
  thumbnail: string;
  creatorName: string;
  creatorAvatar?: string;
  duration?: number;
  lessonCount?: number;
  isFree: boolean;
  price?: number;
  requiredPlan?: "free" | "pro" | "premium";
  views: number;
  contentType: "video" | "course";
}

export const ContentCard = ({
  id,
  title,
  description,
  thumbnail,
  creatorName,
  creatorAvatar,
  duration,
  lessonCount,
  isFree,
  price,
  requiredPlan,
  views,
  contentType,
}: ContentCardProps) => {
  const navigate = useNavigate();
  const isRestricted = !isFree || requiredPlan;

  const getPlanBadgeColor = (plan?: string) => {
    switch (plan) {
      case "pro":
        return "bg-badge-pro";
      case "premium":
        return "bg-badge-premium";
      default:
        return "bg-badge-free";
    }
  };

  return (
    <Card
      className="group cursor-pointer overflow-hidden bg-card hover:bg-card/80 transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl border-border/50"
      onClick={() => navigate(`/player/${id}`)}
    >
      {/* Thumbnail with aspect ratio 16:9 */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        <img
          src={thumbnail}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        
        {/* Overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        
        {/* Play button overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <div className="bg-primary/90 rounded-full p-4 backdrop-blur-sm">
            {isRestricted ? (
              <Lock className="w-8 h-8 text-primary-foreground" />
            ) : (
              <Play className="w-8 h-8 text-primary-foreground" />
            )}
          </div>
        </div>

        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          {!isFree && price && (
            <Badge className="bg-badge-paid text-white font-semibold">
              R$ {price.toFixed(2)}
            </Badge>
          )}
          {requiredPlan && requiredPlan !== "free" && (
            <Badge className={`${getPlanBadgeColor(requiredPlan)} text-white font-semibold uppercase`}>
              {requiredPlan}
            </Badge>
          )}
          {isFree && !requiredPlan && (
            <Badge className="bg-badge-free text-white font-semibold">
              FREE
            </Badge>
          )}
        </div>

        {/* Duration/Lessons */}
        <div className="absolute bottom-3 right-3 flex gap-2">
          {duration && (
            <Badge variant="secondary" className="bg-black/70 text-white backdrop-blur-sm">
              <Clock className="w-3 h-3 mr-1" />
              {duration}min
            </Badge>
          )}
          {lessonCount && (
            <Badge variant="secondary" className="bg-black/70 text-white backdrop-blur-sm">
              <BookOpen className="w-3 h-3 mr-1" />
              {lessonCount} aulas
            </Badge>
          )}
        </div>
      </div>

      {/* Content Info */}
      <div className="p-5 space-y-3">
        {/* Creator info */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted overflow-hidden">
            {creatorAvatar ? (
              <img src={creatorAvatar} alt={creatorName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-accent text-accent-foreground font-bold">
                {creatorName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-muted-foreground truncate">{creatorName}</p>
          </div>
        </div>

        {/* Title */}
        <h3 className="font-bold text-lg line-clamp-2 group-hover:text-accent transition-colors">
          {title}
        </h3>

        {/* Description */}
        {description && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {description}
          </p>
        )}

        {/* Views & Earnings indicator */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {views.toLocaleString()} visualizações
          </p>
          {isRestricted && (
            <Badge variant="outline" className="text-xs">
              <Lock className="w-3 h-3 mr-1" />
              Premium
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
};