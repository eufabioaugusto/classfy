import type { SharedValue } from 'react-native-reanimated';

// Transport only: no recipe, source URI, project or editor state crosses here.
export type StudioTimelinePlaybackChannel = {
  active: boolean;
  sequence: number;
  position: number;
  playing: boolean;
  loading: boolean;
};
export type StudioTimelinePlaybackChannelRef = SharedValue<StudioTimelinePlaybackChannel>;
