import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { StudioKind } from './model';
import { createStudioOrientationManager } from './studioOrientationManager';

const manager = createStudioOrientationManager(mode => ScreenOrientation.lockAsync(
  mode === 'landscape' ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
));

export function useStudioOrientation(kind: StudioKind | undefined, enabled = true) {
  const [orientationReady, setOrientationReady] = useState(false);
  const [orientationError, setOrientationError] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    const token = Symbol('studio-focus');
    setOrientationReady(false);
    setOrientationError(null);
    if (!enabled || !kind) return () => { active = false; };
    void manager.request(token, kind === 'aula' ? 'landscape' : 'portrait').then(() => {
      if (active) setOrientationReady(true);
    }).catch(() => {
      if (active) setOrientationError('Não foi possível ajustar a orientação. Confira a rotação do aparelho e tente abrir o Studio novamente.');
    });
    return () => {
      active = false;
      void manager.release(token).catch(() => undefined);
    };
  }, [kind, enabled]));
  return { orientationReady, orientationError };
}
