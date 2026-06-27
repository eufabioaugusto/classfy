import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AppLogLevel = "debug" | "info" | "warn" | "error";

interface EdgeLogInput {
  level?: AppLogLevel;
  source: string;
  event: string;
  message?: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

let loggingDisabled = false;

function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.includes("@")) return value.replace(/^(.{2}).*(@.*)$/, "$1***$2");
    if (value.length > 120) return `${value.slice(0, 120)}...`;
  }

  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => {
        const normalizedKey = key.toLowerCase();
        if (
          normalizedKey.includes("password") ||
          normalizedKey.includes("token") ||
          normalizedKey.includes("secret") ||
          normalizedKey.includes("key")
        ) {
          return [key, "[redacted]"];
        }
        return [key, redactValue(item)];
      }),
    );
  }

  return value;
}

export async function recordEdgeLog(input: EdgeLogInput) {
  try {
    if (loggingDisabled) return;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceKey) return;

    const supabase = createClient(supabaseUrl, serviceKey);

    const { error } = await supabase.from("app_logs").insert({
      level: input.level || "info",
      source: input.source,
      event: input.event,
      message: input.message || null,
      request_id: input.requestId || null,
      context: redactValue(input.context || {}),
      metadata: redactValue(input.metadata || {}),
    });

    if (error) {
      const message = error.message || "";
      if (message.includes("app_logs") || message.includes("record_app_log")) {
        loggingDisabled = true;
      }
      console.error("Failed to record edge log:", error);
    }
  } catch (error) {
    console.error("Failed to record edge log:", error);
  }
}
