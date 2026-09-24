import type { LocalTrack, RemoteTrack } from "livekit-client";
import type { LiveDiagnosticMetrics } from "@/hooks/useLiveDiagnostics";

type Counter = { bytes: number; at: number };

export async function sampleLiveRtcStats(track: LocalTrack | RemoteTrack, previous?: Counter, kind: "video" | "audio" = "video") {
  const report = await track.getRTCStatsReport();
  if (!report) return { metrics: {} as LiveDiagnosticMetrics, counter: previous };
  let bytes = 0;
  let at = 0;
  let packetsLost = 0;
  let framesPerSecond = 0;
  let jitterMs = 0;
  let rttMs = 0;
  let foundTrack = false;
  report.forEach((entry) => {
    const stat = entry as unknown as Record<string, number | string>;
    if ((stat.type === "inbound-rtp" || stat.type === "outbound-rtp") && (stat.kind === kind || stat.mediaType === kind)) {
      foundTrack = true;
      bytes += Number(stat.bytesReceived ?? stat.bytesSent ?? 0);
      at = Math.max(at, Number(stat.timestamp ?? 0));
      packetsLost += Number(stat.packetsLost ?? 0);
      framesPerSecond = Math.max(framesPerSecond, Number(stat.framesPerSecond ?? 0));
      jitterMs = Math.max(jitterMs, Number(stat.jitter ?? 0) * 1000);
    }
    if (stat.type === "remote-inbound-rtp" && (stat.kind === kind || stat.mediaType === kind)) {
      rttMs = Math.max(rttMs, Number(stat.roundTripTime ?? 0) * 1000);
      packetsLost += Number(stat.packetsLost ?? 0);
    }
  });
  if (!foundTrack) return { metrics: {} as LiveDiagnosticMetrics, counter: previous };
  const bitrateKbps = previous && at > previous.at && bytes >= previous.bytes
    ? Math.round(((bytes - previous.bytes) * 8) / (at - previous.at)) : undefined;
  return {
    metrics: kind === "video" ? {
      ...(bitrateKbps !== undefined ? { bitrateKbps } : {}),
      packetsLost: Math.max(0, Math.round(packetsLost)),
      framesPerSecond: Math.max(0, framesPerSecond),
      jitterMs: Math.max(0, Math.round(jitterMs)),
      ...(rttMs ? { rttMs: Math.round(rttMs) } : {}),
    } : {
      ...(bitrateKbps !== undefined ? { audioBitrateKbps: bitrateKbps } : {}),
      audioPacketsLost: Math.max(0, Math.round(packetsLost)),
      audioJitterMs: Math.max(0, Math.round(jitterMs)),
    } as LiveDiagnosticMetrics,
    counter: { bytes, at },
  };
}
