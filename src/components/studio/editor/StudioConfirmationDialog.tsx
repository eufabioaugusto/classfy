import { useEffect, useRef, useState } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LogOut, Trash2, TriangleAlert } from 'lucide-react';
import '@/styles/studio-dialog.css';

export type StudioConfirmationOptions = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'accent';
  icon?: 'delete' | 'exit' | 'discard';
};

export function StudioConfirmationDialog({ options, trigger, onResolve }: {
  options: StudioConfirmationOptions | null;
  trigger: HTMLElement | null;
  onResolve(approved: boolean): void;
}) {
  const [container, setContainer] = useState<Element | null>(document.fullscreenElement);
  const restoreFocus = useRef(trigger); if (trigger) restoreFocus.current = trigger;
  useEffect(() => {
    const update = () => setContainer(document.fullscreenElement);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const Icon = options?.icon === 'exit' ? LogOut : options?.icon === 'discard' ? TriangleAlert : Trash2;
  return <AlertDialog.Root open={!!options} onOpenChange={open => { if (!open) onResolve(false); }}>
    <AlertDialog.Portal container={container ?? undefined}>
      <AlertDialog.Overlay className="se-confirmation-overlay" />
      <AlertDialog.Content className="se-confirmation" data-tone={options?.tone ?? 'danger'} onKeyDownCapture={event => {
        // Cancel immediately from the focused content, even before Radix's
        // document-level layer effect has registered a newly opened dialog.
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onResolve(false); }
      }} onCloseAutoFocus={event => {
        const element = restoreFocus.current;
        if (element?.isConnected) { event.preventDefault(); element.focus({ preventScroll: true }); }
      }}>
        <div className="se-confirmation-icon" aria-hidden="true"><Icon size={23} strokeWidth={1.7} /></div>
        <AlertDialog.Title className="se-confirmation-title">{options?.title}</AlertDialog.Title>
        <AlertDialog.Description className="se-confirmation-description">{options?.description}</AlertDialog.Description>
        <div className="se-confirmation-actions">
          <AlertDialog.Cancel className="se-confirmation-cancel" onClick={() => onResolve(false)}>{options?.cancelLabel ?? 'Cancelar'}</AlertDialog.Cancel>
          <AlertDialog.Action className="se-confirmation-accept" onClick={() => onResolve(true)}>{options?.confirmLabel}</AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
