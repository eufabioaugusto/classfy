import { Link } from "react-router-dom";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface CreatorLinkProps {
  creatorId: string;
  creatorName: string;
  creatorAvatar?: string | null;
  channelName?: string | null;
  className?: string;
  showName?: boolean;
  avatarSize?: "sm" | "md" | "lg";
}

export const CreatorLink = ({
  creatorId,
  creatorName,
  creatorAvatar,
  channelName,
  className = "",
  showName = true,
  avatarSize = "sm",
}: CreatorLinkProps) => {
  const sizeClasses = {
    sm: "w-7 h-7",
    md: "w-10 h-10",
    lg: "w-16 h-16",
  };

  const textSizeClasses = {
    sm: "text-[11px]",
    md: "text-sm",
    lg: "text-base",
  };

  // If no channel name, return non-clickable version
  if (!channelName) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Avatar className={`${sizeClasses[avatarSize]} ring-1 ring-border/50 flex-shrink-0`}>
          {creatorAvatar && <AvatarImage src={creatorAvatar} alt={creatorName} />}
          <AvatarFallback className="bg-primary text-primary-foreground text-xs">
            {creatorName[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        {showName && (
          <p className={`${textSizeClasses[avatarSize]} font-medium text-foreground truncate`}>
            {creatorName}
          </p>
        )}
      </div>
    );
  }

  // Return clickable version with link to profile
  return (
    <Link
      to={`/@${channelName}`}
      className={`flex items-center gap-2 hover:opacity-80 transition-opacity ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <Avatar className={`${sizeClasses[avatarSize]} ring-1 ring-border/50 flex-shrink-0`}>
        {creatorAvatar && <AvatarImage src={creatorAvatar} alt={creatorName} />}
        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
          {creatorName[0]?.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      {showName && (
        <p className={`${textSizeClasses[avatarSize]} font-medium text-foreground truncate hover:text-primary transition-colors`}>
          {creatorName}
        </p>
      )}
    </Link>
  );
};
