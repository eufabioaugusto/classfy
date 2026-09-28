import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { useRewardSystem } from "./useRewardSystem";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: { progress_percent: 10, total_watched_seconds: 15 }, error: null }),
  invoke: vi.fn().mockResolvedValue({ data: { alreadyTracked: true }, error: null }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/rewards/events", () => ({ dispatchRewardEarned: vi.fn() }));

describe("recompensas entre players", () => {
  it("usa o tempo total aceito no servidor para 15s e não repete a recompensa", async () => {
    const root = createRoot(document.createElement("div"));
    let rewards: ReturnType<typeof useRewardSystem>;
    function Harness() { rewards = useRewardSystem(); return null; }
    await act(async () => { root.render(<Harness />); });
    // Foram assistidos 10s no principal + 5s no mini player.
    await rewards.trackProgressSession("viewer", "handoff-lesson", "mini-session", 5, 15);
    expect(mocks.rpc).toHaveBeenCalledWith("record_content_progress_v2", expect.objectContaining({
      p_session_watched_seconds: 5, p_last_position_seconds: 15,
    }));
    expect(mocks.invoke).toHaveBeenCalledWith("process-reward", {
      body: { actionKey: "VIEW_15S", userId: "viewer", contentId: "handoff-lesson", metadata: { sessionId: "mini-session" } },
    });
    await rewards.trackProgressSession("viewer", "handoff-lesson", "mini-session", 10, 20);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
