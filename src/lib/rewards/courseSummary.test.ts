import { describe, it, expect } from "vitest";
import { buildCourseRewardSummary } from "./courseSummary";
const input = {
  lessonId: "a", lessonIds: ["a", "b"], multiplier: 1, hasAccess: true, isOwnCourse: false,
  configs: [{action_key:"VIEW_15S",points_user:2},{action_key:"WATCH_50",points_user:6},{action_key:"WATCH_100",points_user:10},{action_key:"COMPLETE_COURSE",points_user:20},{action_key:"LIKE",points_user:3}],
  progress: [{lesson_id:"a",completed:true,progress_percent:100,watched_seconds:60}],
  events: [{action_key:"WATCH_100",points:10,metadata:{lesson_id:"a"}},{action_key:"VIEW_15S",points:2,metadata:{lesson_id:"b"}},{action_key:"LIKE",points:3,metadata:{}},{action_key:"LIKE_REVERSED",points:-3,metadata:{}}],
};
describe("Points por aula e por curso", () => {
  it("separa o ganho da aula atual do acumulado e do bônus, sem duplicar totais", () => {
    const result = buildCourseRewardSummary(input);
    expect(result.lessonPoints).toBe(10);
    expect(result.totalPoints).toBe(12);
    expect(result.coursePoints).toBe(0);
    expect(result.lessonAvailable).toBe(8);
    expect(result.totalAvailable).toBe(47);
    expect(result.coursePercent).toBe(50);
    expect(result.courseBonusAwarded).toBe(false);
  });
  it("trocar de aula não transporta os Points da anterior", () => {
    expect(buildCourseRewardSummary({...input, lessonId:"b"}).lessonPoints).toBe(2);
  });
  it("bônus final é distinto dos marcos de aula e respeita o multiplicador do plano", () => {
    const result = buildCourseRewardSummary({...input,multiplier:2,events:[...input.events,{action_key:"COMPLETE_COURSE",points:40,metadata:{}}]});
    expect(result.courseBonusAwarded).toBe(true);
    expect(result.totalPoints).toBe(52);
    expect(result.courseBonusPoints).toBe(40);
  });
  it("preview não promete recompensas do curso bloqueado; autor não ganha no próprio curso", () => {
    expect(buildCourseRewardSummary({...input,hasAccess:false}).totalAvailable).toBe(0);
    const own = buildCourseRewardSummary({...input,isOwnCourse:true});
    expect(own.lessonAvailable).toBe(0);
    expect(own.courseBonusPoints).toBe(0);
  });
});
