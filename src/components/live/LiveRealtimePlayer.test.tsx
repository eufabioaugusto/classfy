import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LiveRealtimePlayer } from "./LiveRealtimePlayer";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  rooms: [] as Array<{ emit: (event: string, ...args: unknown[]) => void; connect: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
vi.mock("livekit-client", () => ({
  RoomEvent: {
    TrackSubscribed: "trackSubscribed", ParticipantDisconnected: "participantDisconnected",
    Disconnected: "disconnected", Reconnecting: "reconnecting", Reconnected: "reconnected",
    ConnectionQualityChanged: "connectionQualityChanged",
  },
  Track: { Kind: { Video: "video", Audio: "audio" } },
  Room: class {
    listeners = new Map<string, (...args: unknown[]) => void>();
    localParticipant = { identity: "viewer" };
    connect = vi.fn().mockResolvedValue(undefined);
    disconnect = vi.fn().mockResolvedValue(undefined);
    startAudio = vi.fn().mockResolvedValue(undefined);
    constructor() { mocks.rooms.push(this); }
    on(event: string, callback: (...args: unknown[]) => void) { this.listeners.set(event, callback); }
    emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.(...args); }
    removeAllListeners() { this.listeners.clear(); }
  },
}));

describe("LiveRealtimePlayer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.rooms.length = 0;
    mocks.invoke.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("mantém a tentativa direta viva após abrir a reserva e promove quando o vídeo chega", async () => {
    let resolveToken!: (value: { data: { url: string; token: string }; error: null }) => void;
    mocks.invoke.mockReturnValue(new Promise(resolve => { resolveToken = resolve; }));
    const onFallback = vi.fn();
    const onReady = vi.fn();
    const onEvent = vi.fn();
    const props = {
      liveId: "live", creatorId: "host", ending: false, standby: false, muted: true,
      onMutedChange: vi.fn(), onReady, onFallback, onComplete: vi.fn(), onEvent,
      onMetrics: vi.fn(), onQuality: vi.fn(), onFirstFrame: vi.fn(), onStall: vi.fn(),
    };

    await act(async () => root.render(createElement(LiveRealtimePlayer, props)));
    await act(async () => vi.advanceTimersByTime(8000));
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith("token");
    expect(mocks.rooms[0].connect).not.toHaveBeenCalled();

    await act(async () => root.render(createElement(LiveRealtimePlayer, { ...props, standby: true })));
    await act(async () => resolveToken({ data: { url: "wss://live.example", token: "test" }, error: null }));
    expect(mocks.rooms[0].connect).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith("rtc_connected");

    const attach = vi.fn();
    await act(async () => mocks.rooms[0].emit("trackSubscribed", { kind: "video", attach }, { trackSid: "camera" }, { identity: "host" }));
    expect(attach).toHaveBeenCalledWith(container.querySelector("video"));
    expect(onEvent).toHaveBeenCalledWith("rtc_track_subscribed");
    await act(async () => container.querySelector("video")?.dispatchEvent(new Event("playing", { bubbles: true })));
    expect(onReady).toHaveBeenCalledOnce();
  });

  it("não abre a reserva quando o primeiro quadro direto chega antes do limite", async () => {
    mocks.invoke.mockResolvedValue({ data: { url: "wss://live.example", token: "test" }, error: null });
    const onFallback = vi.fn();
    const onReady = vi.fn();
    await act(async () => root.render(createElement(LiveRealtimePlayer, {
      liveId: "live", creatorId: "host", ending: false, standby: false, muted: true,
      onMutedChange: vi.fn(), onReady, onFallback, onComplete: vi.fn(), onEvent: vi.fn(),
      onMetrics: vi.fn(), onQuality: vi.fn(), onFirstFrame: vi.fn(), onStall: vi.fn(),
    })));
    const attach = vi.fn();
    await act(async () => mocks.rooms[0].emit("trackSubscribed", { kind: "video", attach }, { trackSid: "camera" }, { identity: "host" }));
    expect(attach).toHaveBeenCalledWith(container.querySelector("video"));
    await act(async () => container.querySelector("video")?.dispatchEvent(new Event("playing", { bubbles: true })));
    await act(async () => vi.advanceTimersByTime(8000));
    expect(onReady).toHaveBeenCalledOnce();
    expect(onFallback).not.toHaveBeenCalled();
    await act(async () => mocks.rooms[0].emit("disconnected"));
    expect(onFallback).toHaveBeenCalledWith("room_left");
  });
});
