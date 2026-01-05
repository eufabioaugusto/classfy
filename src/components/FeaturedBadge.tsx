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
    <svg 
      viewBox="0 0 24 24" 
      className={cn(sizeClasses[size], "flex-shrink-0", className)}
      fill="none"
    >
      <circle cx="12" cy="12" r="10" fill="#3b82f6" />
      <path 
        d="M9 12l2 2 4-4" 
        stroke="white" 
        strokeWidth="2.5" 
        strokeLinecap="round" 
        strokeLinejoin="round"
      />
    </svg>
  );
};
