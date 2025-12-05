import { ContentCard } from "@/components/ContentCard";
import { Card } from "@/components/ui/card";

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
  const getGridCols = () => {
    if (aspectRatio === "vertical") {
      // Shorts: 2 em mobile, 3 em sm, 4 em md, 6 em lg+
      return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";
    }
    if (aspectRatio === "square") {
      // Podcasts: 2 em mobile, 3 em sm, 4 em md, 6 em lg+
      return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6";
    }
    // Default: 1 em mobile, 2 em sm, 3 em md, 4 em lg+
    return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4";
  };

  const getSkeletonCount = () => {
    if (aspectRatio === "vertical" || aspectRatio === "square") return 6;
    return 4;
  };

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
        {contents.map((content) => (
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