import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  buildCandidate,
  clampLimit,
  dedupeCandidates,
  DiscoveryCandidate,
  DiscoveryEvidence,
  isPublishedWithinWindow,
  normalizeChannelId,
  normalizePublishedAt,
  normalizeQueries,
  normalizeRecentMonths,
  publishedAfterIso,
  toProspectInsert,
} from "./logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_QUERIES = [
  "programação curso português brasil",
  "inglês aula português brasil",
  "educação financeira aula brasil",
  "design figma curso português",
  "produtividade hábitos aula brasil",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function youtube(
  endpoint: string,
  params: Record<string, string>,
  key: string,
) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.set("key", key);
  Object.entries(params).forEach(([name, value]) =>
    url.searchParams.set(name, value)
  );
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube API ${endpoint} failed with ${response.status}`);
  }
  return response.json();
}

type ProspectorDependencies = {
  env: (name: string) => string | undefined;
  createServiceClient: (url: string, key: string) => any;
  youtubeRequest: typeof youtube;
};

const defaultDependencies: ProspectorDependencies = {
  env: (name) => Deno.env.get(name),
  createServiceClient: (url, key) => createClient(url, key, { auth: { persistSession: false } }),
  youtubeRequest: youtube,
};

export function createProspectorHandler(overrides: Partial<ProspectorDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) {
      return json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = dependencies.env("SUPABASE_URL")!;
    const serviceKey = dependencies.env("SUPABASE_SERVICE_ROLE_KEY")!;
    const youtubeKey = dependencies.env("YOUTUBE_API_KEY")!;
    const service = dependencies.createServiceClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await service.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !user) return json({ error: "Unauthorized" }, 401);

    const { data: role } = await service.from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin role required" }, 403);

    const body = await request.json().catch(() => ({}));
    const limit = clampLimit(body.limit);
    const commit = body.commit === true;
    const queries = normalizeQueries(body.queries, DEFAULT_QUERIES);
    const recentMonths = normalizeRecentMonths(body.recent_months);
    const publishedAfter = publishedAfterIso(recentMonths);

    const { data: existing, error: existingError } = await service.from(
      "prospects",
    ).select("channel_id");
    if (existingError) throw existingError;
    const existingIds = (existing ?? []).map((row: { channel_id: string }) =>
      row.channel_id
    );
    const knownIds = new Set(existingIds.map(normalizeChannelId).filter(Boolean));
    const evidenceByChannel = new Map<string, DiscoveryEvidence>();

    const selectedCandidates = Array.isArray(body.candidates)
      ? body.candidates.slice(0, limit)
      : [];
    if (commit && selectedCandidates.length) {
      for (const candidate of selectedCandidates) {
        const channelId = typeof candidate?.channel_id === "string"
          ? candidate.channel_id.trim()
          : "";
        const videoId = typeof candidate?.source_url === "string"
          ? new URL(candidate.source_url).searchParams.get("v") ?? ""
          : "";
        const candidatePublishedAt = normalizePublishedAt(candidate.discovery_published_at);
        if (
          /^UC[\w-]{20,}$/.test(channelId) && /^[\w-]{11}$/.test(videoId) &&
          isPublishedWithinWindow(candidatePublishedAt, publishedAfter)
        ) {
          evidenceByChannel.set(channelId, {
            videoId,
            publishedAt: candidatePublishedAt,
            query: typeof candidate.discovery_query === "string"
              ? candidate.discovery_query
              : "Prévia revisada",
            title: typeof candidate.source_label === "string"
              ? candidate.source_label.replace(
                /^Resultado público do YouTube:\s*/,
                "",
              )
              : "Vídeo público",
          });
        }
      }
    } else {
      for (const query of queries) {
        const searchParams: Record<string, string> = {
          part: "snippet",
          q: query,
          type: "video",
          regionCode: "BR",
          relevanceLanguage: "pt",
          maxResults: String(Math.min(25, Math.max(10, limit * 4))),
          safeSearch: "moderate",
        };
        if (publishedAfter) searchParams.publishedAfter = publishedAfter;
        const search = await dependencies.youtubeRequest("search", searchParams, youtubeKey);
        for (const item of search.items ?? []) {
          const channelId = item.snippet?.channelId;
          const videoId = item.id?.videoId;
          const itemPublishedAt = normalizePublishedAt(item.snippet?.publishedAt);
          if (
            channelId && videoId && !knownIds.has(normalizeChannelId(channelId)) &&
            !evidenceByChannel.has(channelId) &&
            isPublishedWithinWindow(itemPublishedAt, publishedAfter)
          ) {
            evidenceByChannel.set(channelId, {
              videoId,
              title: item.snippet?.title ?? "Vídeo público",
              publishedAt: itemPublishedAt,
              query,
            });
          }
        }
        if (evidenceByChannel.size >= 50) break;
      }
    }

    if (!evidenceByChannel.size) {
      return json({
        success: true,
        mode: commit ? "commit" : "preview",
        candidates: [],
        criteria: commit ? undefined : {
          queries,
          recent_months: recentMonths,
          published_after: publishedAfter,
          instructional_evidence_required: true,
        },
      });
    }
    const details = await dependencies.youtubeRequest("channels", {
      part: "snippet,statistics",
      id: Array.from(evidenceByChannel.keys()).slice(0, 50).join(","),
      maxResults: "50",
    }, youtubeKey);
    const built = (details.items ?? []).map((channel: Record<string, any>) =>
      buildCandidate(channel, evidenceByChannel.get(channel.id)!)
    ).filter((
      candidate: DiscoveryCandidate | null,
    ): candidate is DiscoveryCandidate => Boolean(candidate));
    const candidates = dedupeCandidates(built, existingIds, limit);

    if (!commit) {
      return json({
        success: true,
        mode: "preview",
        candidates,
        criteria: {
          queries,
          recent_months: recentMonths,
          published_after: publishedAfter,
          instructional_evidence_required: true,
        },
      });
    }
    const inserted: DiscoveryCandidate[] = [];
    const rejected: Array<{ channel_id: string; reason: string }> = [];
    for (const candidate of candidates) {
      const { error } = await service.from("prospects").insert(toProspectInsert(candidate));
      if (error) {
        rejected.push({
          channel_id: candidate.channel_id,
          reason: error.message,
        });
      } else inserted.push(candidate);
    }
    return json({ success: true, mode: "commit", inserted, rejected });
  } catch (error) {
    console.error("run-prospector error", error);
    return json({
      error: error instanceof Error ? error.message : "Unknown error",
    }, 400);
  }
  };
}

if (import.meta.main) Deno.serve(createProspectorHandler());
