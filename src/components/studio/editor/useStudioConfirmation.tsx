import { useCallback, useEffect, useRef, useState } from 'react';
import { StudioConfirmationDialog, type StudioConfirmationOptions } from './StudioConfirmationDialog';

type Request = {
  options: StudioConfirmationOptions;
  scope: string;
  trigger: HTMLElement | null;
  resolve(approved: boolean): void;
};

/** One question per owner/workspace. Teardown cancels the promise; callers must
 * also revalidate the operation after await, as capture and storage keep running. */
export function useStudioConfirmation(scopeKey: string) {
  const [request, setRequest] = useState<Request | null>(null);
  const current = useRef<Request | null>(null), mounted = useRef(false), scope = useRef(scopeKey);
  scope.current = scopeKey;
  const finish = useCallback((approved: boolean, render = true) => {
    const owned = current.current; if (!owned) return;
    current.current = null;
    if (render && mounted.current) setRequest(null);
    owned.resolve(approved && owned.scope === scope.current && mounted.current);
  }, []);
  useEffect(() => {
    mounted.current = true; setRequest(null);
    return () => { mounted.current = false; finish(false, false); };
  }, [scopeKey, finish]);
  const confirm = useCallback((options: StudioConfirmationOptions): Promise<boolean> => {
    if (!mounted.current || current.current) return Promise.resolve(false);
    return new Promise(resolve => {
      const owned: Request = { options, scope: scope.current, trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null, resolve };
      current.current = owned; setRequest(owned);
    });
  }, []);
  const cancel = useCallback(() => finish(false), [finish]);
  const visible = request?.scope === scopeKey ? request : null;
  return {
    confirm, cancel, pending: !!visible,
    dialog: <StudioConfirmationDialog options={visible?.options ?? null} trigger={visible?.trigger ?? null} onResolve={approved => {
      if (visible && current.current === visible) finish(approved);
    }} />,
  };
}
