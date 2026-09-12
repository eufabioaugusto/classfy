export const REWARD_EARNED_EVENT = "classfy:reward-earned";

export interface RewardEarnedDetail {
  actionKey: string;
  userId: string;
  contentId?: string;
  points: number;
}

export function dispatchRewardEarned(detail: RewardEarnedDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<RewardEarnedDetail>(REWARD_EARNED_EVENT, { detail }));
}

export function subscribeToRewardEarned(listener: (detail: RewardEarnedDetail) => void) {
  if (typeof window === "undefined") return () => undefined;

  const handleReward = (event: Event) => {
    listener((event as CustomEvent<RewardEarnedDetail>).detail);
  };

  window.addEventListener(REWARD_EARNED_EVENT, handleReward);
  return () => window.removeEventListener(REWARD_EARNED_EVENT, handleReward);
}
