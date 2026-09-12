export const normalizeClassyMessageContent = (content: string) => {
  const value = content.trim();

  if (!value.startsWith("{")) return content;

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed?.answer === "string") return parsed.answer;
  } catch {
    const legacyAnswer = value.match(/^\{\s*"answer"\s*:\s*"([\s\S]*)$/);
    if (legacyAnswer?.[1]) {
      return legacyAnswer[1]
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/"\s*[,}]?\s*$/, "")
        .trim();
    }
  }

  return content;
};
