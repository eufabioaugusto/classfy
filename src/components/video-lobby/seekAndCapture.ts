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
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      video.removeEventListener("seeked", onSeeked);
      resolve(createGreyPlaceholder(width, height));
    }, 3000);

    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      const doCapture = () => {
        clearTimeout(timeout);
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(video, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          if (dataUrl.length < 1000) {
            resolve(createGreyPlaceholder(width, height));
          } else {
            resolve(dataUrl);
          }
        } catch {
          resolve(createGreyPlaceholder(width, height));
        }
      };
      if (video.paused && video.readyState < 3) {
        video.play().then(() => {
          video.pause();
          setTimeout(doCapture, 80);
        }).catch(() => setTimeout(doCapture, 80));
      } else {
        setTimeout(doCapture, 80);
      }
    };

    video.addEventListener("seeked", onSeeked);
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.05));
  });
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
 * Generate frames progressively from a video element via sequential seeks.
 * Calls `onFrame(index, dataUrl)` as each frame is captured — enables incremental UI updates.
 * Returns array of all data URLs on completion. Never rejects.
 */
export async function generateFramesProgressive(
  video: HTMLVideoElement,
  frameCount: number,
  thumbWidth: number,
  onFrame: (index: number, dataUrl: string) => void,
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
    onFrame(i, dataUrl);
  }

  return frames;
}

/**
 * @deprecated Use generateFramesProgressive instead for incremental UI updates.
 */
export async function generateFramesFromRef(
  video: HTMLVideoElement,
  frameCount: number,
  thumbWidth: number,
  abortSignal?: { aborted: boolean }
): Promise<string[]> {
  return generateFramesProgressive(video, frameCount, thumbWidth, () => {}, abortSignal);
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
