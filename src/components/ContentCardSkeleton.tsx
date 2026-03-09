import { Skeleton } from "@/components/ui/skeleton";

interface ContentCardSkeletonProps {
  aspectRatio?: "default" | "square" | "vertical";
}

export function ContentCardSkeleton({ aspectRatio = "default" }: ContentCardSkeletonProps) {
  return (
    <div className="flex flex-col">
      {/* Thumbnail skeleton */}
      <Skeleton
        className={`w-full rounded-[12px] ${
          aspectRatio === "square"
            ? "aspect-square"
            : aspectRatio === "vertical"
            ? "aspect-[9/16]"
            : "aspect-[16/9]"
        }`}
      />

      {/* Content Info skeleton */}
      <div className="flex gap-3 pt-3">
        {/* Avatar */}
        <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />

        {/* Text content */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title */}
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          
          {/* Creator name */}
          <Skeleton className="h-3 w-1/2" />
          
          {/* Views */}
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
    </div>
  );
}
