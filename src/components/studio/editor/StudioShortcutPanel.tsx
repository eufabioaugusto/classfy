import { useState } from 'react';
import { StudioToolbarPopover } from './StudioToolbarPopover';
import { Keyboard, Search, X } from 'lucide-react';
import { studioShortcuts, studioShortcutLabel, type StudioShortcut } from './studioShortcuts';

const normalized = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export function StudioShortcutPanel({ open, onOpen, onAction, disabled }: {
  open: boolean; disabled?: boolean; onOpen(open: boolean): void; onAction(command: StudioShortcut): void;
}) {
  const [query, setQuery] = useState('');
  const changeOpen = (value: boolean) => { setQuery(''); onOpen(value); };
  const close = () => changeOpen(false);
  const aliases: Partial<Record<StudioShortcut, string>> = { search: '?', loop: 'mod+shift+l', similar: 'alt+shift+a', remove: 'delete' };
  const display = (command: StudioShortcut, keys: string) => [studioShortcutLabel(keys), aliases[command] && studioShortcutLabel(aliases[command])].filter(Boolean).join(' / ');
  const rows = studioShortcuts.filter(([command, name, keys]) => normalized(name + ' ' + display(command, keys)).includes(normalized(query)));
  return <StudioToolbarPopover label="Atalhos da montagem" icon={<Keyboard size={18} />} className="se-shortcut-panel" open={open} onOpenChange={changeOpen} disabled={disabled}>
      <header><h2 id="se-shortcut-title">Atalhos de teclado</h2><button className="se-icon" aria-label="Fechar atalhos" onClick={close}><X size={16} /></button></header>
      <label className="se-shortcut-search"><Search size={16} /><input autoFocus aria-label="Pesquisar ferramentas e atalhos" placeholder="Pesquisar ações ou teclas" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div className="se-shortcut-results">
        {rows.map(([command, name, keys]) => <button key={command} onClick={() => { close(); onAction(command); }}>
          <span>{name}</span><kbd>{display(command, keys)}</kbd>
        </button>)}
        {!rows.length && <p>Nenhuma ação encontrada.</p>}
      </div>
  </StudioToolbarPopover>;
}
