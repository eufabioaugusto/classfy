import { ContentCard } from "@/components/ContentCard";
import { Card } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

interface ContentSectionProps {
  title: string;
  icon?: React.ReactNode;
  contents: any[];
  loading?: boolean;
  aspectRatio?: "default" | "square" | "vertical";
  onContentClick: (content: any) => void;
  userPlan?: "free" | "pro" | "premium";
  onUpgradeClick?: (plan: "pro" | "premium", content: any) => void;
  onPurchaseClick?: (content: any) => void;
}

export const ContentSection = ({
  title,
  icon,
  contents,
  loading,
  aspectRatio = "default",
  onContentClick,
  userPlan = "free",
  onUpgradeClick,
  onPurchaseClick,
}: ContentSectionProps) => {
  const isMobile = useIsMobile();

  const getGridCols = () => {
    if (aspectRatio === "vertical") {
      // Shorts: 2 em mobile (4 itens = 2x2), 5 em desktop
      return "grid-cols-2 lg:grid-cols-5";
    }
    if (aspectRatio === "square") {
      // Podcasts: 2 em mobile, 3 em sm, 4 em md, 6 em lg+
      return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";
    }
    // Default: 1 em mobile, 2 em sm, 3 em lg+ (larger cards)
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  };

  const getSkeletonCount = () => {
    if (aspectRatio === "vertical") return isMobile ? 4 : 5;
    if (aspectRatio === "square") return 6;
    return 6; // 2 rows x 3 cols
  };

  const getMaxItems = () => {
    if (aspectRatio === "vertical") return isMobile ? 4 : 5;
    if (aspectRatio === "square") return 6;
    return 6; // 2 rows x 3 cols = 6 items
  };

  const maxItems = getMaxItems();
  const hasMore = contents.length > maxItems;
  const displayContents = showAll ? contents : contents.slice(0, maxItems);

  if (loading) {
    return (
      <section className="space-y-3 sm:space-y-4">
        {title && (
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-lg sm:text-xl font-bold text-foreground">{title}</h3>
          </div>
        )}
        <div className={`grid ${getGridCols()} gap-3 sm:gap-4`}>
          {[...Array(getSkeletonCount())].map((_, i) => (
            <Card
              key={i}
              className="h-48 sm:h-64 animate-pulse bg-muted border-border"
            />
          ))}
        </div>
      </section>
    );
  }

  if (contents.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 sm:space-y-4">
      {title && (
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-lg sm:text-xl font-bold text-foreground">{title}</h3>
        </div>
      )}
      <div className={`grid ${getGridCols()} gap-3 sm:gap-4`}>
        {displayContents.map((content) => (
          <ContentCard
            key={content.id}
            content={content}
            onClick={() => onContentClick(content)}
            aspectRatio={aspectRatio}
            userPlan={userPlan}
            onUpgradeClick={(plan) => onUpgradeClick?.(plan, content)}
            onPurchaseClick={() => onPurchaseClick?.(content)}
          />
        ))}
      </div>
    </section>
  );
};