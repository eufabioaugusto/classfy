import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveRoute = "waiting" | "webrtc" | "hls" | "replay" | "ended";
export type LiveDiagnosticMetrics = Partial<Record<
  "firstFrameMs" | "roomConnectMs" | "bitrateKbps" | "packetsLost" | "jitterMs" |
  "rttMs" | "framesPerSecond" | "bufferSeconds" | "playbackLatencySeconds" |
  "droppedFrames" | "reconnects" | "stalls" | "audioBitrateKbps" |
  "audioPacketsLost" | "audioJitterMs", number
>>;

export type ChatTiming = {
  direction: "sent" | "received";
  messageId: string;
  serverCreatedAt: string;
  clientObservedAt: string;
  acknowledgementMs?: number;
  approximateTransitMs?: number;
};

export type LiveDiagnosticReport = {
  version: 1;
  sessionId: string;
  liveId: string;
  role: "host" | "viewer";
  deviceClass: "mobile" | "desktop";
  networkHint: string;
  route: LiveRoute;
  startedAt: string;
  clockOffsetMs: number | null;
  clockProbeMs: number | null;
  quality: "excellent" | "good" | "poor" | "lost" | "unknown";
  fallbackReason: "none" | "token" | "connect" | "timeout" | "host_left" | "room_left" | "hls_error";
  metrics: LiveDiagnosticMetrics;
  lastChatSent: ChatTiming | null;
  lastChatReceived: ChatTiming | null;
  events: { at: string; type: string }[];
};

export function useLiveDiagnostics(liveId: string | undefined, role: "host" | "viewer", userId?: string) {
  const [report, setReport] = useState<LiveDiagnosticReport>(() => ({
    version: 1, sessionId: crypto.randomUUID(), liveId: liveId ?? "", role,
    deviceClass: window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop",
    networkHint: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? "unknown",
    route: "waiting", startedAt: new Date().toISOString(), clockOffsetMs: null, clockProbeMs: null, quality: "unknown",
    fallbackReason: "none", metrics: {}, lastChatSent: null, lastChatReceived: null,
    events: [{ at: new Date().toISOString(), type: "page_opened" }],
  }));
  const reportRef = useRef(report);
  const clockOffsetRef = useRef<number | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  const update = useCallback((change: (current: LiveDiagnosticReport) => LiveDiagnosticReport) => {
    const next = change(reportRef.current);
    reportRef.current = next;
    setReport(next);
  }, []);

  const mark = useCallback((type: string) => update(current => ({
    ...current, events: [...current.events, { at: new Date().toISOString(), type }].slice(-40),
  })), [update]);

  const setRoute = useCallback((route: LiveRoute, fallbackReason?: LiveDiagnosticReport["fallbackReason"]) => update(current => ({
    ...current, route, fallbackReason: fallbackReason ?? current.fallbackReason,
  })), [update]);

  const setQuality = useCallback((quality: LiveDiagnosticReport["quality"]) => update(current => ({
    ...current, quality,
  })), [update]);

  const setMetrics = useCallback((metrics: LiveDiagnosticMetrics) => update(current => ({
    ...current, metrics: { ...current.metrics, ...metrics },
  })), [update]);

  const recordChat = useCallback((chat: ChatTiming) => {
    const observed = Date.parse(chat.clientObservedAt);
    const registered = Date.parse(chat.serverCreatedAt);
    const corrected = chat.direction === "received" && Number.isFinite(observed) && Number.isFinite(registered)
      ? { ...chat, approximateTransitMs: Math.max(0, Math.round(observed + (clockOffsetRef.current ?? 0) - registered)) } : chat;
    update(current => ({
      ...current,
      ...(corrected.direction === "sent" ? { lastChatSent: corrected } : { lastChatReceived: corrected }),
      events: [...current.events, { at: corrected.clientObservedAt, type: corrected.direction === "sent" ? "chat_sent" : "chat_received" }].slice(-40),
    }));
  }, [update]);

  const recordStall = useCallback(() => update(current => ({
    ...current,
    metrics: { ...current.metrics, stalls: (current.metrics.stalls ?? 0) + 1 },
    events: [...current.events, { at: new Date().toISOString(), type: "playback_stalled" }].slice(-40),
  })), [update]);

  const flush = useCallback(async () => {
    const current = reportRef.current;
    if (!current.liveId) return;
    try {
      const { error } = await supabase.functions.invoke("live-control", { body: {
        action: "diagnostics", liveId: current.liveId, sessionId: current.sessionId,
        role: current.role, route: current.route, report: current,
      } });
      setSaveError(Boolean(error));
      if (!error) setLastSavedAt(new Date().toISOString());
    } catch {
      setSaveError(true);
    }
  }, []);

  useEffect(() => {
    if (!liveId || !userId) return;
    if (reportRef.current.liveId !== liveId) update(current => ({ ...current, liveId }));
    const beforeWall = Date.now();
    const before = performance.now();
    void supabase.functions.invoke("live-control", { body: { action: "clock", liveId } })
      .then(({ data, error }) => {
        const probeMs = Math.round(performance.now() - before);
        const serverAt = Date.parse(String(data?.serverAt ?? ""));
        if (error || !Number.isFinite(serverAt) || probeMs > 5000) return;
        const offsetMs = Math.round(serverAt - (beforeWall + Date.now()) / 2);
        clockOffsetRef.current = offsetMs;
        update(current => ({ ...current, clockOffsetMs: offsetMs, clockProbeMs: probeMs }));
      }).catch(() => undefined);
    const first = window.setTimeout(() => { void flush(); }, 3000);
    const timer = window.setInterval(() => { void flush(); }, 12000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  }, [liveId, userId, flush, update]);

  return { report, lastSavedAt, saveError, mark, setRoute, setQuality, setMetrics, recordChat, recordStall, flush };
}
