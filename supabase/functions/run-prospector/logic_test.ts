import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildCandidate, clampLimit, dedupeCandidates } from "./logic.ts";

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
  }, { videoId: "video-1", title: "Primeira aula" });

  assertEquals(candidate?.ready_for_outreach, false);
  assertEquals(candidate?.researched_at, null);
  assertEquals(candidate?.research_summary, null);
  assertEquals(candidate?.contact_email, null);
  assertEquals(
    candidate?.source_url,
    "https://www.youtube.com/watch?v=video-1",
  );
});

Deno.test("deduplicates existing and repeated channel ids", () => {
  const base = buildCandidate({
    id: "UC-one",
    snippet: { title: "Canal", description: "aula" },
    statistics: {},
  }, { videoId: "one", title: "Aula" })!;
  const second = { ...base, channel_id: "UC-two", channel_name: "Canal dois" };

  assertEquals(
    dedupeCandidates([base, base, second], ["uc-one"], 5).map((item) =>
      item.channel_id
    ),
    ["UC-two"],
  );
});
