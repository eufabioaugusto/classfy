import type { MediaUploadState } from "./publication";

export type BackgroundUploadState = Extract<
  MediaUploadState,
  "preparing" | "uploading" | "processing" | "ready" | "failed"
>;

export interface BackgroundUploadTask {
  id: string;
  draftId: string | null;
  mediaAssetId: string | null;
  title: string;
  state: BackgroundUploadState;
  progress: number;
  updatedAt: number;
}

const tasks = new Map<string, BackgroundUploadTask>();
const listeners = new Set<() => void>();
let snapshot: BackgroundUploadTask[] = [];

const publish = () => {
  snapshot = Array.from(tasks.values());
  listeners.forEach((listener) => listener());
};

export function beginBackgroundUpload({
  draftId,
  title,
}: {
  draftId?: string | null;
  title: string;
}) {
  if (draftId) {
    for (const [taskId, task] of tasks) {
      if (task.draftId === draftId) tasks.delete(taskId);
    }
  }
  const id = crypto.randomUUID();
  tasks.set(id, {
    id,
    draftId: draftId ?? null,
    mediaAssetId: null,
    title,
    state: "preparing",
    progress: 0,
    updatedAt: Date.now(),
  });
  publish();
  return id;
}

export function updateBackgroundUpload(
  id: string,
  update: Partial<
    Pick<
      BackgroundUploadTask,
      "draftId" | "mediaAssetId" | "title" | "state" | "progress"
    >
  >,
) {
  const current = tasks.get(id);
  if (!current) return;
  tasks.set(id, {
    ...current,
    ...update,
    progress: Math.max(0, Math.min(update.progress ?? current.progress, 100)),
    updatedAt: Date.now(),
  });
  publish();
}

export function updateBackgroundUploadByMediaAsset(
  mediaAssetId: string,
  update: Partial<Pick<BackgroundUploadTask, "state" | "progress">>,
) {
  const task = Array.from(tasks.values()).find(
    (item) => item.mediaAssetId === mediaAssetId,
  );
  if (task) updateBackgroundUpload(task.id, update);
}

export function subscribeBackgroundUploads(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBackgroundUploadsSnapshot() {
  return snapshot;
}
