export const REWARD_EARNED_EVENT = "classfy:reward-earned";

export interface RewardEarnedDetail {
  eventId?: string;
  actionKey: string;
  userId: string;
  contentId?: string;
  points: number;
  pointType?: "user" | "creator";
}

const recentEventIds = new Set<string>();
const latestByUser = new Map<string, { detail: RewardEarnedDetail; at: number }>();

export function dispatchRewardEarned(detail: RewardEarnedDetail) {
  if (typeof window === "undefined") return;
  if (detail.eventId) {
    if (recentEventIds.has(detail.eventId)) return;
    recentEventIds.add(detail.eventId);
    if (recentEventIds.size > 200) recentEventIds.delete(recentEventIds.values().next().value!);
  }
  if (detail.points > 0) latestByUser.set(detail.userId, { detail, at: Date.now() });
  window.dispatchEvent(new CustomEvent<RewardEarnedDetail>(REWARD_EARNED_EVENT, { detail }));
}

export function subscribeToRewardEarned(listener: (detail: RewardEarnedDetail) => void, replayUserId?: string) {
  if (typeof window === "undefined") return () => undefined;
  let active = true;

  if (replayUserId) {
    const latest = latestByUser.get(replayUserId);
    if (latest && Date.now() - latest.at < 15000) queueMicrotask(() => {
      if (active) listener(latest.detail);
    });
  }

  const handleReward = (event: Event) => {
    listener((event as CustomEvent<RewardEarnedDetail>).detail);
  };

  window.addEventListener(REWARD_EARNED_EVENT, handleReward);
  return () => {
    active = false;
    window.removeEventListener(REWARD_EARNED_EVENT, handleReward);
  };
}
