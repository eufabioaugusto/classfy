/** Tipos de descoberta que contabilizam engajamento, mas nao participam da economia. */
export function excludesEconomicRewards(
  contentType: string | null | undefined,
) {
  return contentType === "short";
}

export function meetsLessonRewardThreshold(actionKey: string, progress: {
  watched_seconds?: number;
  progress_percent?: number;
  completed?: boolean;
} | null | undefined) {
  if (!progress) return false;
  if (actionKey === "VIEW_15S") return Number(progress.watched_seconds || 0) >= 15;
  if (actionKey === "WATCH_50") return Number(progress.progress_percent || 0) >= 50;
  if (actionKey === "WATCH_100") return progress.completed === true && Number(progress.progress_percent || 0) >= 100;
  return false;
}
