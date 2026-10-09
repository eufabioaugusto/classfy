import type { SharedValue } from 'react-native-reanimated';
import type { StudioCanvasTransform } from './canvasGeometry';

/** Only the selected element's transient geometry crosses this UI channel. */
export type StudioCanvasTransformChannel = {
  available: boolean; active: boolean; sequence: number; operationId: string; epoch: number; clipId: string;
  phase: 'idle' | 'gesture' | 'committing'; transform: StudioCanvasTransform;
  finish: 'commit' | 'cancel' | null;
};
export type StudioCanvasTransformChannelRef = SharedValue<StudioCanvasTransformChannel>;
export function initialStudioCanvasTransformChannel(): StudioCanvasTransformChannel {
  return { available: false, active: false, sequence: 0, operationId: '', epoch: 0, clipId: '', phase: 'idle',
    transform: { rect: { x: 0, y: 0, width: 1, height: 1 } }, finish: null };
}
