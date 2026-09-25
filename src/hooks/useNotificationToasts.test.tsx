import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewardAvatar } from "@/components/RewardAvatar";
import { useNotificationToasts } from "./useNotificationToasts";

const mocks = vi.hoisted(() => ({
  onInsert: null as null | ((payload: { new: unknown }) => void),
  toast: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "student-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ProfileAvatar", () => ({ ProfileAvatar: () => createElement("span", null, "avatar") }));
vi.mock("@/components/ui/particle-burst", () => ({ ParticleBurst: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const query = {
    select: () => query,
    eq: () => query,
    gt: () => query,
    order: () => query,
    limit: () => Promise.resolve({ data: [] }),
  };
  const channel = {
    on: (_event: string, _filter: unknown, callback: (payload: { new: unknown }) => void) => {
      mocks.onInsert = callback;
      return channel;
    },
    subscribe: () => channel,
  };
  return { supabase: { from: () => query, channel: () => channel, removeChannel: mocks.removeChannel } };
});

function NotificationScreen() {
  useNotificationToasts();
  return createElement("div", null,
    createElement(RewardAvatar),
    createElement(RewardAvatar, { collapsed: true }),
  );
}

describe("notificações no avatar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    localStorage.clear();
    mocks.toast.mockClear();
    mocks.removeChannel.mockClear();
    mocks.onInsert = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(NotificationScreen)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("anima os avatares aberto e fechado ao receber um aviso, sem duplicar o evento", async () => {
    expect(mocks.onInsert).toBeTypeOf("function");
    const notification = {
      id: "notice-1",
      user_id: "student-1",
      title: "Novo aviso",
      message: "Seu estudo foi atualizado",
      created_at: "2026-09-25T12:00:00.000Z",
    };

    await act(async () => mocks.onInsert?.({ new: notification }));
    expect(container.querySelectorAll('.cf2-reward-avatar__ring[data-type="notification"]')).toHaveLength(2);
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Novo aviso",
      description: "Seu estudo foi atualizado",
    });
    expect(mocks.toast).toHaveBeenCalledTimes(1);

    await act(async () => mocks.onInsert?.({ new: notification }));
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
});
