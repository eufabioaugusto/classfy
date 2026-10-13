export type RemoteCameraFocusPoint = { x: number; y: number; locked: boolean };
export type RemoteCameraMonitorSize = { width: number; height: number };

/** The native camera uses aspect fit. Black rails are never a focus target. */
export function remoteCameraFocusPoint(point: { x: number; y: number }, view: RemoteCameraMonitorSize,
  source: RemoteCameraMonitorSize, locked: boolean): RemoteCameraFocusPoint | null {
  if (![point.x, point.y, view.width, view.height, source.width, source.height].every(Number.isFinite)
    || Math.min(view.width, view.height, source.width, source.height) <= 0) return null;
  const factor = Math.min(view.width / source.width, view.height / source.height);
  const width = source.width * factor, height = source.height * factor;
  const left = (view.width - width) / 2, top = (view.height - height) / 2;
  if (point.x < left || point.x > left + width || point.y < top || point.y > top + height) return null;
  // These coordinates deliberately include the letterbox. AVCaptureView maps
  // them through its actual preview layer, rotation and mirroring.
  return { x: point.x / view.width, y: point.y / view.height, locked };
}

export function remoteCameraMonitorLayout(view: RemoteCameraMonitorSize,
  insets: { top: number; left: number; right: number; bottom: number }, recording: boolean) {
  const landscape = view.width > view.height;
  const left = Math.max(16, insets.left + 12), right = Math.max(16, insets.right + 12);
  const top = Math.max(12, insets.top + 8), bottom = Math.max(16, insets.bottom + 10);
  return {
    landscape, left, right, top, bottom,
    audioWidth: Math.min(180, Math.max(100, view.width - left - right - (recording && landscape ? 100 : 0))),
    audioBottom: bottom + (recording && !landscape ? 94 : 0),
    sheetMaxHeight: Math.max(120, view.height - Math.max(16, insets.top) - 24),
  };
}

export function remoteCameraQualityLabel(width?: number, height?: number) {
  if (!width || !height) return '—';
  const edge = Math.min(width, height);
  return edge >= 2160 ? '4K' : edge >= 1440 ? '2K' : edge >= 1080 ? 'HD' : edge >= 720 ? '720p' : `${edge}p`;
}
