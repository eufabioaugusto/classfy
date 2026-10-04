import { describe, expect, it } from "vitest";
import { dedupeImportRows, escapeCsvCell, normalizeProfileUrl, parseProspectCsv, prospectIdentityKey, validateReadyCandidate } from "./prospecting";

describe("prospecting helpers", () => {
  it("normalizes the same profile URL without merging by e-mail", () => {
    expect(normalizeProfileUrl("https://WWW.YouTube.com/@Creator/")).toBe("youtube.com/@creator");
    expect(prospectIdentityKey({ channel_id: null, channel_url: "https://youtube.com/@creator" })).toBe("url:youtube.com/@creator");
  });

  it("deduplicates by channel id or normalized profile, never shared e-mail", () => {
    const base = { source_url: "https://youtube.com/watch?v=evidence", contact_email: "agency@example.com" };
    const result = dedupeImportRows([
      { ...base, channel_name: "A", channel_id: "A-ID", channel_url: null },
      { ...base, channel_name: "B", channel_id: "B-ID", channel_url: null },
      { ...base, channel_name: "A again", channel_id: "a-id", channel_url: null },
    ], []);
    expect(result.accepted.map((r) => r.channel_name)).toEqual(["A", "B"]);
    expect(result.rejected[0].reason).toBe("Perfil duplicado");
  });

  it("neutralizes spreadsheet formulas and quotes CSV values", () => {
    expect(escapeCsvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(escapeCsvCell("normal")).toBe('"normal"');
  });

  it("parses quoted CSV and required provenance columns", () => {
    const rows = parseProspectCsv('channel_name,channel_url,source_url,teaching_topics\n"Canal, A",https://youtube.com/@a,https://youtube.com/watch?v=1,"js | carreira"');
    expect(rows[0].channel_name).toBe("Canal, A");
    expect(rows[0].teaching_topics).toEqual(["js", "carreira"]);
  });

  it("does not allow a do-not-contact or incomplete candidate into the ready queue", () => {
    expect(validateReadyCandidate({ do_not_contact: true })).toContain("Prospect marcado como não contatar");
    expect(validateReadyCandidate({
      source_url: "https://example.com/evidence", researched_at: "2026-10-04T12:00:00Z",
      fit_reason: "Ensina programação", qualification_score: 80,
      contact_email: "creator@example.com", email_subject_draft: "Olá", email_body_draft: "Mensagem",
      do_not_contact: false,
    })).toEqual([]);
  });
});
