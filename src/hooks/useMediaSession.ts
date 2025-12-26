import { useEffect, useCallback } from 'react';

interface MediaSessionOptions {
  title: string;
  artist?: string;
  artwork?: string;
  onPlay?: () => void;
  onPause?: () => void;
  onSeekBackward?: () => void;
  onSeekForward?: () => void;
  onSeekTo?: (time: number) => void;
}

interface PositionState {
  duration: number;
  playbackRate?: number;
  position: number;
}

export const useMediaSession = () => {
  const isSupported = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  const setMetadata = useCallback((options: MediaSessionOptions) => {
    if (!isSupported) return;

    const artworkArray = options.artwork 
      ? [
          { src: options.artwork, sizes: '96x96', type: 'image/jpeg' },
          { src: options.artwork, sizes: '128x128', type: 'image/jpeg' },
          { src: options.artwork, sizes: '192x192', type: 'image/jpeg' },
          { src: options.artwork, sizes: '256x256', type: 'image/jpeg' },
          { src: options.artwork, sizes: '384x384', type: 'image/jpeg' },
          { src: options.artwork, sizes: '512x512', type: 'image/jpeg' },
        ]
      : undefined;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: options.title,
      artist: options.artist || 'Classfy',
      album: 'Classfy',
      artwork: artworkArray,
    });

    // Set action handlers
    if (options.onPlay) {
      navigator.mediaSession.setActionHandler('play', options.onPlay);
    }
    if (options.onPause) {
      navigator.mediaSession.setActionHandler('pause', options.onPause);
    }
    if (options.onSeekBackward) {
      navigator.mediaSession.setActionHandler('seekbackward', options.onSeekBackward);
    }
    if (options.onSeekForward) {
      navigator.mediaSession.setActionHandler('seekforward', options.onSeekForward);
    }
    if (options.onSeekTo) {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined) {
          options.onSeekTo!(details.seekTime);
        }
      });
    }
  }, [isSupported]);

  const setPlaybackState = useCallback((state: 'playing' | 'paused' | 'none') => {
    if (!isSupported) return;
    navigator.mediaSession.playbackState = state;
  }, [isSupported]);

  const setPositionState = useCallback((state: PositionState) => {
    if (!isSupported) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: state.duration,
        playbackRate: state.playbackRate || 1,
        position: Math.min(state.position, state.duration),
      });
    } catch (e) {
      // Some browsers may not support setPositionState
      console.warn('setPositionState not supported', e);
    }
  }, [isSupported]);

  const clearSession = useCallback(() => {
    if (!isSupported) return;
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    
    // Clear all action handlers
    const actions: MediaSessionAction[] = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto'];
    actions.forEach(action => {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch (e) {
        // Some actions may not be supported
      }
    });
  }, [isSupported]);

  return {
    isSupported,
    setMetadata,
    setPlaybackState,
    setPositionState,
    clearSession,
  };
};
