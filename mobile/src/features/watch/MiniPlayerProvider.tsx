import { PropsWithChildren, useCallback, useMemo, useState } from 'react';

import {
  MiniPlayerContent,
  MiniPlayerContext,
  MiniPlayerContextValue,
} from '@/features/watch/miniPlayerContext';

export function MiniPlayerProvider({ children }: PropsWithChildren) {
  const [content, setContent] = useState<MiniPlayerContent | null>(null);
  const [visible, setVisible] = useState(false);

  const startMiniPlayer = useCallback((nextContent: MiniPlayerContent) => {
    setContent(nextContent);
    setVisible(true);
  }, []);

  const closeMiniPlayer = useCallback(() => {
    setVisible(false);
  }, []);

  const value = useMemo<MiniPlayerContextValue>(
    () => ({
      content,
      visible,
      startMiniPlayer,
      closeMiniPlayer,
    }),
    [closeMiniPlayer, content, startMiniPlayer, visible],
  );

  return <MiniPlayerContext.Provider value={value}>{children}</MiniPlayerContext.Provider>;
}
