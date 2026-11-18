import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export function StudioToolbarPopover({ label, icon, children, disabled, open: controlled, onOpenChange, className, triggerClassName }: {
  label: string; icon: ReactNode; children: ReactNode; disabled?: boolean; open?: boolean;
  onOpenChange?(open: boolean): void; className?: string; triggerClassName?: string;
}) {
  const [visible, setVisible] = useState(false);
  const open = controlled ?? visible;
  const setOpen = onOpenChange ?? setVisible;
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, setOpen]);

  return <div className="se-toolbar-anchor" ref={root} onKeyDown={event => {
    if (open && event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} className={`se-icon ${triggerClassName ?? ''}`} type="button" aria-label={label} title={label}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={() => setOpen(!open)}>{icon}</button>
    {open && !disabled && <section id={id} className={`se-toolbar-popover ${className ?? ''}`} role="dialog" aria-label={label}>{children}</section>}
  </div>;
}
