import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createProspectorHandler } from "./index.ts";

const existingChannel = "UCexisting00000000000001";
const newChannel = "UCcandidate0000000000001";
const videoId = "video000001";

function createService(existingIds: string[] = []) {
  const inserted: Array<Record<string, unknown>> = [];
  const roleQuery: Record<string, unknown> = {};
  roleQuery.select = () => roleQuery;
  roleQuery.eq = () => roleQuery;
  roleQuery.maybeSingle = async () => ({ data: { role: "admin" }, error: null });

  const service = {
    auth: { getUser: async () => ({ data: { user: { id: "admin" } }, error: null }) },
    from(table: string) {
      if (table === "user_roles") return roleQuery;
      if (table === "prospects") {
        return {
          select: async () => ({ data: existingIds.map((channel_id) => ({ channel_id })), error: null }),
          insert: async (value: Record<string, unknown>) => {
            inserted.push(value);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { service, inserted };
}

function request(body: unknown) {
  return new Request("https://example.test/functions/v1/run-prospector", {
    method: "POST",
    headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function youtubeMock(endpoint: string) {
  if (endpoint === "search") {
    return Promise.resolve({ items: [
      { id: { videoId: "existing001" }, snippet: { channelId: existingChannel, title: "Aula antiga já captada", publishedAt: "2026-09-01T00:00:00Z" } },
      { id: { videoId }, snippet: { channelId: newChannel, title: "Aula prática de matemática", publishedAt: "2026-09-20T00:00:00Z" } },
    ] });
  }
  return Promise.resolve({ items: [{
    id: newChannel,
    snippet: { title: "Professor de Matemática", description: "Aulas e exercícios práticos" },
    statistics: { subscriberCount: "100", videoCount: "20", viewCount: "3000" },
  }] });
}

Deno.test("HTTP preview deduplicates before the limit and performs no writes", async () => {
  const { service, inserted } = createService([existingChannel]);
  const handler = createProspectorHandler({
    env: () => "test",
    createServiceClient: () => service as never,
    youtubeRequest: youtubeMock,
  });
  const response = await handler(request({ limit: 5, queries: ["matemática aula"], recent_months: 6 }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.mode, "preview");
  assertEquals(body.candidates.map((candidate: { channel_id: string }) => candidate.channel_id), [newChannel]);
  assertEquals(inserted.length, 0);
});

Deno.test("HTTP confirmation persists only pending prospect fields and strips preview metadata", async () => {
  const { service, inserted } = createService();
  const handler = createProspectorHandler({
    env: () => "test",
    createServiceClient: () => service as never,
    youtubeRequest: youtubeMock,
  });
  const preview = await (await handler(request({ queries: ["matemática aula"], recent_months: 6 }))).json();
  const response = await handler(request({
    commit: true,
    candidates: preview.candidates,
    queries: preview.criteria.queries,
    recent_months: preview.criteria.recent_months,
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.mode, "commit");
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].channel_id, newChannel);
  assertEquals(inserted[0].status, "pending");
  assertEquals(inserted[0].ready_for_outreach, false);
  assertEquals(inserted[0].researched_at, null);
  assertEquals("discovery_published_at" in inserted[0], false);
  assertEquals("discovery_query" in inserted[0], false);
  assertEquals("discovery_reason" in inserted[0], false);
});

Deno.test("HTTP surfaces upstream API errors without calling them an empty result", async () => {
  const { service, inserted } = createService();
  const handler = createProspectorHandler({
    env: () => "test",
    createServiceClient: () => service as never,
    youtubeRequest: () => Promise.reject(new Error("YouTube unavailable")),
  });
  const response = await handler(request({ queries: ["design tutorial"], recent_months: 3 }));
  const body = await response.json();

  assertEquals(response.status, 400);
  assertStringIncludes(body.error, "YouTube unavailable");
  assertEquals(inserted.length, 0);
});

Deno.test("HTTP rejects malformed arbitrary candidate ids before persistence", async () => {
  const { service, inserted } = createService();
  const handler = createProspectorHandler({
    env: () => "test",
    createServiceClient: () => service as never,
    youtubeRequest: youtubeMock,
  });
  const response = await handler(request({
    commit: true,
    recent_months: 6,
    candidates: [{
      channel_id: "arbitrary",
      source_url: `https://www.youtube.com/watch?v=${videoId}`,
      discovery_published_at: "2026-09-20T00:00:00Z",
    }],
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.candidates, []);
  assertEquals(inserted.length, 0);
  assert(body.success);
});

Deno.test("HTTP confirmation deduplicates an id already stored", async () => {
  const { service, inserted } = createService([existingChannel]);
  const handler = createProspectorHandler({
    env: () => "test",
    createServiceClient: () => service as never,
    youtubeRequest: (endpoint) => endpoint === "channels"
      ? Promise.resolve({ items: [{
        id: existingChannel,
        snippet: { title: "Professor já captado", description: "Aulas práticas" },
        statistics: {},
      }] })
      : Promise.resolve({ items: [] }),
  });
  const response = await handler(request({
    commit: true,
    recent_months: 6,
    candidates: [{
      channel_id: existingChannel,
      source_url: "https://www.youtube.com/watch?v=existing001",
      source_label: "Resultado público do YouTube: Aula prática",
      discovery_published_at: "2026-09-01T00:00:00Z",
      discovery_query: "matemática aula",
    }],
  }));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.inserted, []);
  assertEquals(inserted.length, 0);
});
