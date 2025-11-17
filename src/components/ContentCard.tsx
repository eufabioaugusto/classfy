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
      className="group cursor-pointer overflow-hidden bg-cinematic-dark hover:bg-cinematic-dark/80 transition-all duration-500 border-white/5 hover:border-white/10 rounded-lg"
      onClick={() => navigate(`/player/${id}`)}
    >
      {/* Thumbnail with aspect ratio 16:9 - MasterClass Style */}
      <div className="relative aspect-video overflow-hidden bg-cinematic-black">
        <img
          src={thumbnail}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out"
        />
        
        {/* Cinematic gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-60 group-hover:opacity-80 transition-opacity duration-500" />
        
        {/* Play button overlay - subtle */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-500">
          <div className="bg-white/95 backdrop-blur-sm rounded-full p-5 scale-90 group-hover:scale-100 transition-transform duration-500">
            {isRestricted ? (
              <Lock className="w-7 h-7 text-cinematic-black" />
            ) : (
              <Play className="w-7 h-7 text-cinematic-black" />
            )}
          </div>
        </div>

        {/* Badges - Top Left */}
        <div className="absolute top-4 left-4 flex gap-2">
          {!isFree && price && (
            <Badge className="bg-badge-hot text-white font-semibold text-xs px-3 py-1">
              R$ {price.toFixed(2)}
            </Badge>
          )}
          {requiredPlan && requiredPlan !== "free" && (
            <Badge className={`${getPlanBadgeColor(requiredPlan)} text-white font-semibold uppercase text-xs px-3 py-1`}>
              {requiredPlan}
            </Badge>
          )}
          {isFree && !requiredPlan && (
            <Badge className="bg-badge-free text-white font-semibold text-xs px-3 py-1">
              FREE
            </Badge>
          )}
        </div>

        {/* Duration/Lessons - Bottom Right */}
        <div className="absolute bottom-4 right-4 flex gap-2">
          {duration && (
            <Badge variant="secondary" className="bg-black/80 text-white backdrop-blur-sm border-0 text-xs">
              <Clock className="w-3 h-3 mr-1" />
              {duration}min
            </Badge>
          )}
          {lessonCount && (
            <Badge variant="secondary" className="bg-black/80 text-white backdrop-blur-sm border-0 text-xs">
              <BookOpen className="w-3 h-3 mr-1" />
              {lessonCount} aulas
            </Badge>
          )}
        </div>
      </div>

      {/* Content Info - MasterClass Typography */}
      <div className="p-5 space-y-3 bg-cinematic-dark">
        {/* Creator info - Prominent */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-white/10 overflow-hidden ring-1 ring-white/10">
            {creatorAvatar ? (
              <img src={creatorAvatar} alt={creatorName} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-cinematic-accent text-white font-bold text-lg">
                {creatorName[0]?.toUpperCase()}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white/90 truncate">{creatorName}</p>
            <p className="text-xs text-white/50">Instructor</p>
          </div>
        </div>

        {/* Title - Large and Bold */}
        <h3 className="font-bold text-xl leading-tight line-clamp-2 text-white group-hover:text-cinematic-accent transition-colors duration-300">
          {title}
        </h3>

        {/* Description */}
        {description && (
          <p className="text-sm text-white/60 line-clamp-2 leading-relaxed">
            {description}
          </p>
        )}

        {/* Views & Lock indicator */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <p className="text-xs text-white/50">
            {views.toLocaleString()} views
          </p>
          {isRestricted && (
            <div className="flex items-center gap-1 text-white/50">
              <Lock className="w-3 h-3" />
              <span className="text-xs">Premium</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};