export const MAX_DISCOVERY_CANDIDATES = 5;

export type DiscoveryCandidate = {
  channel_id: string;
  channel_name: string;
  channel_url: string;
  subscriber_count: number;
  video_count: number;
  view_count: number;
  niche: string;
  size_tier: string;
  status: "pending";
  outreach_channel: null;
  contact_email: null;
  instagram_handle: null;
  source_url: string;
  source_label: string;
  researched_at: null;
  research_summary: null;
  fit_reason: null;
  teaching_topics: string[];
  qualification_score: null;
  qualification_notes: null;
  ready_for_outreach: false;
  do_not_contact: false;
};

export function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MAX_DISCOVERY_CANDIDATES;
  return Math.max(1, Math.min(MAX_DISCOVERY_CANDIDATES, Math.trunc(parsed)));
}

export function normalizeChannelId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function sizeTier(subscribers: number): string {
  if (subscribers < 1_000) return "micro";
  if (subscribers < 5_000) return "pequeno";
  if (subscribers < 20_000) return "medio";
  if (subscribers < 100_000) return "grande";
  return "bigplayer";
}

export function detectNiche(text: string): string {
  const normalized = text.toLowerCase();
  const niches = [
    ["tech", [
      "programação",
      "software",
      "tecnologia",
      "python",
      "javascript",
      "data science",
    ]],
    ["idiomas", [
      "inglês",
      "espanhol",
      "francês",
      "idioma",
      "language",
      "português",
    ]],
    ["financas", [
      "finanças",
      "investimento",
      "dinheiro",
      "renda",
      "bolsa",
      "tesouro",
    ]],
    ["marketing", [
      "marketing",
      "vendas",
      "tráfego",
      "copywriting",
      "social media",
    ]],
    ["fitness", ["fitness", "academia", "musculação", "treino", "nutrição"]],
    ["design", ["design", "figma", "canva", "photoshop", "ux"]],
    ["educacao", [
      "educação",
      "curso",
      "aula",
      "ensino",
      "professor",
      "concurso",
    ]],
  ] as const;
  return niches.find(([, words]) =>
    words.some((word) => normalized.includes(word))
  )?.[0] ?? "geral";
}

export function buildCandidate(
  channel: Record<string, any>,
  evidence: { videoId: string; title: string },
): DiscoveryCandidate | null {
  const channelId = typeof channel?.id === "string" ? channel.id.trim() : "";
  const title = typeof channel?.snippet?.title === "string"
    ? channel.snippet.title.trim()
    : "";
  if (!channelId || !title || !evidence.videoId) return null;

  const subscribers =
    Number.parseInt(channel.statistics?.subscriberCount ?? "0", 10) || 0;
  const videos = Number.parseInt(channel.statistics?.videoCount ?? "0", 10) ||
    0;
  const views = Number.parseInt(channel.statistics?.viewCount ?? "0", 10) || 0;
  const description = typeof channel.snippet?.description === "string"
    ? channel.snippet.description
    : "";

  return {
    channel_id: channelId,
    channel_name: title,
    channel_url: `https://www.youtube.com/channel/${channelId}`,
    subscriber_count: subscribers,
    video_count: videos,
    view_count: views,
    niche: detectNiche(`${title} ${description} ${evidence.title}`),
    size_tier: sizeTier(subscribers),
    status: "pending",
    outreach_channel: null,
    contact_email: null,
    instagram_handle: null,
    source_url: `https://www.youtube.com/watch?v=${evidence.videoId}`,
    source_label: `Resultado público do YouTube: ${evidence.title}`,
    researched_at: null,
    research_summary: null,
    fit_reason: null,
    teaching_topics: [],
    qualification_score: null,
    qualification_notes: null,
    ready_for_outreach: false,
    do_not_contact: false,
  };
}

export function dedupeCandidates(
  candidates: DiscoveryCandidate[],
  existingIds: Iterable<string>,
  limit: number,
): DiscoveryCandidate[] {
  const known = new Set(
    Array.from(existingIds, normalizeChannelId).filter(Boolean),
  );
  const result: DiscoveryCandidate[] = [];
  for (const candidate of candidates) {
    const key = normalizeChannelId(candidate.channel_id);
    if (!key || known.has(key)) continue;
    known.add(key);
    result.push(candidate);
    if (result.length >= clampLimit(limit)) break;
  }
  return result;
}
