import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMiniPlayerPlayback } from "./useMiniPlayerPlayback";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  source: vi.fn(), loadSource: vi.fn(), attachMedia: vi.fn(), destroy: vi.fn(),
  track: vi.fn(), flush: vi.fn(), metricsProps: vi.fn(),
  setCurrentTime: vi.fn(), setDuration: vi.fn(), setIsPlaying: vi.fn(),
  state: { content: { id: "lesson", media_asset_id: "asset", file_url: "media:asset", duration_seconds: 150 }, isVisible: true, isPlaying: true, currentTime: 42, duration: 150 },
  videoRef: { current: null as HTMLVideoElement | null },
}));
vi.mock("@/contexts/MiniPlayerContext", () => ({ useMiniPlayer: () => mocks }));
vi.mock("@/hooks/usePlaybackSource", () => ({ usePlaybackSource: (...args: unknown[]) => {
  mocks.source(...args); return { url: "https://video.example/manifest.m3u8", retry: vi.fn(), error: null };
} }));
vi.mock("@/hooks/useContentMetrics", () => ({ useContentMetrics: (props: unknown) => {
  mocks.metricsProps(props); return { handleTimeUpdate: mocks.track, flushProgress: mocks.flush };
} }));
vi.mock("hls.js", () => ({ default: class {
  static isSupported() { return true; }
  static Events = { ERROR: "error" };
  loadSource = mocks.loadSource;
  attachMedia = mocks.attachMedia;
  destroy = mocks.destroy;
  on() {}
} }));

describe("reprodução do mini player", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
  it("carrega streaming assinado, retoma a posição e persiste ao encerrar", async () => {
    const root = createRoot(document.createElement("div"));
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
    function Harness() { useMiniPlayerPlayback(); return <video ref={mocks.videoRef} />; }
    await act(async () => { root.render(<Harness />); });
    const video = mocks.videoRef.current!;
    Object.defineProperty(video, "duration", { value: 150 });
    await act(async () => { video.dispatchEvent(new Event("loadedmetadata")); });
    expect(mocks.source).toHaveBeenCalledWith(mocks.state.content, true);
    expect(mocks.loadSource).toHaveBeenCalledWith("https://video.example/manifest.m3u8");
    expect(mocks.attachMedia).toHaveBeenCalledWith(video);
    expect(video.currentTime).toBe(42);
    expect(play).toHaveBeenCalled();
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    video.currentTime = 43;
    await act(async () => { video.dispatchEvent(new Event("timeupdate")); });
    expect(mocks.track).toHaveBeenCalledWith(43);
    Object.defineProperty(video, "paused", { value: true });
    await act(async () => { video.dispatchEvent(new Event("timeupdate")); });
    expect(mocks.track).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
    expect(mocks.flush).toHaveBeenCalledWith(43, false);
    expect(mocks.destroy).toHaveBeenCalled();
  });
});
