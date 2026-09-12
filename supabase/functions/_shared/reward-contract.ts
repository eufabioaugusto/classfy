/** Tipos de descoberta que contabilizam engajamento, mas nao participam da economia. */
export function excludesEconomicRewards(
  contentType: string | null | undefined,
) {
  return contentType === "short";
}
