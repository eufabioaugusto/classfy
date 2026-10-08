export type ConfirmedReward = { id: string; user_id: string; points: number; action_key: string; content_id?: string | null; created_at?: string };
/** Short lived receipts bridge login rewards emitted before the app UI mounts. */
export class ReceiptQueue {
  private pending = new Map<string, { reward: ConfirmedReward; receivedAt: number }>();
  add(reward: ConfirmedReward, now = Date.now()) {
    if (!reward.id) return;
    this.pending.set(reward.id, { reward, receivedAt: now });
    if (this.pending.size > 50) this.pending.delete(this.pending.keys().next().value!);
  }
  delivered(id: string) { this.pending.delete(id); }
  take(userId: string, now = Date.now()) {
    const rewards: ConfirmedReward[] = [];
    for (const [id, item] of this.pending) {
      if (now - item.receivedAt > 60000) { this.pending.delete(id); continue; }
      if (item.reward.user_id === userId) { rewards.push(item.reward); this.pending.delete(id); }
    }
    return rewards;
  }
}
