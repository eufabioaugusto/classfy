import { useCallback, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import type { StudioKind } from './model';
import { createStudioOrientationManager, studioOrientationMode, type StudioOrientationMode, type StudioPresentation } from './studioOrientationManager';
import { settleStudioOrientation } from './studioOrientationSettle';

const manager = createStudioOrientationManager(mode => ScreenOrientation.lockAsync(
  mode === 'landscape' ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
));
const orientationFailure = 'Não foi possível ajustar a tela. Tente novamente; seu projeto continua salvo.';
type OrientationScope = { kind: StudioKind | undefined; enabled: boolean; presentation: StudioPresentation };
type FocusSession = {
  token: symbol; scope: OrientationScope; active: boolean; foreground: boolean; epoch: number;
  baseMode?: StudioOrientationMode; controller?: AbortController; exitPromise?: Promise<boolean>;
  retryPromise?: Promise<boolean>;
};

function foreground() { return AppState.currentState === 'active' || AppState.currentState === 'inactive'; }
async function readInterfaceOrientation(observe?: (value: number) => void): Promise<StudioOrientationMode | undefined> {
  const value = await ScreenOrientation.getOrientationAsync();
  observe?.([0,1,2,3,4].includes(value) ? value : 0);
  if (value === ScreenOrientation.Orientation.PORTRAIT_UP) return 'portrait';
  if (value === ScreenOrientation.Orientation.LANDSCAPE_LEFT || value === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) return 'landscape';
  return undefined;
}

export function useStudioOrientation(kind: StudioKind | undefined, enabled = true, presentation: StudioPresentation = 'capture') {
  const scope = useMemo(() => ({ kind, enabled, presentation }), [kind, enabled, presentation]);
  const currentScope = useRef(scope); currentScope.current = scope;
  const session = useRef<FocusSession | null>(null);
  const [state, setState] = useState<{ scope: OrientationScope; ready: boolean; error: string | null }>({ scope, ready: false, error: null });

  const isCurrent = useCallback((target: FocusSession, epoch?: number) => session.current === target
    && currentScope.current === target.scope && target.active && target.foreground && foreground()
    && (epoch === undefined || target.epoch === epoch), []);
  const confirm = useCallback(async (target: FocusSession, mode: StudioOrientationMode, clearError: boolean, phase = 'entry') => {
    target.controller?.abort();
    const epoch = ++target.epoch, controller = new AbortController();
    target.controller = controller;
    let registered = false;
    const safeWindow = () => { const {width,height}=Dimensions.get('window'); return {width:Number.isFinite(width)?Math.round(width):0,height:Number.isFinite(height)?Math.round(height):0}; };
    const before = {interfaceOrientation:0,...safeWindow()}; let lastInterface=0,nativeFailure:Record<string,string>|undefined;
    void readInterfaceOrientation(value=>{before.interfaceOrientation=value;}).catch(()=>undefined);
    const safeCode = (value:unknown) => typeof value==='string'&&/^[\w.:-]{1,80}$/.test(value)?value:undefined;
    const currentRequest = () => isCurrent(target, epoch) && (!registered || manager.isCurrent(target.token, mode));
    if (isCurrent(target, epoch)) setState(previous => ({ scope: target.scope, ready: false, error: clearError ? null : previous.error }));
    const outcome = await settleStudioOrientation(mode, {
      request: async () => { registered = true; try { await manager.request(target.token, mode, { force: true }); }
        catch(cause){const error=cause as {name?:unknown;code?:unknown};nativeFailure={...(safeCode(error?.name)?{name:safeCode(error.name)!}:{}),...(safeCode(error?.code)?{code:safeCode(error.code)!}:{})};throw cause;} },
      read: () => readInterfaceOrientation(value=>{lastInterface=value;}),
      dimensions: () => Dimensions.get('window'),
      subscribe: changed => {
        const orientation = ScreenOrientation.addOrientationChangeListener(changed);
        let dimensions: ReturnType<typeof Dimensions.addEventListener>;
        try { dimensions = Dimensions.addEventListener('change', changed); }
        catch (error) { ScreenOrientation.removeOrientationChangeListener(orientation); throw error; }
        return () => { ScreenOrientation.removeOrientationChangeListener(orientation); dimensions.remove(); };
      },
      isCurrent: currentRequest,
    }, { signal: controller.signal });
    console.info('[Classfy Studio] Orientação', {phase,requestedMask:mode==='landscape'?'LANDSCAPE':'PORTRAIT_UP',outcome,before,after:{interfaceOrientation:lastInterface,...safeWindow()},...(nativeFailure?{failure:nativeFailure}:{})});
    if (currentRequest()) {
      if (outcome === 'ready') setState(previous => ({ scope: target.scope, ready: true, error: clearError ? null : previous.error }));
      else if (outcome !== 'cancelled') setState({ scope: target.scope, ready: false, error: orientationFailure });
    }
    if (target.controller === controller) target.controller = undefined;
    return { outcome, epoch };
  }, [isCurrent]);

  useFocusEffect(useCallback(() => {
    // Keep a focused session even on the permission/loading screen: Close must
    // still prepare portrait, without claiming an initial camera orientation.
    const target: FocusSession = { token: Symbol('studio-focus'), scope, active: true, foreground: foreground(), epoch: 0,
      baseMode: enabled && kind ? studioOrientationMode(kind, presentation) : undefined };
    session.current = target;
    setState({ scope, ready: false, error: null });
    if (target.foreground && target.baseMode) void confirm(target, target.baseMode, true);
    const subscription = AppState.addEventListener('change', next => {
      if (!target.active || session.current !== target || next === 'inactive') return;
      const active = next === 'active';
      if (target.foreground === active) return;
      target.foreground = active; target.epoch++;
      target.controller?.abort(); target.controller = undefined; target.exitPromise = undefined; target.retryPromise = undefined;
      setState({ scope, ready: false, error: null });
      if (!active) void manager.release(target.token).catch(() => undefined);
      else if (target.baseMode) void confirm(target, target.baseMode, true, 'foreground');
    });
    return () => {
      target.active = false; target.epoch++; target.controller?.abort(); target.controller = undefined;
      subscription.remove();
      if (session.current === target) { session.current = null; setState({ scope, ready: false, error: null }); }
      void manager.release(target.token).catch(() => undefined);
    };
  }, [scope, enabled, kind, presentation, confirm]));

  const retryOrientation = useCallback(():Promise<boolean> => {
    const target=session.current;if(!target?.baseMode||!isCurrent(target))return Promise.resolve(false);
    if(target.retryPromise)return target.retryPromise;
    const pending=confirm(target,target.baseMode,true,'retry').then(result=>result.outcome==='ready'&&isCurrent(target,result.epoch));target.retryPromise=pending;
    void pending.finally(()=>{if(target.retryPromise===pending)target.retryPromise=undefined;});return pending;
  },[confirm,isCurrent]);

  const prepareForExit = useCallback((): Promise<boolean> => {
    const target = session.current;
    if (!target || !isCurrent(target)) return Promise.resolve(false);
    if (target.exitPromise) return target.exitPromise;
    const pending = (async () => {
      const result = await confirm(target, 'portrait', true, 'exit');
      if (!isCurrent(target, result.epoch) || !manager.isCurrent(target.token, 'portrait')) return false;
      if (result.outcome === 'ready') return true;
      if (result.outcome !== 'cancelled' && target.baseMode) {
        // A failed exit keeps the capture recoverable; it must not resurrect a
        // blurred/background screen or wait forever before returning false.
        void confirm(target, target.baseMode, false, 'restore');
      } else if (!target.baseMode) void manager.release(target.token).catch(() => undefined);
      return false;
    })();
    target.exitPromise = pending;
    const clear = () => { if (target.exitPromise === pending) target.exitPromise = undefined; };
    void pending.then(clear, clear);
    return pending;
  }, [confirm, isCurrent]);
  return { orientationReady: state.scope === scope && !!session.current?.active && session.current.foreground && state.ready,
    orientationError: state.scope === scope ? state.error : null, retryOrientation, prepareForExit };
}
