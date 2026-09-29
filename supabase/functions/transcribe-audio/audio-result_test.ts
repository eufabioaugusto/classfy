import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { normalizeDictation } from "./audio-result.ts";
Deno.test("ditado silencioso ou vazio retorna ausência de fala", () => {
  for (const text of [null, undefined, "", "  ", " [SEM_FALA] "]) assertEquals(normalizeDictation(text), "");
  assertEquals(normalizeDictation(" Quero revisar esta aula. "), "Quero revisar esta aula.");
});
