import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlaybackSource } from "./usePlaybackSource";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  getPlaybackSource: vi.fn(),
}));

vi.mock("@/lib/video/service", () => ({
  videoService: {
    getPlaybackSource: mocks.getPlaybackSource,
  },
}));

describe("fonte de reprodução", () => {
  afterEach(() => {
    mocks.getPlaybackSource.mockReset();
    document.body.innerHTML = "";
  });

  it("resolve a URL assinada antes do primeiro clique e permite tentar novamente", async () => {
    mocks.getPlaybackSource.mockResolvedValue({
      type: "hls",
      url: "https://video.example/manifest.m3u8",
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let playback: ReturnType<typeof usePlaybackSource> | null = null;

    function Harness() {
      playback = usePlaybackSource({
        media_asset_id: "asset-1",
        file_url: "media:asset-1",
      });
      return null;
    }

    await act(async () => {
      root.render(<Harness />);
    });

    expect(mocks.getPlaybackSource).toHaveBeenCalledWith("asset-1");
    expect(playback?.url).toBe("https://video.example/manifest.m3u8");

    await act(async () => {
      playback?.retry();
    });

    expect(mocks.getPlaybackSource).toHaveBeenCalledTimes(2);

    await act(async () => {
      root.unmount();
    });
  });
});
