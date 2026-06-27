import { supabase } from "@/integrations/supabase/client";

type AppLogLevel = "debug" | "info" | "warn" | "error";

interface AppLogInput {
  level?: AppLogLevel;
  source: string;
  event: string;
  message?: string;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  requestId?: string;
}

const SESSION_STORAGE_KEY = "classfy_log_session_id";

function getSessionId() {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;

    const next = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, next);
    return next;
  } catch {
    return undefined;
  }
}

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
      })
    );
  }

  return value;
}

export function getSafeErrorPayload(error: unknown) {
  const err = error as {
    name?: string;
    message?: string;
    status?: number;
    code?: string;
  };

  return {
    name: err?.name,
    message: err?.message || String(error),
    status: err?.status,
    code: err?.code,
  };
}

export async function logAppEvent(input: AppLogInput) {
  try {
    const payload = {
      p_level: input.level || "info",
      p_source: input.source,
      p_event: input.event,
      p_message: input.message || null,
      p_context: redactValue(input.context || {}),
      p_metadata: redactValue({
        path: window.location.pathname,
        origin: window.location.origin,
        userAgent: navigator.userAgent,
        ...input.metadata,
      }),
      p_session_id: getSessionId() || null,
      p_request_id: input.requestId || null,
    };

    window.setTimeout(() => {
      (supabase as any)
        .rpc("record_app_log", payload)
        .then(({ error }: { error?: unknown }) => {
          if (error) console.warn("Failed to record app log", error);
        });
    }, 0);
  } catch (error) {
    console.warn("Failed to record app log", error);
  }
}
