export type ProspectIdentity = {
  channel_id?: string | null;
  channel_url?: string | null;
};

export type ProspectImportRow = ProspectIdentity & {
  channel_name: string;
  source_url: string;
  source_label?: string;
  niche?: string;
  instagram_handle?: string;
  contact_email?: string;
  research_summary?: string;
  fit_reason?: string;
  teaching_topics?: string[];
};

export type ReadyCandidate = {
  source_url?: string | null;
  researched_at?: string | null;
  fit_reason?: string | null;
  qualification_score?: number | null;
  contact_email?: string | null;
  email_subject_draft?: string | null;
  email_body_draft?: string | null;
  instagram_handle?: string | null;
  dm_draft?: string | null;
  do_not_contact?: boolean;
};

export function validateReadyCandidate(value: ReadyCandidate): string[] {
  const missing: string[] = [];
  if (value.do_not_contact) missing.push("Prospect marcado como não contatar");
  if (!value.source_url) missing.push("Fonte");
  if (!value.researched_at) missing.push("Data da pesquisa");
  if (!value.fit_reason) missing.push("Motivo de fit");
  if (value.qualification_score === null || value.qualification_score === undefined) missing.push("Score");
  const hasDraft = Boolean(
    (value.contact_email && value.email_subject_draft && value.email_body_draft)
    || (value.instagram_handle && value.dm_draft),
  );
  if (!hasDraft) missing.push("Rascunho para contato disponível");
  return missing;
}

export function normalizeProfileUrl(value?: string | null): string {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${path}`;
  } catch {
    return value.trim().replace(/\/+$/, "").toLowerCase();
  }
}

export function prospectIdentityKey(value: ProspectIdentity): string {
  const id = value.channel_id?.trim().toLowerCase();
  if (id) return `id:${id}`;
  const url = normalizeProfileUrl(value.channel_url);
  return url ? `url:${url}` : "";
}

export function dedupeImportRows(rows: ProspectImportRow[], existing: ProspectIdentity[]) {
  const known = new Set(existing.map(prospectIdentityKey).filter(Boolean));
  const accepted: ProspectImportRow[] = [];
  const rejected: Array<{ row: ProspectImportRow; reason: string }> = [];
  for (const row of rows) {
    const key = prospectIdentityKey(row);
    if (!key) rejected.push({ row, reason: "Informe channel_id ou channel_url" });
    else if (known.has(key)) rejected.push({ row, reason: "Perfil duplicado" });
    else if (!row.channel_name.trim() || !row.source_url.trim()) rejected.push({ row, reason: "Nome e fonte são obrigatórios" });
    else {
      known.add(key);
      accepted.push(row);
    }
  }
  return { accepted, rejected };
}

export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  // Spreadsheet applications may evaluate these prefixes as formulas.
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseProspectCsv(text: string): ProspectImportRow[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ",") { row.push(cell); cell = ""; }
    else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((values) => {
    const item = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""]));
    return {
      channel_name: item.channel_name,
      channel_id: item.channel_id || null,
      channel_url: item.channel_url || null,
      source_url: item.source_url,
      source_label: item.source_label,
      niche: item.niche,
      instagram_handle: item.instagram_handle?.replace(/^@/, ""),
      contact_email: item.contact_email,
      research_summary: item.research_summary,
      fit_reason: item.fit_reason,
      teaching_topics: item.teaching_topics?.split("|").map((v) => v.trim()).filter(Boolean),
    };
  });
}
