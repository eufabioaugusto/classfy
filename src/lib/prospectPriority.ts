export type ProspectPriority = "priority" | "attention" | "no_contact";

export type ProspectPriorityInput = {
  contact_email: string | null;
  instagram_handle: string | null;
  email_body_draft: string | null;
  dm_draft: string | null;
  researched_at: string | null;
  research_summary: string | null;
  fit_reason: string | null;
  teaching_topics: string[] | null;
  qualification_notes: string | null;
  ready_for_outreach: boolean;
  do_not_contact: boolean;
};

export type ProspectPriorityAssessment = {
  priority: ProspectPriority;
  label: string;
  reason: string;
  needsReviewEmphasis: boolean;
};

// These markers are not creator-specific. They reflect explicit unresolved evidence
// recorded by the researcher and keep that uncertainty visible in the queue.
const UNRESOLVED_RESEARCH_MARKERS = [
  "a confirmar",
  "precisa ser confirmad",
  "precisam ser confirmad",
  "pendente",
  "não há evidência",
];

const hasUnresolvedResearch = (prospect: ProspectPriorityInput) => {
  const evidence = [
    prospect.research_summary,
    prospect.fit_reason,
    prospect.qualification_notes,
    ...(prospect.teaching_topics || []),
  ].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");

  return UNRESOLVED_RESEARCH_MARKERS.some((signal) => evidence.includes(signal));
};

export function assessProspectPriority(prospect: ProspectPriorityInput): ProspectPriorityAssessment {
  const hasEmail = Boolean(prospect.contact_email?.trim());
  const hasInstagram = Boolean(prospect.instagram_handle?.trim());
  const hasContact = hasEmail || hasInstagram;

  if (!hasContact) {
    return {
      priority: "no_contact",
      label: "Sem contato",
      reason: "Falta um canal de contato verificado.",
      needsReviewEmphasis: false,
    };
  }

  if (prospect.do_not_contact) {
    return {
      priority: "attention",
      label: "Não contatar",
      reason: "Restrição manual ativa; não iniciar abordagem.",
      needsReviewEmphasis: false,
    };
  }

  const hasMatchingDraft = (hasEmail && Boolean(prospect.email_body_draft?.trim()))
    || (hasInstagram && Boolean(prospect.dm_draft?.trim()));
  const hasResearch = Boolean(
    prospect.researched_at
    && prospect.research_summary?.trim()
    && prospect.fit_reason?.trim()
    && prospect.teaching_topics?.length,
  );

  if (hasUnresolvedResearch(prospect)) {
    return {
      priority: "attention",
      label: "Precisa de atenção",
      reason: "A pesquisa registra uma validação pendente antes da revisão.",
      needsReviewEmphasis: false,
    };
  }

  if (!hasResearch) {
    return {
      priority: "attention",
      label: "Precisa de atenção",
      reason: "Completar pesquisa, temas ensinados e motivo de adequação.",
      needsReviewEmphasis: false,
    };
  }

  if (!hasMatchingDraft) {
    return {
      priority: "attention",
      label: "Precisa de atenção",
      reason: "Preparar um rascunho para o canal de contato verificado.",
      needsReviewEmphasis: false,
    };
  }

  return {
    priority: "priority",
    label: prospect.ready_for_outreach ? "Pronto" : "Pronto para revisão",
    reason: prospect.ready_for_outreach
      ? "Pesquisa e rascunho revisados manualmente."
      : "Contato, pesquisa e rascunho disponíveis para revisão.",
    needsReviewEmphasis: !prospect.ready_for_outreach,
  };
}

export const PROSPECT_PRIORITY_ORDER: Record<ProspectPriority, number> = {
  priority: 0,
  attention: 1,
  no_contact: 2,
};

export type ProspectDisplayFilter = "active" | ProspectPriority | "all";

export function matchesProspectDisplay(
  prospect: Pick<ProspectPriorityInput, "do_not_contact">,
  assessment: ProspectPriorityAssessment,
  filter: ProspectDisplayFilter,
) {
  if (filter === "all") return true;
  if (filter === "active") return !prospect.do_not_contact && assessment.priority !== "no_contact";
  return assessment.priority === filter;
}
