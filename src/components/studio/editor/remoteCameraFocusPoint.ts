/** Map a visible point to the oriented, unmirrored image, excluding letterboxes. */
export function remoteCameraFocusPoint({ clientX, clientY, rect, imageWidth, imageHeight, fit = 'contain', mirrored = false }: {
  clientX: number; clientY: number; rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
  imageWidth: number; imageHeight: number; fit?: 'contain' | 'cover'; mirrored?: boolean;
}): { x: number; y: number } | null {
  if (![clientX, clientY, rect.left, rect.top, rect.width, rect.height, imageWidth, imageHeight].every(Number.isFinite) || Math.min(rect.width, rect.height, imageWidth, imageHeight) <= 0) return null;
  if (clientX < rect.left || clientY < rect.top || clientX > rect.left + rect.width || clientY > rect.top + rect.height) return null;
  const scale = (fit === 'cover' ? Math.max : Math.min)(rect.width / imageWidth, rect.height / imageHeight);
  const width = imageWidth * scale, height = imageHeight * scale;
  const x = (clientX - rect.left - (rect.width - width) / 2) / width;
  const y = (clientY - rect.top - (rect.height - height) / 2) / height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: mirrored ? 1 - x : x, y };
}
