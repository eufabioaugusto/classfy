import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useContentMetrics } from "./useContentMetrics";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  trackProgressSession: vi.fn().mockResolvedValue(undefined),
  processReward: vi.fn().mockResolvedValue(true),
  insert: vi.fn().mockResolvedValue({ error: null }),
  user: { id: "viewer" },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/useRewardSystem", () => ({ useRewardSystem: () => mocks }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert: mocks.insert }) } }));
vi.mock("@/lib/personalization/interests", () => ({ trackUserInteraction: vi.fn() }));

describe("progresso econômico ao retomar no mini player", () => {
  afterEach(() => { vi.clearAllMocks(); document.body.innerHTML = ""; });

  it("soma somente reprodução real após a transferência e salva a posição ao fechar", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let metrics: ReturnType<typeof useContentMetrics>;
    function Harness() {
      metrics = useContentMetrics({ contentId: "lesson", duration: 180, initialPosition: 2 });
      return null;
    }
    await act(async () => { root.render(<Harness />); });
    // Retomar em 2s não deve conceder esses dois segundos novamente.
    await act(async () => { await metrics.handleTimeUpdate(2.25); });
    await act(async () => { await metrics.flushProgress(2.25); });
    expect(mocks.trackProgressSession.mock.calls[0].slice(0, 2)).toEqual(["viewer", "lesson"]);
    expect(mocks.trackProgressSession.mock.calls[0].slice(3, 5)).toEqual([0.25, 2.25]);
    // Avançar na barra não conta como tempo assistido.
    await act(async () => { await metrics.handleTimeUpdate(90); });
    await act(async () => { await metrics.handleTimeUpdate(90.5); });
    await act(async () => { await metrics.flushProgress(90.5); });
    expect(mocks.trackProgressSession.mock.calls.slice(-1)[0]?.slice(3, 5)).toEqual([0.75, 90.5]);
    expect(mocks.processReward).not.toHaveBeenCalled();
    await act(async () => { root.unmount(); });
  });

  it("envia checkpoints e solicita o marco de 15s depois de registrar a evidência", async () => {
    const root = createRoot(document.createElement("div"));
    let metrics: ReturnType<typeof useContentMetrics>;
    function Harness() {
      metrics = useContentMetrics({ contentId: "lesson", duration: 180, initialPosition: 60 });
      return null;
    }
    await act(async () => { root.render(<Harness />); });
    for (let time = 61; time <= 75; time++) {
      await act(async () => { await metrics.handleTimeUpdate(time); });
    }
    expect(mocks.trackProgressSession.mock.calls.slice(-1)[0]?.slice(3, 5)).toEqual([15, 75]);
    expect(mocks.processReward).toHaveBeenCalledWith(expect.objectContaining({ actionKey: "VIEW_15S", contentId: "lesson", metadata: { watch_time: 15 } }));
    await act(async () => { await metrics.handleTimeUpdate(75); });
    expect(mocks.trackProgressSession).toHaveBeenCalledTimes(3);
    await act(async () => { root.unmount(); });
  });
});
