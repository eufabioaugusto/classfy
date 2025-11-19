import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Heart, Bookmark, Clock, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useState } from "react";

interface ChatContentCardProps {
  id: string;
  title: string;
  description?: string;
  thumbnail_url?: string;
  content_type: "aula" | "short" | "podcast";
  duration_minutes?: number;
  required_plan?: "free" | "pro" | "premium";
  is_free?: boolean;
  matchScore?: number;
  onPlay?: (contentId: string) => void;
  compact?: boolean;
}

export const ChatContentCard = ({
  id,
  title,
  description,
  thumbnail_url,
  content_type,
  duration_minutes,
  required_plan,
  is_free = true,
  matchScore,
  onPlay,
  compact = false,
}: ChatContentCardProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isSaved, setIsSaved] = useState(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [loading, setLoading] = useState(false);

  const contentTypeLabel = {
    aula: "Aula",
    short: "Short",
    podcast: "Podcast",
  };

  const handleWatch = () => {
    if (onPlay) {
      onPlay(id);
    } else {
      const route = content_type === "podcast" ? `/listen/${id}` : `/watch/${id}`;
      navigate(route);
    }
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast.error("Faça login para salvar conteúdos");
      return;
    }

    setLoading(true);
    try {
      if (isSaved) {
        const { error } = await supabase
          .from("saved_contents")
          .delete()
          .eq("content_id", id)
          .eq("user_id", user.id);

        if (error) throw error;
        setIsSaved(false);
        toast.success("Removido dos salvos");
      } else {
        const { error } = await supabase
          .from("saved_contents")
          .insert({ content_id: id, user_id: user.id });

        if (error) throw error;
        setIsSaved(true);
        toast.success("Salvo com sucesso!");
      }
    } catch (error) {
      console.error("Error saving content:", error);
      toast.error("Erro ao salvar conteúdo");
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) {
      toast.error("Faça login para favoritar conteúdos");
      return;
    }

    setLoading(true);
    try {
      if (isFavorited) {
        const { error } = await supabase
          .from("favorites")
          .delete()
          .eq("content_id", id)
          .eq("user_id", user.id);

        if (error) throw error;
        setIsFavorited(false);
        toast.success("Removido dos favoritos");
      } else {
        const { error } = await supabase
          .from("favorites")
          .insert({ content_id: id, user_id: user.id });

        if (error) throw error;
        setIsFavorited(true);
        toast.success("Favoritado com sucesso!");
      }
    } catch (error) {
      console.error("Error favoriting content:", error);
      toast.error("Erro ao favoritar conteúdo");
    } finally {
      setLoading(false);
    }
  };

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
    <Card className="overflow-hidden bg-card border-border/50 hover:border-primary/30 hover:shadow-lg transition-all duration-300 group">
      {/* Thumbnail */}
      <div className={`relative overflow-hidden bg-muted ${compact ? 'aspect-[16/10]' : 'aspect-video'}`}>
        <img
          src={thumbnail_url || "/placeholder.svg"}
          alt={title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        
        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1.5 flex-wrap">
          <Badge className="bg-primary/90 backdrop-blur-sm text-primary-foreground text-xs shadow-sm">
            {contentTypeLabel[content_type]}
          </Badge>
          {matchScore && matchScore > 0 && (
            <Badge className="bg-cinematic-accent/90 backdrop-blur-sm text-white text-xs shadow-sm">
              {Math.min(100, Math.round((matchScore / 10) * 100))}% match
            </Badge>
          )}
          {required_plan && required_plan !== 'free' && (
            <Badge className={`${getPlanBadgeColor(required_plan)} backdrop-blur-sm text-white text-xs shadow-sm`}>
              {required_plan.toUpperCase()}
            </Badge>
          )}
        </div>

        {/* Duration */}
        {duration_minutes && (
          <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur-sm px-2 py-1 rounded text-xs text-white flex items-center gap-1 shadow-sm">
            <Clock className="w-3 h-3" />
            {duration_minutes}min
          </div>
        )}

        {/* Lock overlay */}
        {!is_free && (
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center">
            <Lock className="w-8 h-8 text-white drop-shadow-lg" />
          </div>
        )}

        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-center justify-center">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
            <div className="bg-primary rounded-full p-3 shadow-xl">
              <Play className="w-6 h-6 text-primary-foreground fill-current" />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className={`${compact ? 'p-3' : 'p-4'} space-y-2`}>
        <div>
          <h3 className={`font-semibold text-foreground line-clamp-2 ${compact ? 'text-sm' : ''}`}>
            {title}
          </h3>
          {description && !compact && (
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
              {description}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleWatch}
            className="flex-1 shadow-sm"
            size={compact ? "sm" : "default"}
          >
            <Play className="w-4 h-4 mr-2" />
            Assistir
          </Button>
          {!compact && (
            <>
              <Button
                onClick={handleSave}
                variant="outline"
                size="sm"
                disabled={loading}
                title={isSaved ? "Remover dos salvos" : "Salvar"}
              >
                <Bookmark className={`w-4 h-4 ${isSaved ? "fill-current" : ""}`} />
              </Button>
              <Button
                onClick={handleFavorite}
                variant="outline"
                size="sm"
                disabled={loading}
                title={isFavorited ? "Remover dos favoritos" : "Favoritar"}
              >
                <Heart className={`w-4 h-4 ${isFavorited ? "fill-current text-red-500" : ""}`} />
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
};
