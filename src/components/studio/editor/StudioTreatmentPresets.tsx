import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import type { StudioVisualPatch } from '@/lib/studio/editor/commands';
import { StudioSelect } from './StudioSelect';

type Preset = { name: string; patch: StudioVisualPatch };
type Props = {
  owner: string;
  section: 'adjustment' | 'signature';
  current?: StudioVisualPatch;
  disabled?: boolean;
  onApply(patch: StudioVisualPatch): void;
};

export function StudioTreatmentPresets({ owner, section, current, disabled, onApply }: Props) {
  const key = `classfy-studio-treatment-v1:${owner}:${section}`;
  const [presets, setPresets] = useState<Preset[]>(() => {
    try {
      const entries: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(entries) ? entries.filter(item => item && typeof item.name === 'string' && item.patch && typeof item.patch === 'object') : [];
    } catch { return []; }
  });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const save = () => {
    if (!current || !name.trim()) return;
    const title = name.trim();
    const next = [...presets, { name: title, patch: current }];
    if (presets.some(preset => preset.name.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setNotice('Já existe um favorito com esse nome.');
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setPresets(next);
      setEditing(false);
      setName('');
      setNotice('Favorito salvo.');
    } catch { setNotice('Não foi possível salvar o favorito neste navegador.'); }
  };
  return <div className="se-treatment-presets">
    {presets.length > 0 && <StudioSelect label="Favoritos" accessibleLabel={section === 'adjustment' ? 'Favoritos de ajuste' : 'Favoritos de assinatura'}
      value="" disabled={disabled} options={[['', 'Escolher favorito'], ...presets.map(({ name }, index) => [String(index), name] as const)]}
      onChange={value => { if (value) onApply(presets[+value].patch); }} />}
    {editing ? <div className="se-treatment-preset-name">
      <input type="text" aria-label="Nome do favorito" placeholder="Nome do favorito" value={name} maxLength={50}
        disabled={disabled} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} />
      <button type="button" className="se-inspector-apply" disabled={disabled || !name.trim()} onClick={save}>Salvar</button>
      <button type="button" className="se-text-button" onClick={() => { setEditing(false); setNotice(''); }}>Cancelar</button>
    </div> : <button type="button" className="se-text-button" disabled={disabled || !current} onClick={() => { setNotice(''); setEditing(true); }}>
      <Bookmark size={14} />Salvar favorito
    </button>}
    {notice && <p className="se-muted" role="status">{notice}</p>}
  </div>;
}
