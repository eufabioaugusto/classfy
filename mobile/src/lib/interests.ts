import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const INTERESTS_KEY = 'classfy_interests_v1';
const DIFFICULTIES_KEY = 'classfy_difficulties_v1';

export type InteractionType = 'search' | 'click' | 'like' | 'save' | 'watch_100';

const ACTION_SCORES: Record<InteractionType, number> = {
  search: 2,
  click: 3,
  like: 5,
  save: 5,
  watch_100: 8,
};

/**
 * Tracks user interaction with search, content views, likes, or saves,
 * updating both the local AsyncStorage cache and the Supabase cloud profiles table.
 */
export async function trackUserInteraction(
  userId: string | null | undefined,
  action: InteractionType,
  tags: string[] | string | null | undefined,
  categoryId?: string | null
) {
  try {
    // 1. Parse and extract tags
    let extractedTags: string[] = [];
    if (tags) {
      if (Array.isArray(tags)) {
        extractedTags = tags;
      } else if (typeof tags === 'string') {
        extractedTags = tags.split(',').map((t) => t.trim());
      }
    }

    const itemsToScore: string[] = [...extractedTags];
    if (categoryId) {
      itemsToScore.push(categoryId);
    }

    if (itemsToScore.length === 0) return;

    // 2. Load current interests map
    const localData = await AsyncStorage.getItem(INTERESTS_KEY);
    let interestsMap: Record<string, number> = localData ? JSON.parse(localData) : {};

    const scoreDelta = ACTION_SCORES[action] || 1;

    // 3. Update scores
    itemsToScore.forEach((item) => {
      const cleanItem = item.toLowerCase().trim();
      if (!cleanItem) return;
      interestsMap[cleanItem] = (interestsMap[cleanItem] || 0) + scoreDelta;
    });

    // 4. Save to local storage
    await AsyncStorage.setItem(INTERESTS_KEY, JSON.stringify(interestsMap));

    // 5. Sync to cloud database if user is logged in
    if (userId) {
      const topSortedInterests = Object.entries(interestsMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([term]) => term);

      await supabase
        .from('profiles')
        .update({ interests: topSortedInterests })
        .eq('id', userId);
    }
  } catch (e) {
    console.error('Error tracking user interaction:', e);
  }
}

/**
 * Returns the sorted list of top user interests based on scores.
 */
export async function getTopInterests(userId?: string | null): Promise<string[]> {
  try {
    if (userId) {
      // Fetch from Supabase directly to get cloud synced profile data
      const { data, error } = await supabase
        .from('profiles')
        .select('interests')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data?.interests) {
        return Array.isArray(data.interests) ? data.interests : [];
      }
    }

    // Fallback to local storage
    const localData = await AsyncStorage.getItem(INTERESTS_KEY);
    if (!localData) return [];

    const interestsMap: Record<string, number> = JSON.parse(localData);
    return Object.entries(interestsMap)
      .sort((a, b) => b[1] - a[1])
      .map(([term]) => term);
  } catch (e) {
    console.error('Error loading top interests:', e);
    return [];
  }
}

/**
 * Registers user difficulties (such as failed quizzes or concepts) and syncs it to cloud database.
 */
export async function registerDifficulty(
  userId: string | null | undefined,
  topic: string,
  detail: string
) {
  try {
    const localData = await AsyncStorage.getItem(DIFFICULTIES_KEY);
    let difficulties: string[] = localData ? JSON.parse(localData) : [];

    const cleanTopic = topic.trim();
    if (!cleanTopic) return;

    const diffRecord = `${cleanTopic}: ${detail}`;
    if (!difficulties.includes(diffRecord)) {
      difficulties.unshift(diffRecord); // Add newest to front
    }

    // Keep top 10 difficulties to prevent context overloading
    const truncatedDifficulties = difficulties.slice(0, 10);

    await AsyncStorage.setItem(DIFFICULTIES_KEY, JSON.stringify(truncatedDifficulties));

    if (userId) {
      await supabase
        .from('profiles')
        .update({ difficulties: truncatedDifficulties })
        .eq('id', userId);
    }
  } catch (e) {
    console.error('Error registering difficulty:', e);
  }
}

/**
 * Returns active user difficulties.
 */
export async function getActiveDifficulties(userId?: string | null): Promise<string[]> {
  try {
    if (userId) {
      const { data, error } = await supabase
        .from('profiles')
        .select('difficulties')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data?.difficulties) {
        return Array.isArray(data.difficulties) ? data.difficulties : [];
      }
    }

    const localData = await AsyncStorage.getItem(DIFFICULTIES_KEY);
    return localData ? JSON.parse(localData) : [];
  } catch (e) {
    console.error('Error loading difficulties:', e);
    return [];
  }
}

/**
 * Dynamically sorts a list of contents, boosting items that match the user's top interests to the top.
 */
export function boostContentList(contents: any[], topInterests: string[]): any[] {
  if (!topInterests || topInterests.length === 0 || !contents || contents.length === 0) {
    return contents;
  }

  // Create a copy to avoid mutation side-effects
  return [...contents].sort((a, b) => {
    const aScore = calculateContentScore(a, topInterests);
    const bScore = calculateContentScore(b, topInterests);
    return bScore - aScore; // Highest score goes first
  });
}

function calculateContentScore(content: any, topInterests: string[]): number {
  let score = 0;
  if (!content) return score;

  const title = (content.title || '').toLowerCase();
  const description = (content.description || '').toLowerCase();
  const categoryId = (content.category_id || '').toLowerCase();
  
  let tags: string[] = [];
  if (Array.isArray(content.tags)) {
    tags = content.tags.map((t: string) => t.toLowerCase());
  } else if (typeof content.tags === 'string') {
    tags = content.tags.split(',').map((t: string) => t.toLowerCase().trim());
  }

  topInterests.forEach((interest, index) => {
    const cleanInterest = interest.toLowerCase();
    // Rank boost: earlier interests in list (highest scores) get higher multiplier
    const multiplier = Math.max(1, 5 - index);

    if (title.includes(cleanInterest)) {
      score += 10 * multiplier;
    }
    if (description.includes(cleanInterest)) {
      score += 3 * multiplier;
    }
    if (categoryId === cleanInterest) {
      score += 12 * multiplier;
    }
    if (tags.includes(cleanInterest)) {
      score += 8 * multiplier;
    }
  });

  return score;
}
