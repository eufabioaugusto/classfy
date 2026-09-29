export function normalizeDictation(text: string | null | undefined) {
  const value = (text || "").trim();
  return /^\[SEM_FALA\]$/i.test(value) ? "" : value;
}
