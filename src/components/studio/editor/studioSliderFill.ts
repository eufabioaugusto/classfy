import type { CSSProperties } from 'react';

export function studioSliderFill(value: number, min: number, max: number): CSSProperties {
  const fraction = max > min ? (value - min) / (max - min) : 0;
  return { '--se-slider-fill': `${Math.max(0, Math.min(1, fraction)) * 100}%` } as CSSProperties;
}
