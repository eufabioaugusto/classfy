/**
 * Curadoria editorial da Home V2.
 *
 * O ID e a referencia mais segura e pode ser definido no ambiente de deploy.
 * O titulo existe apenas como fallback controlado enquanto o seletor editorial
 * ainda nao faz parte do Admin.
 */
export const HOME_EDITORIAL = {
  heroContentId: import.meta.env.VITE_HOME_HERO_CONTENT_ID?.trim() || null,
  heroFallbackTitle: "AULA MUX 1",
  heroPreviewSeconds: 20,
} as const;

export function isConfiguredHomeHero(content: { id?: string | null; title?: string | null }) {
  if (HOME_EDITORIAL.heroContentId) {
    return content.id === HOME_EDITORIAL.heroContentId;
  }

  return content.title?.trim().toLocaleLowerCase("pt-BR") ===
    HOME_EDITORIAL.heroFallbackTitle.toLocaleLowerCase("pt-BR");
}
