import { useEffect, useRef } from 'react';

type ExitDispatcher = { subscribers: Set<(event: PopStateEvent) => void> };
const dispatcherKey = Symbol.for('classfy.studio.exitGuard.v1');
function dispatcher(): ExitDispatcher | undefined {
  return (window as unknown as Record<symbol, ExitDispatcher | undefined>)[dispatcherKey];
}
/** Call before rendering BrowserRouter. Window POP is AT_TARGET in Chrome:
 * registration order, not the capture flag, decides which listener runs first.
 * The shared window entry also keeps Fast Refresh from adding dispatchers. */
export function initializeStudioExitGuard(): void {
  if (typeof window === 'undefined' || dispatcher()) return;
  const state: ExitDispatcher = { subscribers: new Set() };
  (window as unknown as Record<symbol, ExitDispatcher | undefined>)[dispatcherKey] = state;
  window.addEventListener('popstate', event => {
    for (const subscriber of [...state.subscribers].reverse()) {
      subscriber(event);
      if (event.cancelBubble) break;
    }
  });
}

/** BrowserRouter's installed history supplies idx. No synthetic history entries
 * are added and the global router/navigator are never replaced. */
function historyIndex(): number | null {
  const index: unknown = window.history.state?.idx;
  return typeof index === 'number' && Number.isSafeInteger(index) ? index : null;
}
export function useStudioExitGuard({ hasRisk, prepare, enabled }: {
  hasRisk(): boolean; prepare(): Promise<boolean>; enabled: boolean;
}) {
  const latest = useRef({ hasRisk, prepare }); latest.current = { hasRisk, prepare };
  useEffect(() => {
    if (!enabled) return;
    initializeStudioExitGuard();
    const subscriptions = dispatcher()!.subscribers;
    let current = historyIndex(), active = true, authorized = false;
    let pending: { target: number; ready: boolean; restored: boolean; cancelled: boolean } | null = null;
    const release = () => {
      if (!active || !pending?.ready || !pending.restored || current === null) return;
      const delta = pending.target - current;
      pending = null;
      if (!delta) return;
      authorized = true; window.history.go(delta);
    };
    const pop = (event: PopStateEvent) => {
      const index = historyIndex();
      if (current === null || index === null) { current = index; return; }
      if (authorized) { authorized = false; current = index; return; }
      if (pending) {
        event.stopImmediatePropagation();
        if (index === current) { pending.restored = true; if (pending.cancelled) pending = null; else release(); }
        else { pending.target = index; pending.restored = false; window.history.go(current - index); }
        return;
      }
      if (!latest.current.hasRisk() || index === current) { current = index; return; }
      event.stopImmediatePropagation();
      pending = { target: index, ready: false, restored: false, cancelled: false };
      window.history.go(current - index);
      // An exit waits for the actual write; cancellation leaves the editor and
      // its current history entry intact, without asking on a quiet exit.
      void latest.current.prepare().then(allow => {
        if (!active || !pending) return;
        if (allow) { pending.ready = true; release(); }
        else if (pending.restored) pending = null;
        else pending.cancelled = true; // Restoration must still consume its POP.
      }).catch(() => {
        if (!active || !pending) return;
        if (pending.restored) pending = null;
        else pending.cancelled = true;
      });
    };
    subscriptions.add(pop);
    return () => { active = false; subscriptions.delete(pop); };
  }, [enabled]);
}
