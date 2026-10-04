import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  buildCandidate,
  clampLimit,
  dedupeCandidates,
  DiscoveryCandidate,
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

Deno.serve(async (request) => {
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const youtubeKey = Deno.env.get("YOUTUBE_API_KEY")!;
    const service = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
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
    const requestedQueries = Array.isArray(body.queries)
      ? body.queries.filter((value: unknown) =>
        typeof value === "string" && value.trim()
      ).slice(0, 3)
      : [];
    const queries = requestedQueries.length
      ? requestedQueries
      : DEFAULT_QUERIES.slice(0, 3);

    const { data: existing, error: existingError } = await service.from(
      "prospects",
    ).select("channel_id");
    if (existingError) throw existingError;
    const existingIds = (existing ?? []).map((row: { channel_id: string }) =>
      row.channel_id
    );
    const evidenceByChannel = new Map<
      string,
      { videoId: string; title: string }
    >();

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
        if (/^UC[\w-]{20,}$/.test(channelId) && /^[\w-]{11}$/.test(videoId)) {
          evidenceByChannel.set(channelId, {
            videoId,
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
        const search = await youtube("search", {
          part: "snippet",
          q: query,
          type: "video",
          regionCode: "BR",
          relevanceLanguage: "pt",
          maxResults: String(limit),
          safeSearch: "moderate",
        }, youtubeKey);
        for (const item of search.items ?? []) {
          const channelId = item.snippet?.channelId;
          const videoId = item.id?.videoId;
          if (channelId && videoId && !evidenceByChannel.has(channelId)) {
            evidenceByChannel.set(channelId, {
              videoId,
              title: item.snippet?.title ?? "Vídeo público",
            });
          }
        }
        if (evidenceByChannel.size >= limit * 2) break;
      }
    }

    if (!evidenceByChannel.size) {
      return json({
        success: true,
        mode: commit ? "commit" : "preview",
        candidates: [],
      });
    }
    const details = await youtube("channels", {
      part: "snippet,statistics",
      id: Array.from(evidenceByChannel.keys()).join(","),
      maxResults: "50",
    }, youtubeKey);
    const built = (details.items ?? []).map((channel: Record<string, any>) =>
      buildCandidate(channel, evidenceByChannel.get(channel.id)!)
    ).filter((
      candidate: DiscoveryCandidate | null,
    ): candidate is DiscoveryCandidate => Boolean(candidate));
    const candidates = dedupeCandidates(built, existingIds, limit);

    if (!commit) return json({ success: true, mode: "preview", candidates });
    const inserted: DiscoveryCandidate[] = [];
    const rejected: Array<{ channel_id: string; reason: string }> = [];
    for (const candidate of candidates) {
      const { error } = await service.from("prospects").insert(candidate);
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
});
