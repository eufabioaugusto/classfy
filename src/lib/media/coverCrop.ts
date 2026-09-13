export interface CoverCropPosition {
  x: number;
  y: number;
}

export interface CoverCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));

export function getCoverCropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetAspect: number,
  position: CoverCropPosition = { x: 50, y: 50 },
): CoverCropRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetAspect <= 0) {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const x = clampPercent(position.x) / 100;
  const y = clampPercent(position.y) / 100;

  if (sourceAspect > targetAspect) {
    const sw = sourceHeight * targetAspect;
    return {
      sx: (sourceWidth - sw) * x,
      sy: 0,
      sw,
      sh: sourceHeight,
    };
  }

  const sh = sourceWidth / targetAspect;
  return {
    sx: 0,
    sy: (sourceHeight - sh) * y,
    sw: sourceWidth,
    sh,
  };
}

export function coverTargetSize(targetAspect: number) {
  return targetAspect < 1
    ? { width: 1080, height: 1920 }
    : { width: 1920, height: Math.round(1920 / targetAspect) };
}
