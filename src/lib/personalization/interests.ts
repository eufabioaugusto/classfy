import { supabase } from "@/integrations/supabase/client";

export type InterestInteractionType = "search" | "click" | "like" | "save" | "favorite" | "watch_50" | "watch_100";

const ACTION_SCORES: Record<InterestInteractionType, number> = {
  search: 2,
  click: 3,
  like: 5,
  save: 5,
  favorite: 6,
  watch_50: 5,
  watch_100: 8,
};

const normalizeInterest = (value: string) => value.toLowerCase().trim();

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

export async function getTopInterests(userId?: string | null): Promise<string[]> {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("interests")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error loading top interests:", error);
    return [];
  }

  return toStringArray(data?.interests);
}

export async function getActiveDifficulties(userId?: string | null): Promise<string[]> {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("difficulties")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error loading active difficulties:", error);
    return [];
  }

  return toStringArray(data?.difficulties);
}

export async function trackUserInteraction(input: {
  userId?: string | null;
  action: InterestInteractionType;
  tags?: string[] | string | null;
  categoryId?: string | null;
  title?: string | null;
}) {
  const { userId, action, tags, categoryId, title } = input;
  if (!userId) return;

  const items = extractInterestTerms({ tags, categoryId, title });
  if (items.length === 0) return;

  try {
    const currentInterests = await getTopInterests(userId);
    const scoreDelta = ACTION_SCORES[action] || 1;
    const scores = new Map<string, number>();

    currentInterests.forEach((interest, index) => {
      scores.set(normalizeInterest(interest), Math.max(1, currentInterests.length - index));
    });

    items.forEach((item) => {
      const normalized = normalizeInterest(item);
      if (!normalized) return;
      scores.set(normalized, (scores.get(normalized) || 0) + scoreDelta);
    });

    const topSortedInterests = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([term]) => term);

    await supabase
      .from("profiles")
      .update({ interests: topSortedInterests })
      .eq("id", userId);
  } catch (error) {
    console.error("Error tracking user interaction:", error);
  }
}

export async function registerDifficulty(input: {
  userId?: string | null;
  topic?: string | null;
  detail?: string | null;
}) {
  const { userId, topic, detail } = input;
  if (!userId) return;

  const cleanTopic = topic?.trim();
  if (!cleanTopic) return;

  const record = detail?.trim() ? `${cleanTopic}: ${detail.trim()}` : cleanTopic;

  try {
    const currentDifficulties = await getActiveDifficulties(userId);
    const nextDifficulties = [record, ...currentDifficulties.filter((item) => item !== record)].slice(0, 10);

    await supabase
      .from("profiles")
      .update({ difficulties: nextDifficulties })
      .eq("id", userId);
  } catch (error) {
    console.error("Error registering difficulty:", error);
  }
}

export function boostContentList<T extends Record<string, any>>(contents: T[], topInterests: string[]): T[] {
  if (!topInterests?.length || !contents?.length) return contents;

  return [...contents].sort((a, b) => calculateContentScore(b, topInterests) - calculateContentScore(a, topInterests));
}

function extractInterestTerms(input: {
  tags?: string[] | string | null;
  categoryId?: string | null;
  title?: string | null;
}) {
  const terms: string[] = [];
  const { tags, categoryId, title } = input;

  if (Array.isArray(tags)) {
    terms.push(...tags);
  } else if (typeof tags === "string") {
    terms.push(...tags.split(","));
  }

  if (categoryId) terms.push(categoryId);
  if (title) terms.push(...title.split(/\s+/).filter((term) => term.length >= 4).slice(0, 4));

  return Array.from(new Set(terms.map(normalizeInterest).filter(Boolean)));
}

function calculateContentScore(content: Record<string, any>, topInterests: string[]): number {
  let score = 0;
  const title = String(content.title || "").toLowerCase();
  const description = String(content.description || "").toLowerCase();
  const categoryId = String(content.category_id || "").toLowerCase();
  const tags = Array.isArray(content.tags)
    ? content.tags.map((tag: string) => tag.toLowerCase())
    : typeof content.tags === "string"
      ? content.tags.split(",").map((tag: string) => tag.toLowerCase().trim())
      : [];

  topInterests.forEach((interest, index) => {
    const cleanInterest = normalizeInterest(interest);
    const multiplier = Math.max(1, 5 - index);

    if (title.includes(cleanInterest)) score += 10 * multiplier;
    if (description.includes(cleanInterest)) score += 3 * multiplier;
    if (categoryId === cleanInterest) score += 12 * multiplier;
    if (tags.includes(cleanInterest)) score += 8 * multiplier;
  });

  return score;
}
