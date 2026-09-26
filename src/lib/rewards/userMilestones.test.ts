import { describe, expect, it } from "vitest";
import { buildUserMilestones } from "./userMilestones";

describe("marcos de estudo do usuário", () => {
  it("reconhece um conteúdo concluído sem liberar marcos futuros", () => {
    const milestones = buildUserMilestones({ totalPoints: 57, completedContents: 1, longestStreak: 2 });
    expect(milestones.find((item) => item.id === "first-content")?.unlocked).toBe(true);
    expect(milestones.filter((item) => item.unlocked)).toHaveLength(1);
    expect(milestones.find((item) => item.id === "level-two")?.current).toBe(57);
  });

  it("mantém a conquista de sequência com o recorde após a sequência atual cair", () => {
    const milestones = buildUserMilestones({ totalPoints: 500, completedContents: 5, longestStreak: 7 });
    expect(milestones.find((item) => item.id === "seven-days")?.unlocked).toBe(true);
    expect(milestones.find((item) => item.id === "level-two")?.unlocked).toBe(true);
    expect(milestones.find((item) => item.id === "thirty-days")?.unlocked).toBe(false);
  });
});
