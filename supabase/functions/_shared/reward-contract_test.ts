import { assertEquals } from "jsr:@std/assert@1";
import { excludesEconomicRewards } from "./reward-contract.ts";

Deno.test("Shorts ficam fora de todas as recompensas economicas", () => {
  assertEquals(excludesEconomicRewards("short"), true);
});

Deno.test("midias educacionais permanecem elegiveis ao motor", () => {
  assertEquals(excludesEconomicRewards("aula"), false);
  assertEquals(excludesEconomicRewards("podcast"), false);
  assertEquals(excludesEconomicRewards("curso"), false);
});

Deno.test("marcos de aula exigem progresso aceito pelo servidor", async () => {
  const { meetsLessonRewardThreshold: meets } = await import("./reward-contract.ts");
  assertEquals(meets("VIEW_15S", null), false);
  assertEquals(meets("VIEW_15S", { watched_seconds: 14 }), false);
  assertEquals(meets("VIEW_15S", { watched_seconds: 15 }), true);
  assertEquals(meets("WATCH_50", { progress_percent: 49 }), false);
  assertEquals(meets("WATCH_50", { progress_percent: 50 }), true);
  assertEquals(meets("WATCH_100", { progress_percent: 100, completed: false }), false);
  assertEquals(meets("WATCH_100", { progress_percent: 100, completed: true }), true);
  assertEquals(meets("COMPLETE_COURSE", { progress_percent: 100, completed: true }), false);
});
