import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RewardAvatar } from "./RewardAvatar";
import { dispatchAvatarActivity } from "@/lib/notifications/avatarActivity";
import { dispatchRewardEarned } from "@/lib/rewards/events";

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "student-1" } }) }));
vi.mock("@/components/ProfileAvatar", () => ({ ProfileAvatar: () => createElement("span", null, "avatar") }));
vi.mock("@/components/ui/particle-burst", () => ({ ParticleBurst: () => null }));

describe("RewardAvatar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement("div", null,
      createElement(RewardAvatar),
      createElement(RewardAvatar, { collapsed: true }),
    )));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("anima o avatar com menu aberto e fechado para avisos e recompensas", async () => {
    await act(async () => dispatchAvatarActivity({ userId: "student-1", source: "notification", id: "notice-1" }));
    expect(container.querySelectorAll('.cf2-reward-avatar__ring[data-type="notification"]')).toHaveLength(2);
    expect(container.textContent).not.toContain("Points");

    await act(async () => dispatchRewardEarned({ userId: "student-1", actionKey: "WATCH_100", eventId: "reward-1", points: 15, pointType: "user" }));
    expect(container.querySelectorAll('.cf2-reward-avatar__gain')).toHaveLength(2);
    expect(container.textContent).toContain("+15");
  });
});
