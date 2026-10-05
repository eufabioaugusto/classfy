import { describe, expect, it } from "vitest";
import { assessProspectPriority, matchesProspectDisplay } from "./prospectPriority";

const base = {
  contact_email: null,
  instagram_handle: null,
  email_body_draft: null,
  dm_draft: null,
  researched_at: "2026-10-05T00:00:00.000Z",
  research_summary: "Oferta de ensino online confirmada em página pública.",
  fit_reason: "Validar interesse como creator pioneiro.",
  teaching_topics: ["inglês"],
  qualification_notes: null,
  ready_for_outreach: false,
  do_not_contact: false,
};

describe("assessProspectPriority", () => {
  it("coloca contato, pesquisa e rascunho no topo para revisão", () => {
    expect(assessProspectPriority({
      ...base,
      instagram_handle: "carinafragozo",
      dm_draft: "Oi, Carina!",
    })).toMatchObject({ priority: "priority", label: "Pronto para revisão", needsReviewEmphasis: true });
  });

  it("mantém validação de ensino em atenção mesmo com contato e rascunho", () => {
    expect(assessProspectPriority({
      ...base,
      instagram_handle: "bremadinho",
      dm_draft: "Você oferece aulas online?",
      qualification_notes: "Categoria docente e oferta online ainda precisam ser confirmadas.",
    })).toMatchObject({ priority: "attention", reason: expect.stringContaining("pendente") });
  });

  it("coloca registros sem canal verificado de escanteio sem apagar", () => {
    expect(assessProspectPriority(base)).toMatchObject({ priority: "no_contact", label: "Sem contato" });
  });

  it("mantém contato pesquisado em atenção quando falta rascunho", () => {
    expect(assessProspectPriority({ ...base, instagram_handle: "creator" }))
      .toMatchObject({ priority: "attention", reason: expect.stringContaining("rascunho") });
  });

  it("remove o destaque somente após a ação explícita Marcar como pronto", () => {
    expect(assessProspectPriority({
      ...base,
      contact_email: "contato@example.com",
      email_body_draft: "Convite",
      ready_for_outreach: true,
    })).toMatchObject({ priority: "priority", label: "Pronto", needsReviewEmphasis: false });
  });

  it("preserva Não contatar como restrição, sem tratá-lo como arquivo", () => {
    const prospect = {
      ...base,
      contact_email: "contato@example.com",
      email_body_draft: "Convite",
      do_not_contact: true,
    };
    const assessment = assessProspectPriority(prospect);
    expect(assessment).toMatchObject({ priority: "attention", label: "Não contatar" });
    expect(matchesProspectDisplay(prospect, assessment, "active")).toBe(false);
    expect(matchesProspectDisplay(prospect, assessment, "all")).toBe(true);
    expect(prospect.do_not_contact).toBe(true);
  });

  it("mostra 3 de 5 na visão padrão e mantém 2 sem contato recuperáveis", () => {
    const synthetic = [
      { ...base, contact_email: "pedro@example.com", email_body_draft: "Convite" },
      { ...base, instagram_handle: "carina", dm_draft: "Convite" },
      { ...base, instagram_handle: "bremado", dm_draft: "Validação", qualification_notes: "Oferta online a confirmar." },
      { ...base },
      { ...base },
    ];
    const assessed = synthetic.map((prospect) => ({ prospect, assessment: assessProspectPriority(prospect) }));
    expect(assessed.filter(({ prospect, assessment }) => matchesProspectDisplay(prospect, assessment, "active"))).toHaveLength(3);
    expect(assessed.filter(({ assessment }) => assessment.priority === "no_contact")).toHaveLength(2);
  });
});
