import { AppState } from 'react-native';
import { performStudioSelectionFeedbackAsync } from '../../../modules/classfy-studio-media';

const minimumIntervalMs = 70;
let lastFeedbackAt: number | undefined;

// The gesture owns snap deduplication. This shared budget also coalesces snaps
// from separate axes or controls without delaying their visual feedback.
export function performStudioSnapFeedback(): void {
  if (AppState.currentState !== 'active') return;
  const now = globalThis.performance?.now?.() ?? Date.now();
  if (lastFeedbackAt !== undefined && now - lastFeedbackAt < minimumIntervalMs) return;
  lastFeedbackAt = now;
  try {
    // Optional in an older development binary; feedback never blocks a gesture
    // or turns an unavailable haptic into an editing error.
    void performStudioSelectionFeedbackAsync().catch(() => {});
  } catch {
    // Protect the interaction even if the native bridge throws synchronously.
  }
}
