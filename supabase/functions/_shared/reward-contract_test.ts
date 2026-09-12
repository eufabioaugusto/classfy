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
