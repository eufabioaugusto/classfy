import { createContext, useContext } from 'react';
import type { VideoPlayer } from 'expo-video';

export type MiniPlayerContent = {
  id: string; title: string; fileUrl?: string | null; thumbnailUrl?: string | null;
  creatorName?: string | null; durationSeconds?: number | null;
  startPositionMillis?: number; shouldPlay?: boolean;
  lessonId?: string; studyId?: string; trackingContentId?: string; courseId?: string; trackingEnabled?: boolean;
};
export type MiniPlayerContextValue = {
  content: MiniPlayerContent | null; visible: boolean; player: VideoPlayer;
  playing: boolean; position: number; duration: number; status: string; error: string | null;
  watchPercent: number; realWatchSeconds: number; qualifiedWatchSeconds: number; completed: boolean;
  attach: (content: MiniPlayerContent) => Promise<void>;
  startMiniPlayer: (content: MiniPlayerContent) => void;
  closeMiniPlayer: () => void; expand: () => void; togglePlay: () => void;
  seek: (seconds: number) => void; flush: () => Promise<void>;
};
export const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null);
export function useMiniPlayer() {
  const value = useContext(MiniPlayerContext);
  if (!value) throw new Error('useMiniPlayer must be used inside MiniPlayerProvider');
  return value;
}
