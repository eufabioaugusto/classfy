import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Search, Upload } from 'lucide-react';
import { listFonts, type StudioFontRecord } from '@/lib/studio/editor/storage';
import { importStudioFont, loadStudioCustomFont, studioBrowserFont, studioSystemFonts } from '@/lib/studio/editor/studioFonts';

type Props = { owner: string; value: string; disabled?: boolean; onChange(family: string): void };

export function StudioFontPicker({ owner, value, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [fonts, setFonts] = useState<StudioFontRecord[]>([]);
  const [query, setQuery] = useState('');
  const [importedOnly, setImportedOnly] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const name = fonts.find(font => font.family === value)?.name ?? (value === 'System' ? 'Sistema' : value.startsWith('StudioFont-') ? 'Fonte importada' : value);

  useEffect(() => {
    if (!owner || !open && !value.startsWith('StudioFont-')) return;
    let active = true;
    void listFonts(owner).then(async records => {
      await Promise.allSettled(records.map(font => loadStudioCustomFont(font.family)));
      if (active) setFonts(records);
    }).catch(() => { if (active) setError('Não foi possível abrir as fontes importadas.'); });
    return () => { active = false; };
  }, [owner, open, value]);

  const importFile = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const font = await importStudioFont(owner, file);
      setFonts(current => [...current, font]);
      setQuery('');
      setImportedOnly(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível importar a fonte.');
    } finally {
      setBusy(false);
    }
  };

  const options = [
    ...(importedOnly ? [] : studioSystemFonts.map(family => ({ family, name: family === 'System' ? 'Sistema' : family }))),
    ...fonts,
  ].filter(font => font.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  return <div className="se-field">
    <span>Fonte</span>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="se-select-trigger se-font-trigger" disabled={disabled} aria-label={`Fonte do texto: ${name}`}>
        <span style={{ fontFamily: studioBrowserFont(value) }}>{name}</span><ChevronDown size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="se-font-menu" aria-label="Biblioteca de fontes" align="start" sideOffset={7} collisionPadding={12}>
          <label className="se-font-search"><Search size={15} /><input type="search" aria-label="Pesquisar fontes" placeholder="Pesquisar fontes" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <div className="se-inspector-segments se-font-filters" role="group" aria-label="Filtrar fontes">
            <button type="button" aria-pressed={!importedOnly} onClick={() => setImportedOnly(false)}>Todas</button>
            <button type="button" aria-pressed={importedOnly} onClick={() => setImportedOnly(true)}>Importadas</button>
          </div>
          <div className="se-font-options">
            {options.map(font => <button key={font.family} type="button" aria-pressed={value === font.family} disabled={disabled} onClick={() => { onChange(font.family); setOpen(false); }}>
              <span style={{ fontFamily: studioBrowserFont(font.family) }}>{font.name}</span>{value === font.family && <Check size={15} />}
            </button>)}
            {!options.length && <p>{query ? 'Nenhuma fonte encontrada.' : 'Nenhuma fonte importada.'}</p>}
          </div>
          {error && <p className="se-font-message" role="alert">{error}</p>}
          <div className="se-font-footer">
            <input hidden ref={fileInput} type="file" accept=".ttf,.otf,.woff,.woff2" onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }} />
            <button type="button" disabled={busy || disabled} onClick={() => fileInput.current?.click()}><Upload size={14} />{busy ? 'Importando…' : 'Importar fonte'}</button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
