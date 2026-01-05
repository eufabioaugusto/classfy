import { BadgeCheck } from "lucide-react";
import { useIsCreatorFeatured } from "@/hooks/useFeaturedCreators";
import { cn } from "@/lib/utils";

interface FeaturedBadgeProps {
  creatorId: string | undefined;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

export const FeaturedBadge = ({ creatorId, size = "sm", className }: FeaturedBadgeProps) => {
  const isFeatured = useIsCreatorFeatured(creatorId);

  if (!isFeatured) return null;

  const sizeClasses = {
    xs: "w-3 h-3",
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <BadgeCheck 
      className={cn(sizeClasses[size], "text-blue-500 flex-shrink-0", className)} 
    />
  );
};
