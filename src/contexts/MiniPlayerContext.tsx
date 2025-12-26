import { createContext, useContext, useState, useRef, useCallback, useEffect, ReactNode } from "react";
import { useMediaSession } from "@/hooks/useMediaSession";

export interface MiniPlayerContent {
  id: string;
  title: string;
  subtitle?: string;
  thumbnail_url?: string;
  file_url: string;
  duration_seconds?: number;
  creator?: {
    display_name: string;
  };
}

interface MiniPlayerState {
  content: MiniPlayerContent | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isVisible: boolean;
  isExpanded: boolean;
}

interface MiniPlayerContextType {
  state: MiniPlayerState;
  videoRef: React.RefObject<HTMLVideoElement>;
  startMiniPlayer: (content: MiniPlayerContent, currentTime?: number) => void;
  closeMiniPlayer: () => void;
  togglePlay: () => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  expandPlayer: () => void;
  collapsePlayer: () => void;
  seekTo: (time: number) => void;
}

const MiniPlayerContext = createContext<MiniPlayerContextType | undefined>(undefined);

export const useMiniPlayer = () => {
  const context = useContext(MiniPlayerContext);
  if (!context) {
    throw new Error("useMiniPlayer must be used within a MiniPlayerProvider");
  }
  return context;
};

export const MiniPlayerProvider = ({ children }: { children: ReactNode }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const { setMetadata, setPlaybackState, setPositionState, clearSession } = useMediaSession();
  const [state, setState] = useState<MiniPlayerState>({
    content: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    isVisible: false,
    isExpanded: false,
  });

  // Setup Media Session when mini player content changes
  useEffect(() => {
    const video = videoRef.current;
    if (!state.content || !state.isVisible) {
      clearSession();
      return;
    }

    setMetadata({
      title: state.content.title,
      artist: state.content.creator?.display_name || 'Classfy',
      artwork: state.content.thumbnail_url,
      onPlay: () => {
        if (video) {
          video.play();
          setState(prev => ({ ...prev, isPlaying: true }));
        }
      },
      onPause: () => {
        if (video) {
          video.pause();
          setState(prev => ({ ...prev, isPlaying: false }));
        }
      },
      onSeekBackward: () => {
        if (video) {
          video.currentTime = Math.max(0, video.currentTime - 10);
        }
      },
      onSeekForward: () => {
        if (video) {
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
        }
      },
      onSeekTo: (time) => {
        if (video) {
          video.currentTime = time;
          setState(prev => ({ ...prev, currentTime: time }));
        }
      },
    });

    return () => {
      clearSession();
    };
  }, [state.content, state.isVisible, setMetadata, clearSession]);

  // Update playback state
  useEffect(() => {
    if (state.isVisible) {
      setPlaybackState(state.isPlaying ? 'playing' : 'paused');
    }
  }, [state.isPlaying, state.isVisible, setPlaybackState]);

  // Update position state
  useEffect(() => {
    if (state.isVisible && state.duration > 0) {
      setPositionState({
        duration: state.duration,
        position: state.currentTime,
      });
    }
  }, [state.currentTime, state.duration, state.isVisible, setPositionState]);

  const startMiniPlayer = useCallback((content: MiniPlayerContent, currentTime = 0) => {
    setState(prev => ({
      ...prev,
      content,
      currentTime,
      isVisible: true,
      isPlaying: true,
      isExpanded: false,
    }));
  }, []);

  const closeMiniPlayer = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.pause();
    }
    setState({
      content: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      isVisible: false,
      isExpanded: false,
    });
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (state.isPlaying) {
      video.pause();
    } else {
      video.play();
    }
    setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  }, [state.isPlaying]);

  const setCurrentTime = useCallback((time: number) => {
    setState(prev => ({ ...prev, currentTime: time }));
  }, []);

  const setDuration = useCallback((duration: number) => {
    setState(prev => ({ ...prev, duration }));
  }, []);

  const setIsPlaying = useCallback((playing: boolean) => {
    setState(prev => ({ ...prev, isPlaying: playing }));
  }, []);

  const expandPlayer = useCallback(() => {
    setState(prev => ({ ...prev, isExpanded: true }));
  }, []);

  const collapsePlayer = useCallback(() => {
    setState(prev => ({ ...prev, isExpanded: false }));
  }, []);

  const seekTo = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
    setState(prev => ({ ...prev, currentTime: time }));
  }, []);

  return (
    <MiniPlayerContext.Provider
      value={{
        state,
        videoRef,
        startMiniPlayer,
        closeMiniPlayer,
        togglePlay,
        setCurrentTime,
        setDuration,
        setIsPlaying,
        expandPlayer,
        collapsePlayer,
        seekTo,
      }}
    >
      {children}
    </MiniPlayerContext.Provider>
  );
};
