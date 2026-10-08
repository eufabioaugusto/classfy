/** Separates playback position from seconds actually observed during active playback. */
export class PlaybackProgress {
  watched = 0;
  private position: number | null = null;
  private timestamp: number | null = null;
  sample(position: number, playing: boolean, now: number, rate = 1) {
    const delta = this.position === null ? 0 : position - this.position;
    const elapsed = this.timestamp === null ? 0 : (now - this.timestamp) / 1000;
    if (playing && elapsed > 0 && elapsed <= 2 && delta > 0 && delta <= elapsed * rate + 0.4) {
      // Rewards count viewing time, rather than the speed of the playhead.
      this.watched += Math.min(delta, elapsed);
    }
    this.position = playing ? position : null;
    this.timestamp = playing ? now : null;
    return this.watched;
  }
  discontinuity() { this.position = null; this.timestamp = null; }
}
export function createSessionId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : (value & 3) | 8).toString(16);
  });
}
