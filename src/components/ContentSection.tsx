import { ContentCard } from "@/components/ContentCard";
import { Card } from "@/components/ui/card";

interface ContentSectionProps {
  title: string;
  icon?: React.ReactNode;
  contents: any[];
  loading?: boolean;
  horizontal?: boolean;
  aspectRatio?: "default" | "square" | "vertical";
  onContentClick: (content: any) => void;
}

export const ContentSection = ({
  title,
  icon,
  contents,
  loading,
  horizontal,
  aspectRatio = "default",
  onContentClick,
}: ContentSectionProps) => {
  if (loading) {
    return (
      <section className="space-y-6">
        {title && (
          <div className="flex items-center gap-3">
            {icon}
            <h3 className="text-3xl md:text-4xl font-bold text-white">{title}</h3>
          </div>
        )}
        <div className={horizontal ? "flex gap-6 overflow-x-auto pb-4" : "grid grid-cols-3 gap-4"}>
          {[...Array(horizontal ? 6 : 3)].map((_, i) => (
            <Card
              key={i}
              className={`${horizontal ? "min-w-[300px]" : ""} h-96 animate-pulse bg-white/5 border-white/10`}
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
    <section className="space-y-6">
      {title && (
        <div className="flex items-center gap-3">
          {icon}
          <h3 className="text-3xl md:text-4xl font-bold text-white">{title}</h3>
        </div>
      )}
      <div className={horizontal ? "flex gap-6 overflow-x-auto pb-4 scrollbar-hide" : "grid grid-cols-3 gap-4"}>
        {contents.map((content) => (
          <div
            key={content.id}
            className={horizontal ? (
              aspectRatio === "vertical" ? "min-w-[240px] flex-shrink-0" :
              aspectRatio === "square" ? "min-w-[280px] flex-shrink-0" :
              "min-w-[320px] flex-shrink-0"
            ) : ""}
          >
            <ContentCard
              content={content}
              onClick={() => onContentClick(content)}
              aspectRatio={aspectRatio}
            />
          </div>
        ))}
      </div>
    </section>
  );
};