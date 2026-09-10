import type { HlsConfig } from "hls.js";

// Classfy video economy rule: preserve quality, avoid fetching bytes before intent.
// ABR remains automatic; the player may reach 1080p when connection and viewport allow it.
export const standardHlsConfig: Partial<HlsConfig> = {
  enableWorker: true,
  lowLatencyMode: false,
  startLevel: -1,
  capLevelToPlayerSize: true,
  maxBufferLength: 20,
  maxMaxBufferLength: 30,
  backBufferLength: 30,
  maxBufferSize: 30 * 1000 * 1000,
};

export const shortsHlsConfig: Partial<HlsConfig> = {
  ...standardHlsConfig,
  maxBufferLength: 8,
  maxMaxBufferLength: 15,
  backBufferLength: 10,
  maxBufferSize: 15 * 1000 * 1000,
};

export function releaseMediaElement(media: HTMLMediaElement) {
  media.pause();
  media.removeAttribute("src");
  media.load();
}
