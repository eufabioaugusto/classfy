/**
 * Shared utility: seek a video element to a specific time and capture a frame via canvas.
 * Uses the SAME video element (no createElement) — safe for iOS Safari.
 */
export function seekAndCapture(
  video: HTMLVideoElement,
  time: number,
  width: number,
  height: number,
  quality = 0.6
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      // Fallback: return grey placeholder instead of rejecting
      resolve(createGreyPlaceholder(width, height));
    }, 3000);

    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      // iOS Safari needs a delay after seeked for the frame to render
      setTimeout(() => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch (e) {
          resolve(createGreyPlaceholder(width, height));
        }
      }, 80);
    };

    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.05));
  });
}

/**
 * Capture the current frame of a video WITHOUT seeking.
 * Used to create a poster overlay before background seeks.
 */
export function captureCurrentFrame(
  video: HTMLVideoElement,
  width: number,
  height: number,
  quality = 0.7
): string | null {
  try {
    if (video.readyState < 2) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

/** Create a grey placeholder data URL */
function createGreyPlaceholder(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#222";
  ctx.fillRect(0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.5);
}

/**
 * Generate multiple frames from a video element via sequential seeks.
 * Returns array of data URLs. Failures produce grey placeholders (never rejects).
 */
export async function generateFramesFromRef(
  video: HTMLVideoElement,
  frameCount: number,
  thumbWidth: number,
  abortSignal?: { aborted: boolean }
): Promise<string[]> {
  const dur = video.duration;
  if (!dur || dur <= 0) return [];

  const aspect = video.videoWidth && video.videoHeight
    ? video.videoWidth / video.videoHeight
    : 16 / 9;
  const thumbHeight = Math.round(thumbWidth / aspect);
  const frames: string[] = [];

  for (let i = 0; i < frameCount; i++) {
    if (abortSignal?.aborted) return frames;
    const time = (dur / frameCount) * i + 0.1;
    const dataUrl = await seekAndCapture(video, time, thumbWidth, thumbHeight, 0.5);
    frames.push(dataUrl);
  }

  return frames;
}

export function dataURLtoFile(dataUrl: string, filename: string): File {
  const arr = dataUrl.split(",");
  const mime = arr[0].match(/:(.*?);/)![1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}
