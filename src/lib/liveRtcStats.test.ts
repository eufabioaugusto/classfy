import { describe, expect, it } from "vitest";
import type { RemoteTrack } from "livekit-client";
import { sampleLiveRtcStats } from "./liveRtcStats";

function trackWithReport(entries: Array<[string, Record<string, number | string>]>) {
  return { getRTCStatsReport: async () => new Map(entries) as unknown as RTCStatsReport } as RemoteTrack;
}

describe("diagnóstico de vídeo em tempo real", () => {
  it("calcula bitrate, perda de pacotes e oscilação a partir dos contadores RTC", async () => {
    const first = await sampleLiveRtcStats(trackWithReport([
      ["video", { type: "inbound-rtp", kind: "video", bytesReceived: 100000, timestamp: 1000, packetsLost: 1, jitter: 0.008, framesPerSecond: 30 }],
    ]));
    const second = await sampleLiveRtcStats(trackWithReport([
      ["video", { type: "inbound-rtp", kind: "video", bytesReceived: 300000, timestamp: 3000, packetsLost: 3, jitter: 0.012, framesPerSecond: 29 }],
    ]), first.counter);

    expect(second.metrics).toMatchObject({ bitrateKbps: 800, packetsLost: 3, jitterMs: 12, framesPerSecond: 29 });
  });

  it("não publica zeros falsos antes de receber estatísticas de vídeo", async () => {
    const sample = await sampleLiveRtcStats(trackWithReport([
      ["audio", { type: "inbound-rtp", kind: "audio", bytesReceived: 5000, timestamp: 1000 }],
    ]));
    expect(sample.metrics).toEqual({});
  });

  it("separa perdas do microfone das perdas do vídeo", async () => {
    const sample = await sampleLiveRtcStats(trackWithReport([
      ["audio", { type: "inbound-rtp", kind: "audio", bytesReceived: 8000, timestamp: 1000, packetsLost: 4, jitter: 0.025 }],
    ]), undefined, "audio");
    expect(sample.metrics).toMatchObject({ audioPacketsLost: 4, audioJitterMs: 25 });
    expect(sample.metrics.packetsLost).toBeUndefined();
  });
});
