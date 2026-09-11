import { ArrowRight, Clock, Play, Sparkles } from "lucide-react";

type CreatorProfile = {
  display_name?: string | null;
  creator_channel_name?: string | null;
};

export type HomeHeroContent = {
  id: string;
  title: string;
  description?: string | null;
  thumbnail_url?: string | null;
  content_type?: string | null;
  visibility?: "free" | "pro" | "premium" | "paid" | null;
  duration_minutes?: number | null;
  duration_seconds?: number | null;
  profiles?: CreatorProfile | CreatorProfile[] | null;
  identity_image_url?: string | null;
  context_label?: string | null;
};

interface HomeHeroProps {
  content: HomeHeroContent | null;
  onPlay: () => void;
  onOpenFocus: () => void;
  primaryLabel?: string;
}

const visibilityLabel: Record<string, string> = {
  free: "Acesso Free",
  pro: "Seleção PRO",
  premium: "Seleção Premium",
  paid: "Conteúdo exclusivo",
};

function getCreatorName(content: HomeHeroContent) {
  const profile = Array.isArray(content.profiles) ? content.profiles[0] : content.profiles;
  return profile?.creator_channel_name || profile?.display_name || "Creator Classfy";
}

function getDuration(content: HomeHeroContent) {
  const minutes = content.duration_minutes || Math.round((content.duration_seconds || 0) / 60);
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
}

export function HomeHero({ content, onPlay, onOpenFocus, primaryLabel = "Assistir agora" }: HomeHeroProps) {
  if (!content) return null;

  const duration = getDuration(content);
  const plan = content.visibility || "free";
  const PrimaryIcon = content.identity_image_url ? ArrowRight : Play;

  return (
    <section className="cf2-home-hero" aria-labelledby="home-hero-title">
      <div className="cf2-home-hero__media" aria-hidden="true">
        {content.thumbnail_url && (
          <img src={content.thumbnail_url} alt="" loading="eager" />
        )}
      </div>
      <div className="cf2-home-hero__shade" aria-hidden="true" />

      <div className="cf2-home-hero__content">
        <div className="cf2-home-hero__eyebrow">
          <span>Em destaque</span>
          <span className={`cf2-home-hero__plan cf2-home-hero__plan--${plan}`}>
            {content.context_label || visibilityLabel[plan] || "Seleção Classfy"}
          </span>
        </div>

        {content.identity_image_url && (
          <img
            src={content.identity_image_url}
            alt={getCreatorName(content)}
            className="cf2-home-hero__identity"
          />
        )}
        <h1 id="home-hero-title">{content.title}</h1>
        {content.description && <p>{content.description}</p>}

        {!content.identity_image_url && (
          <div className="cf2-home-hero__meta">
            <strong>{getCreatorName(content)}</strong>
            {duration && (
              <span>
                <Clock aria-hidden="true" /> {duration}
              </span>
            )}
            {content.content_type && <span>{content.content_type}</span>}
          </div>
        )}

        <div className="cf2-home-hero__actions">
          <button type="button" className="cf2-home-hero__primary" onClick={onPlay}>
            <PrimaryIcon aria-hidden="true" />
            {primaryLabel}
          </button>
          <button type="button" className="cf2-home-hero__secondary" onClick={onOpenFocus}>
            <Sparkles aria-hidden="true" />
            Estudar com a Classy
            <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
