import { Play, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

interface ContentShareData {
  type: "content_share";
  contentId: string;
  contentTitle: string;
  contentThumbnail?: string;
  contentType?: string;
  creatorName?: string;
  shareUrl: string;
}

interface ContentMessageCardProps {
  data: ContentShareData;
  isOwn: boolean;
}

export const ContentMessageCard = ({ data, isOwn }: ContentMessageCardProps) => {
  return (
    <Link 
      to={`/watch/${data.contentId}`}
      className={`block rounded-xl overflow-hidden border transition-all hover:scale-[1.02] ${
        isOwn 
          ? "bg-primary/90 border-primary-foreground/20" 
          : "bg-background border-border"
      }`}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full min-w-[200px] max-w-[280px]">
        {data.contentThumbnail ? (
          <img 
            src={data.contentThumbnail} 
            alt={data.contentTitle}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className={`w-full h-full flex items-center justify-center ${
            isOwn ? "bg-primary-foreground/10" : "bg-muted"
          }`}>
            <Play className={`h-8 w-8 ${isOwn ? "text-primary-foreground/50" : "text-muted-foreground"}`} />
          </div>
        )}
        
        {/* Play overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
            <Play className="h-6 w-6 text-black fill-black ml-0.5" />
          </div>
        </div>
      </div>

      {/* Content Info */}
      <div className={`p-3 ${isOwn ? "text-primary-foreground" : "text-foreground"}`}>
        <p className="font-medium text-sm line-clamp-2 leading-tight">
          {data.contentTitle}
        </p>
        {data.creatorName && (
          <p className={`text-xs mt-1 ${isOwn ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
            {data.creatorName}
          </p>
        )}
        <div className={`flex items-center gap-1 mt-2 text-xs ${
          isOwn ? "text-primary-foreground/60" : "text-muted-foreground"
        }`}>
          <ExternalLink className="h-3 w-3" />
          <span>Toque para assistir</span>
        </div>
      </div>
    </Link>
  );
};

// Helper function to check if a message is a content share
export const isContentShareMessage = (content: string): ContentShareData | null => {
  try {
    const parsed = JSON.parse(content);
    if (parsed.type === "content_share" && parsed.contentId) {
      return parsed as ContentShareData;
    }
    return null;
  } catch {
    return null;
  }
};
