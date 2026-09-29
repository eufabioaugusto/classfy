import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { canReadContent, resolveTutorReferences } from "./classy-context.ts";

Deno.test("acesso à transcrição respeita plano, compra, publicação e propriedade", () => {
  const content = { status: "approved", visibility: "premium", creator_id: "creator" };
  assertEquals(canReadContent(content, "student", "free", false, false), false);
  assertEquals(canReadContent(content, "student", "pro", false, false), false);
  assertEquals(canReadContent(content, "student", "premium", false, false), true);
  assertEquals(canReadContent({ ...content, visibility: "paid" }, "student", "premium", false, false), false);
  assertEquals(canReadContent({ ...content, visibility: "paid" }, "student", "free", false, true), true);
  assertEquals(canReadContent({ ...content, visibility: "free", status: "pending" }, "student", "premium", false, false), false);
  assertEquals(canReadContent({ ...content, status: "pending" }, "creator", "free", false, false), true);
});
function fixtureDb(fixtures: Record<string, unknown>, calls: string[]) {
  return { from(table: string) { calls.push(table); const query = { select: () => query, eq: () => query, in: () => query, maybeSingle: async () => ({ data: fixtures[table] || null }) }; return query; } };
}
Deno.test("não busca transcrição de aula sem permissão", async () => {
  const calls: string[] = [];
  const db = fixtureDb({ contents: { id: "content", title: "Premium", visibility: "premium", status: "approved", creator_id: "other" } }, calls);
  await assertRejects(() => resolveTutorReferences(db, [{ type: "content", id: "content" }], "student", "free"), Error, "REFERENCE_ACCESS_DENIED");
  assertEquals(calls.includes("transcriptions"), false);
});
Deno.test("resolve contexto e transcrição da aula por ID no servidor", async () => {
  const calls: string[] = [];
  const db = fixtureDb({ contents: { id: "content", title: "Aula real", description: "Contexto real", visibility: "free", status: "approved", creator_id: "other", duration_seconds: 60 }, transcriptions: { text: "Uma explicação presente na aula." } }, calls);
  const refs = await resolveTutorReferences(db, [{ type: "content", id: "content" }], "student", "free", 20);
  assertEquals(refs[0].title, "Aula real");
  assertEquals(refs[0].transcriptAvailable, true);
  assertEquals(refs[0].transcript, "Uma explicação presente na aula.");
  assertEquals(refs[0].currentTime, 20);
});
Deno.test("não consulta contexto de estudo de outra pessoa", async () => {
  const calls: string[] = [];
  await assertRejects(() => resolveTutorReferences(fixtureDb({}, calls), [{ type: "study", id: "other-study" }], "student", "free"), Error, "REFERENCE_ACCESS_DENIED");
  assertEquals(calls.includes("study_ai_state"), false);
});
Deno.test("não busca transcrição de curso sem matrícula", async () => {
  const calls: string[] = [];
  const db = fixtureDb({ course_lessons: { id: "lesson", content_id: "linked-video", course: { id: "course", creator_id: "other", visibility: "paid", status: "approved" } } }, calls);
  await assertRejects(() => resolveTutorReferences(db, [{ type: "lesson", id: "lesson" }], "student", "premium"), Error, "REFERENCE_ACCESS_DENIED");
  assertEquals(calls.includes("transcriptions"), false);
});

Deno.test("aula de curso com vídeo próprio usa sua transcrição sem conteúdo avulso", async () => {
  const calls: string[] = [];
  const db = fixtureDb({ course_lessons: { id: "lesson", title: "Vídeo do módulo", content_id: null, duration_seconds: 60, course: { id: "course", creator_id: "other", visibility: "free", status: "approved" } }, lesson_transcriptions: { text: "Conceito explicado no vídeo do módulo." } }, calls);
  const refs = await resolveTutorReferences(db, [{ type: "lesson", id: "lesson" }], "student", "free");
  assertEquals(refs[0].transcriptAvailable, true);
  assertEquals(refs[0].transcript, "Conceito explicado no vídeo do módulo.");
  assertEquals(calls.includes("contents"), false);
});
