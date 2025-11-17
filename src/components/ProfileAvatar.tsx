import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";

interface ProfileAvatarProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const ProfileAvatar = ({ size = "md", className = "" }: ProfileAvatarProps) => {
  const { profile } = useAuth();

  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-20 w-20"
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <Avatar className={`${sizeClasses[size]} ${className}`}>
      {profile?.avatar_url && (
        <AvatarImage 
          src={`${profile.avatar_url}?t=${Date.now()}`} 
          alt={profile.display_name}
          key={profile.avatar_url}
        />
      )}
      <AvatarFallback className="bg-primary text-primary-foreground">
        {profile?.display_name ? getInitials(profile.display_name) : "U"}
      </AvatarFallback>
    </Avatar>
  );
};
