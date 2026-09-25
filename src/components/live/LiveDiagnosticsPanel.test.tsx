import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveDiagnosticsPanel } from "./LiveDiagnosticsPanel";
import type { LiveDiagnosticReport } from "@/hooks/useLiveDiagnostics";

describe("LiveDiagnosticsPanel", () => {
  it("renderiza métricas ainda indisponíveis sem derrubar a transmissão", () => {
    const report: LiveDiagnosticReport = {
      version: 1,
      sessionId: "session",
      liveId: "live",
      role: "host",
      deviceClass: "desktop",
      networkHint: "unknown",
      route: "waiting",
      startedAt: new Date().toISOString(),
      clockOffsetMs: null,
      clockProbeMs: null,
      quality: "unknown",
      fallbackReason: "none",
      metrics: { bitrateKbps: null, framesPerSecond: Number.NaN } as unknown as LiveDiagnosticReport["metrics"],
      lastChatSent: null,
      lastChatReceived: null,
      events: [],
    };

    const html = renderToStaticMarkup(<LiveDiagnosticsPanel report={report} lastSavedAt={null} saveError={false} dark />);
    expect(html).toContain("Aguardando vídeo");
    expect(html).toContain("Teste do relógio");
    expect(html).not.toContain("NaN");
  });
});
