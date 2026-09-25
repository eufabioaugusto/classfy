export const AVATAR_ACTIVITY_EVENT = "classfy:avatar-activity";

export interface AvatarActivityDetail {
  userId: string;
  source: "notification" | "message";
  id: string;
}

const latestByUser = new Map<string, { detail: AvatarActivityDetail; at: number }>();

export function dispatchAvatarActivity(detail: AvatarActivityDetail) {
  if (typeof window === "undefined") return;
  latestByUser.set(detail.userId, { detail, at: Date.now() });
  window.dispatchEvent(new CustomEvent<AvatarActivityDetail>(AVATAR_ACTIVITY_EVENT, { detail }));
}

export function subscribeToAvatarActivity(
  listener: (detail: AvatarActivityDetail) => void,
  replayUserId?: string,
) {
  if (typeof window === "undefined") return () => undefined;
  let active = true;
  if (replayUserId) {
    const latest = latestByUser.get(replayUserId);
    if (latest && Date.now() - latest.at < 15_000) {
      queueMicrotask(() => {
        if (active) listener(latest.detail);
      });
    }
  }
  const handleActivity = (event: Event) => {
    listener((event as CustomEvent<AvatarActivityDetail>).detail);
  };
  window.addEventListener(AVATAR_ACTIVITY_EVENT, handleActivity);
  return () => {
    active = false;
    window.removeEventListener(AVATAR_ACTIVITY_EVENT, handleActivity);
  };
}
