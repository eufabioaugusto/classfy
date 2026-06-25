import { createContext, useContext } from 'react';

export type MiniPlayerContent = {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  creatorName?: string | null;
  durationSeconds?: number | null;
};

export type MiniPlayerContextValue = {
  content: MiniPlayerContent | null;
  visible: boolean;
  startMiniPlayer: (content: MiniPlayerContent) => void;
  closeMiniPlayer: () => void;
};

export const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null);

export function useMiniPlayer() {
  const value = useContext(MiniPlayerContext);
  if (!value) {
    throw new Error('useMiniPlayer must be used inside MiniPlayerProvider');
  }
  return value;
}
