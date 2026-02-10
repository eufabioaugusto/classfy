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
    const timeout = setTimeout(() => reject(new Error("seek timeout")), 5000);

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
          reject(e);
        }
      }, 80);
    };

    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.05));
  });
}

/**
 * Generate multiple frames from a video element via sequential seeks.
 * Returns array of data URLs.
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
    try {
      const dataUrl = await seekAndCapture(video, time, thumbWidth, thumbHeight, 0.5);
      frames.push(dataUrl);
    } catch {
      // Gray placeholder on failure
      const canvas = document.createElement("canvas");
      canvas.width = thumbWidth;
      canvas.height = thumbHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#222";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.5));
    }
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
