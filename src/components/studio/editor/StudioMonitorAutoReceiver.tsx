import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { createStudioMonitorAutoReceiver } from '@/lib/studio/editor/cameraMonitorAutoReceiver';
import { createStudioCameraMonitorViewer } from '@/lib/studio/editor/cameraMonitorViewer';
import { useStudioPremiumEntitlement } from './useStudioPremiumEntitlement';
import { StudioMonitorWorkspace } from './StudioMonitorWorkspace';

/** Internal dependency seams are for owned fixtures, never query-string gates. */
export function StudioMonitorAutoLayer({ owner, manual = false, createReceiver = createStudioMonitorAutoReceiver, createViewer = createStudioCameraMonitorViewer }: {
  owner: string; manual?: boolean; createReceiver?: typeof createStudioMonitorAutoReceiver; createViewer?: typeof createStudioCameraMonitorViewer;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null), [portal, setPortal] = useState<HTMLElement>(() => document.fullscreenElement as HTMLElement ?? document.body);
  const receiver = useRef<ReturnType<typeof createStudioMonitorAutoReceiver> | null>(null), overlay = useRef<HTMLDivElement>(null);
  const manualRef = useRef(manual); manualRef.current = manual;
  useEffect(() => {
    const controller = createReceiver({ owner, manual: manualRef.current, onOpen: monitor => setSessionId(monitor.id), onClose: () => setSessionId(null) }); receiver.current = controller;
    controller.start();
    const signal = () => controller.signal();
    const fullscreen = () => { const target = document.fullscreenElement as HTMLElement | null; if (target && overlay.current?.contains(target)) return; setPortal(target ?? document.body); };
    const storage = (event: StorageEvent) => {
      if (!event.key?.startsWith(`classfy:studio:monitor:auto:v1:${owner}:`)) return;
      controller.coordinationChanged();
      if (event.newValue === null && (event.key.endsWith(':lease') || event.key.includes(':manual:'))) signal();
    };
    window.addEventListener('storage', storage); window.addEventListener('focus', signal); document.addEventListener('visibilitychange', signal); document.addEventListener('fullscreenchange', fullscreen);
    return () => { if (receiver.current === controller) receiver.current = null; controller.dispose(); window.removeEventListener('storage', storage); window.removeEventListener('focus', signal); document.removeEventListener('visibilitychange', signal); document.removeEventListener('fullscreenchange', fullscreen); };
  }, [owner, createReceiver]);
  useEffect(() => { receiver.current?.setManual(manual); }, [manual]);
  useEffect(() => {
    if (!sessionId) return;
    const previousFocus = document.activeElement as HTMLElement | null, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; overlay.current?.querySelector<HTMLButtonElement>('[aria-label="Fechar monitor"]')?.focus();
    const keyboard = (event: KeyboardEvent) => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); receiver.current?.dismiss(); return; }
      if (event.key !== 'Tab') return;
      const buttons = [...overlay.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keyboard, true); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [sessionId]);
  return sessionId && !manual ? createPortal(<div className="scm-auto-overlay" ref={overlay} role="dialog" aria-modal="true" aria-label="Monitor do iPhone"><StudioMonitorWorkspace key={`${owner}:${sessionId}`} owner={owner} sessionId={sessionId} createViewer={createViewer} onClose={() => receiver.current?.dismiss()} /></div>, portal) : null;
}
export function StudioMonitorAutoReceiver() {
  const { user, role, loading } = useAuth(), isMobile = useIsMobile(), location = useLocation();
  const [desktop, setDesktop] = useState(false), [confirmedOwner, setConfirmedOwner] = useState<string | null>(null);
  const eligible = !loading && !!user && (role === 'creator' || role === 'admin');
  const entitlement = useStudioPremiumEntitlement(eligible && desktop && !isMobile ? user.id : null);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)'), size = window.matchMedia('(min-width: 768px)');
    const sync = () => setDesktop(size.matches && !coarse.matches); sync();
    size.addEventListener('change', sync); coarse.addEventListener('change', sync);
    return () => { size.removeEventListener('change', sync); coarse.removeEventListener('change', sync); };
  }, []);
  useEffect(() => {
    if (!eligible || !desktop || isMobile) setConfirmedOwner(null);
    else if (!entitlement.loading) setConfirmedOwner(entitlement.canUseScenes ? user.id : null);
  }, [eligible, desktop, isMobile, entitlement.loading, entitlement.canUseScenes, user?.id]);
  // A same-owner refresh keeps a confirmed viewer; denial/logout removes it.
  if (!eligible || !desktop || isMobile || !user || confirmedOwner !== user.id || !entitlement.loading && !entitlement.canUseScenes) return null;
  return <StudioMonitorAutoLayer key={user.id} owner={user.id} manual={/^\/studio\/monitor\/?$/.test(location.pathname)} />;
}
