import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RewardAvatar } from "@/components/RewardAvatar";
import { useMessageNotifications } from "./useMessageNotifications";

const mocks = vi.hoisted(() => ({
  onInsert: null as null | ((payload: { new: unknown }) => Promise<void>),
  toast: vi.fn(),
  removeChannel: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "student-1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/ProfileAvatar", () => ({ ProfileAvatar: () => createElement("span", null, "avatar") }));
vi.mock("@/components/ui/particle-burst", () => ({ ParticleBurst: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => ({
    select: () => query(table),
    eq: () => query(table),
    maybeSingle: () => Promise.resolve({ data: { id: "participant-1", is_muted: false, is_archived: false } }),
    single: () => Promise.resolve({ data: { display_name: "Creator Mentor", avatar_url: null } }),
  });
  const channel = {
    on: (_event: string, _filter: unknown, callback: (payload: { new: unknown }) => Promise<void>) => {
      mocks.onInsert = callback;
      return channel;
    },
    subscribe: () => channel,
  };
  return { supabase: { from: query, channel: () => channel, removeChannel: mocks.removeChannel } };
});

function MessageScreen() {
  useMessageNotifications();
  return createElement("div", null,
    createElement(RewardAvatar),
    createElement(RewardAvatar, { collapsed: true }),
  );
}

describe("mensagens no avatar", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.toast.mockClear();
    mocks.onInsert = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(MessageScreen)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("anima os dois avatares quando chega uma mensagem de outra pessoa", async () => {
    expect(mocks.onInsert).toBeTypeOf("function");
    await act(async () => {
      await mocks.onInsert?.({ new: {
        id: "message-1",
        sender_id: "creator-1",
        conversation_id: "conversation-1",
        content: "Vamos estudar?",
      } });
    });

    expect(container.querySelectorAll('.cf2-reward-avatar__ring[data-type="notification"]')).toHaveLength(2);
    expect(mocks.toast).toHaveBeenCalledWith({ title: "Creator Mentor", description: "Vamos estudar?" });
  });
});
