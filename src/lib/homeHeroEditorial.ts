import type { HomeHeroContent } from "@/components/home/HomeHero";
import type { Database } from "@/integrations/supabase/types";

export type HomeHeroSettings = Database["public"]["Tables"]["home_hero_settings"]["Row"];
export type HeroAlignment = "left" | "center" | "right";

export function isHeroAlignment(value: string): value is HeroAlignment {
  return value === "left" || value === "center" || value === "right";
}

export function normalizeHeroHref(value: string | null | undefined, fallback: string): string {
  const href = value?.trim();
  return href && /^\/(?!\/)[^\\\r\n]*$/.test(href) ? href : fallback;
}

export function buildEditorialHero(content: HomeHeroContent, settings: HomeHeroSettings): HomeHeroContent {
  return {
    ...content,
    title: settings.title?.trim() || content.title,
    description: settings.description?.trim() || content.description,
    thumbnail_url: settings.thumbnail_url || content.thumbnail_url,
    eyebrow_label: settings.eyebrow_label.trim() || "Em destaque",
    context_label: settings.chip_label?.trim() || null,
    show_chip: settings.show_chip,
    alignment: isHeroAlignment(settings.alignment) ? settings.alignment : "left",
    image_position: isHeroAlignment(settings.image_position) ? settings.image_position : "center",
    primary_label: settings.primary_label.trim() || "Assistir agora",
    show_secondary: settings.show_secondary,
    secondary_label: settings.secondary_label.trim() || "Estudar com a Classy",
  };
}
