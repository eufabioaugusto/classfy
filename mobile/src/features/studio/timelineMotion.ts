function finite(value: number, fallback = 0) {
  'worklet';
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lower: number, upper: number) {
  'worklet';
  return Math.max(lower, Math.min(upper, value));
}

export function studioLiveSegment(
  startSeconds: number, endSeconds: number, index: number, trimIndex: number,
  originalStart: number, originalEnd: number, draftStart: number, draftEnd: number,
  scale: number, leadingSeconds = 0,
) {
  'worklet';
  const pixelsPerSecond = Math.max(0, finite(scale));
  const start = finite(startSeconds);
  const length = Math.max(0, finite(endSeconds, start) - start);
  const sourceStart = finite(originalStart);
  const sourceEnd = finite(originalEnd, sourceStart);
  const originalLength = Math.max(0, sourceEnd - sourceStart);
  const draftLength = Math.max(0, finite(draftEnd, sourceEnd) - finite(draftStart, sourceStart));
  const delta = draftLength - originalLength;
  const trimming = Number.isFinite(trimIndex) && trimIndex >= 0;
  const liveStart = start + (trimming && index > trimIndex ? delta : 0) + finite(leadingSeconds);
  const liveLength = trimming && index === trimIndex ? draftLength : length;
  return { x: finite(liveStart * pixelsPerSecond), width: Math.max(0, finite(liveLength * pixelsPerSecond)) };
}

export function studioTrimDragValues(
  edge: 'start' | 'end', originalStart: number, originalEnd: number,
  sourceDuration: number, translationX: number, scrollDeltaPixels: number, scale: number,
) {
  'worklet';
  const duration = Math.max(0, finite(sourceDuration));
  const minimum = Math.min(0.1, duration);
  const sourceStart = clamp(finite(originalStart), 0, duration - minimum);
  const sourceEnd = clamp(finite(originalEnd, duration), sourceStart + minimum, duration);
  const delta = Number.isFinite(scale) && scale > 0 ? finite((finite(translationX) + finite(scrollDeltaPixels)) / scale) : 0;
  const value = Math.round(((edge === 'start' ? sourceStart : sourceEnd) + delta) * 1000) / 1000;
  const start = edge === 'start' ? clamp(value, 0, sourceEnd - minimum) : sourceStart;
  const end = edge === 'end' ? clamp(value, sourceStart + minimum, duration) : sourceEnd;
  // Moving the left boundary translates the whole continuous strip. Its
  // opposite boundary stays in place while neighbors remain joined to it.
  return { start, end, leadingSeconds: edge === 'start' ? start - sourceStart : 0 };
}

export function studioTimelineAutoScrollVelocity(fingerX: number, viewport: number, zone = 40, max = 240) {
  'worklet';
  if (![fingerX, viewport, zone, max].every(Number.isFinite) || viewport <= 0 || zone <= 0 || max <= 0) return 0;
  const edge = Math.min(zone, viewport / 2);
  if (fingerX < edge) return -max * clamp((edge - fingerX) / edge, 0, 1);
  if (fingerX > viewport - edge) return max * clamp((fingerX - viewport + edge) / edge, 0, 1);
  return 0;
}

export function studioTrimAutoscrollStep(
  edge: 'start' | 'end', originalStart: number, originalEnd: number,
  duration: number, translationX: number, initialOffset: number, nativeOffset: number,
  virtualOffset: number, scale: number, requestedDelta: number, maxOffset: number,
) {
  'worklet';
  const native = Math.max(0, finite(nativeOffset));
  const initial = finite(initialOffset);
  const translation = finite(translationX);
  const offset = clamp(native + finite(requestedDelta), 0, Math.max(0, finite(maxOffset)));
  // Native scrolling stops at a content boundary. The unconsumed movement is
  // virtual so a first clip can reveal its earlier source without negative
  // native offsets or detaching its handle from the finger.
  const proposedVirtual = finite(virtualOffset) + finite(requestedDelta) - (offset - native);
  const range = studioTrimDragValues(edge, originalStart, originalEnd, duration, translation, offset - initial + proposedVirtual, scale);
  const original = edge === 'start' ? finite(originalStart) : finite(originalEnd, Math.max(0, finite(duration)));
  const pixelsPerSecond = Math.max(0, finite(scale));
  // Accept only movement representable by the clamped source range. Repeating
  // frames at source start/end cannot accumulate an unbounded virtual offset.
  const acceptedVirtual = finite((range[edge] - original) * pixelsPerSecond - translation - (offset - initial));
  return { ...range, offset, virtualOffset: acceptedVirtual };
}
