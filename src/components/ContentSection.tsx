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
    if (aspectRatio === "vertical") return "grid-cols-6"; // Shorts - 6 por linha
    if (aspectRatio === "square") return "grid-cols-6"; // Podcasts - 6 por linha
    return "grid-cols-4"; // Default - 4 por linha
  };

  if (loading) {
    return (
      <section className="space-y-4">
        {title && (
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-xl font-bold text-foreground">{title}</h3>
          </div>
        )}
        <div className={`grid ${getGridCols()} gap-4`}>
          {[...Array(aspectRatio === "vertical" || aspectRatio === "square" ? 6 : 4)].map((_, i) => (
            <Card
              key={i}
              className="h-64 animate-pulse bg-muted border-border"
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
    <section className="space-y-4">
      {title && (
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-xl font-bold text-foreground">{title}</h3>
        </div>
      )}
      <div className={`grid ${getGridCols()} gap-4`}>
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