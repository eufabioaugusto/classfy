import { DeviceEventEmitter } from 'react-native';
import { ReceiptQueue, type ConfirmedReward } from './receiptQueue';
export type { ConfirmedReward } from './receiptQueue';
export const REWARD_CONFIRMED = 'classfy:reward-confirmed';
export const REWARDS_CHANGED = 'classfy:rewards-changed';
const pending = new ReceiptQueue();
export function notifyConfirmedRewards(rewards: ConfirmedReward[]) {
  for (const reward of rewards) {
    if (!reward.id) continue;
    pending.add(reward);
    DeviceEventEmitter.emit(REWARD_CONFIRMED, reward);
  }
}
export function subscribeConfirmedRewards(userId: string, listener: (reward: ConfirmedReward) => void) {
  const subscription = DeviceEventEmitter.addListener(REWARD_CONFIRMED, (reward: ConfirmedReward) => {
    if (reward.user_id !== userId) return;
    pending.delivered(reward.id);
    listener(reward);
  });
  pending.take(userId).forEach(listener);
  return subscription;
}
