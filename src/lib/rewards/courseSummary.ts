export const LESSON_ACTIONS = ["VIEW_15S", "WATCH_50", "WATCH_100"];
export const COURSE_ACTIONS = ["LIKE", "SAVE", "FAVORITE", "SHARE", "COMPLETE_COURSE"];
interface Event { action_key: string; points: number; metadata: unknown }
interface Input {
  events: Event[];
  progress: { lesson_id: string; completed: boolean; progress_percent: number; watched_seconds: number }[];
  configs: { action_key: string; points_user: number }[];
  lessonId: string;
  lessonIds: string[];
  multiplier: number;
  hasAccess: boolean;
  isOwnCourse: boolean;
}
const metadata = (event: Event): Record<string, unknown> => event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata) ? event.metadata as Record<string, unknown> : {};
const round = (points: number) => Math.round(points * 100) / 100;
export function buildCourseRewardSummary(input: Input) {
  const { events, configs, lessonId, lessonIds, hasAccess, isOwnCourse } = input;
  const multiplier = Number.isFinite(input.multiplier) && input.multiplier > 0 ? input.multiplier : 1;
  const pointsFor = (key: string) => isOwnCourse ? 0 : round(Number(configs.find((c) => c.action_key === key)?.points_user || 0) * multiplier);
  const lessonEvents = events.filter((e) => lessonIds.includes(String(metadata(e).lesson_id)) && LESSON_ACTIONS.includes(e.action_key));
  const courseEvents = events.filter((e) => !metadata(e).lesson_id && (COURSE_ACTIONS.includes(e.action_key) || COURSE_ACTIONS.some((k) => e.action_key === `${k}_REVERSED`)));
  const sum = (rows: Event[]) => round(rows.reduce((total, row) => total + Number(row.points || 0), 0));
  const awarded = (rows: Event[], key: string) => sum(rows.filter((e) => e.action_key === key || e.action_key === `${key}_REVERSED`)) > 0;
  const currentEvents = lessonEvents.filter((e) => metadata(e).lesson_id === lessonId);
  const milestones = LESSON_ACTIONS.map((key, index) => ({ key, label: ["Assistiu 15 segundos", "50% concluído", "Aula concluída"][index], points: pointsFor(key), awarded: awarded(currentEvents, key) }));
  const lessonAvailable = round(milestones.filter((m) => !m.awarded).reduce((n, m) => n + m.points, 0));
  const completedLessons = input.progress.filter((p) => p.completed && lessonIds.includes(p.lesson_id)).length;
  const totalAvailable = isOwnCourse || !hasAccess ? 0 : round(
    lessonIds.reduce((total, id) => total + LESSON_ACTIONS.reduce((n, key) => n + (awarded(lessonEvents.filter((e) => metadata(e).lesson_id === id), key) ? 0 : pointsFor(key)), 0), 0) +
    COURSE_ACTIONS.reduce((n, key) => n + (awarded(courseEvents, key) ? 0 : pointsFor(key)), 0));
  return { milestones, lessonPoints: sum(currentEvents), lessonAvailable,
    allLessonPoints: sum(lessonEvents), coursePoints: sum(courseEvents), totalPoints: sum([...lessonEvents, ...courseEvents]),
    completedLessons, coursePercent: lessonIds.length ? Math.floor(completedLessons * 100 / lessonIds.length) : 0,
    courseBonusAwarded: awarded(courseEvents, "COMPLETE_COURSE"), courseBonusPoints: pointsFor("COMPLETE_COURSE"), totalAvailable };
}
