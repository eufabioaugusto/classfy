import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildCandidate,
  clampLimit,
  dedupeCandidates,
  hasInstructionalEvidence,
  isPublishedWithinWindow,
  normalizeQueries,
  normalizePublishedAt,
  normalizeRecentMonths,
  publishedAfterIso,
  toProspectInsert,
} from "./logic.ts";

const evidence = {
  videoId: "video-1",
  title: "Primeira aula",
  publishedAt: "2026-09-20T12:00:00Z",
  query: "programação curso prático",
};

Deno.test("hard-limits discovery to five candidates", () => {
  assertEquals(clampLimit(99), 5);
  assertEquals(clampLimit(0), 1);
  assertEquals(clampLimit("3"), 3);
});

Deno.test("builds an unresearched, manual-only candidate", () => {
  const candidate = buildCandidate({
    id: "UC-safe",
    snippet: {
      title: "Aulas de Programação",
      description: "Curso de JavaScript",
    },
    statistics: {
      subscriberCount: "12000",
      videoCount: "80",
      viewCount: "900000",
    },
  }, evidence);

  assertEquals(candidate?.ready_for_outreach, false);
  assertEquals(candidate?.researched_at, null);
  assertEquals(candidate?.research_summary, null);
  assertEquals(candidate?.contact_email, null);
  assertEquals(
    candidate?.source_url,
    "https://www.youtube.com/watch?v=video-1",
  );
  assertEquals(candidate?.discovery_published_at, "2026-09-20T12:00:00.000Z");
  assertEquals(candidate?.discovery_query, evidence.query);
});

Deno.test("deduplicates existing and repeated channel ids", () => {
  const base = buildCandidate({
    id: "UC-one",
    snippet: { title: "Canal", description: "aula" },
    statistics: {},
  }, { ...evidence, videoId: "one", title: "Aula" })!;
  const second = { ...base, channel_id: "UC-two", channel_name: "Canal dois" };

  assertEquals(
    dedupeCandidates([base, base, second], ["uc-one"], 5).map((item) =>
      item.channel_id
    ),
    ["UC-two"],
  );
});

Deno.test("normalizes configurable queries and recency without arbitrary values", () => {
  assertEquals(normalizeQueries(["  inglês   para trabalho ", "", "inglês   para trabalho", "finanças aula", "design tutorial", "extra"], ["fallback"]), [
    "inglês para trabalho",
    "finanças aula",
    "design tutorial",
  ]);
  assertEquals(normalizeRecentMonths(6), 6);
  assertEquals(normalizeRecentMonths(3), 3);
  assertEquals(normalizeRecentMonths("24"), 24);
  assertEquals(normalizeRecentMonths("any"), null);
  assertEquals(normalizeRecentMonths(99), 6);
  assertEquals(publishedAfterIso(12, new Date("2026-10-07T00:00:00Z")), "2025-10-07T00:00:00.000Z");
});

Deno.test("does not treat absent or invalid dates as recent", () => {
  const threshold = "2026-04-07T00:00:00.000Z";
  assertEquals(normalizePublishedAt("not-a-date"), null);
  assertEquals(isPublishedWithinWindow(null, threshold), false);
  assertEquals(isPublishedWithinWindow("not-a-date", threshold), false);
  assertEquals(isPublishedWithinWindow("2026-04-06T23:59:59Z", threshold), false);
  assertEquals(isPublishedWithinWindow("2026-04-07T00:00:00Z", threshold), true);
  assertEquals(isPublishedWithinWindow(null, null), true);
});

Deno.test("requires transparent instructional evidence", () => {
  assertEquals(hasInstructionalEvidence("Tutorial passo a passo de Figma"), true);
  assertEquals(hasInstructionalEvidence("Pegadinha engraçada na praia"), false);
  assertEquals(buildCandidate({
    id: "UC-entertainment",
    snippet: { title: "Canal de humor", description: "Vídeos novos toda semana" },
    statistics: {},
  }, { ...evidence, title: "Pegadinha engraçada" }), null);
});

Deno.test("does not persist preview-only discovery metadata", () => {
  const candidate = buildCandidate({
    id: "UC-course",
    snippet: { title: "Professor de matemática", description: "Aulas práticas" },
    statistics: {},
  }, evidence)!;
  const persisted = toProspectInsert(candidate) as Record<string, unknown>;
  assertEquals("discovery_published_at" in persisted, false);
  assertEquals("discovery_query" in persisted, false);
  assertEquals("discovery_reason" in persisted, false);
  assertEquals(persisted.ready_for_outreach, false);
});
