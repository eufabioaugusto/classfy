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
    const route = content_type === "podcast" ? `/listen/${id}` : `/watch/${id}`;
    navigate(route);
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
    <Card className="overflow-hidden bg-card border-border/50 hover:border-border transition-all duration-300">
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        <img
          src={thumbnail_url || "/placeholder.svg"}
          alt={title}
          className="w-full h-full object-cover"
        />
        
        {/* Badges */}
        <div className="absolute top-3 left-3 flex gap-2">
          <Badge className="bg-primary/90 text-primary-foreground text-xs">
            {contentTypeLabel[content_type]}
          </Badge>
          {matchScore && matchScore > 0 && (
            <Badge className="bg-accent/90 text-accent-foreground text-xs">
              {Math.min(100, Math.round((matchScore / 10) * 100))}% match
            </Badge>
          )}
          {required_plan && (
            <Badge className={`${getPlanBadgeColor(required_plan)} text-white text-xs`}>
              {required_plan.toUpperCase()}
            </Badge>
          )}
        </div>

        {/* Duration */}
        {duration_minutes && (
          <div className="absolute bottom-3 right-3 bg-black/80 px-2 py-1 rounded text-xs text-white flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {duration_minutes}min
          </div>
        )}

        {/* Lock overlay */}
        {!is_free && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Lock className="w-8 h-8 text-white" />
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-foreground line-clamp-2 mb-1">
            {title}
          </h3>
          {description && (
            <p className="text-sm text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleWatch}
            className="flex-1"
            size="sm"
          >
            <Play className="w-4 h-4 mr-2" />
            Assistir
          </Button>
          <Button
            onClick={handleSave}
            variant="outline"
            size="sm"
            disabled={loading}
          >
            <Bookmark className={`w-4 h-4 ${isSaved ? "fill-current" : ""}`} />
          </Button>
          <Button
            onClick={handleFavorite}
            variant="outline"
            size="sm"
            disabled={loading}
          >
            <Heart className={`w-4 h-4 ${isFavorited ? "fill-current text-red-500" : ""}`} />
          </Button>
        </div>
      </div>
    </Card>
  );
};
