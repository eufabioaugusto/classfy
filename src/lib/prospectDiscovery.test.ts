import { describe, expect, it } from "vitest";
import { buildDiscoveryCommitBody, buildDiscoveryPreviewBody } from "./prospectDiscovery";

describe("discovery modal request contract", () => {
  it("blocks empty terms instead of silently using defaults", () => {
    expect(buildDiscoveryPreviewBody("  \n ", "6")).toBeNull();
  });

  it("preserves the selected window and only the first three non-empty terms", () => {
    expect(buildDiscoveryPreviewBody("matemática aula\n\ninglês trabalho\ndesign tutorial\nextra", "3")).toEqual({
      limit: 5,
      queries: ["matemática aula", "inglês trabalho", "design tutorial"],
      recent_months: 3,
    });
    expect(buildDiscoveryPreviewBody("finanças aula", "any")?.recent_months).toBe("any");
  });

  it("is stable across cancel and retry because building a request does not mutate the draft", () => {
    const draft = { queryText: "programação prática\nidiomas aula", recentMonths: "6" };
    const firstAttempt = buildDiscoveryPreviewBody(draft.queryText, draft.recentMonths);
    const retryAfterCancel = buildDiscoveryPreviewBody(draft.queryText, draft.recentMonths);
    expect(retryAfterCancel).toEqual(firstAttempt);
  });

  it("confirmation carries the exact preview configuration", () => {
    const candidates = [{ channel_id: "UC-one" }];
    expect(buildDiscoveryCommitBody(candidates, {
      queries: ["matemática aula", "design tutorial"],
      recent_months: 6,
      published_after: "2026-04-07T00:00:00.000Z",
    })).toEqual({
      limit: 5,
      commit: true,
      candidates,
      queries: ["matemática aula", "design tutorial"],
      recent_months: 6,
    });
  });
});
