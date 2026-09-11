import { ContentCard } from "@/components/ContentCard";

interface PremiumCollectionProps {
  contents: any[];
  userPlan: "free" | "pro" | "premium";
  onContentClick: (content: any) => void;
  onUpgradeClick: (plan: "pro" | "premium", content: any) => void;
  onPurchaseClick: (content: any) => void;
}

export function PremiumCollection({
  contents,
  userPlan,
  onContentClick,
  onUpgradeClick,
  onPurchaseClick,
}: PremiumCollectionProps) {
  if (contents.length === 0) return null;

  return (
    <section className="cf2-home-premium" aria-labelledby="home-premium-title">
      <div className="cf2-home-premium__intro">
        <span>Classfy Premium</span>
        <h2 id="home-premium-title">Conhecimento para ir além do óbvio.</h2>
        <p>Uma seleção com mais profundidade, creators e experiências exclusivas.</p>
      </div>

      <div className="cf2-home-premium__grid">
        {contents.map((content) => (
          <ContentCard
            key={content.id}
            content={content}
            onClick={() => onContentClick(content)}
            userPlan={userPlan}
            onUpgradeClick={(plan) => onUpgradeClick(plan, content)}
            onPurchaseClick={() => onPurchaseClick(content)}
            visualVariant="v2"
          />
        ))}
      </div>
    </section>
  );
}
