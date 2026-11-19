import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import type { StudioVisualPatch } from '@/lib/studio/editor/commands';
import { StudioSelect } from './StudioSelect';

type Preset = { name: string; patch: StudioVisualPatch };
type Props = {
  owner: string;
  section: 'adjustment' | 'signature' | 'complete';
  current?: StudioVisualPatch;
  disabled?: boolean;
  onApply(patch: StudioVisualPatch): void;
  onApplyAll?(patch: StudioVisualPatch): void;
};

export function StudioTreatmentPresets({ owner, section, current, disabled, onApply, onApplyAll }: Props) {
  const key = `classfy-studio-treatment-v1:${owner}:${section}`;
  const [presets, setPresets] = useState<Preset[]>(() => {
    try {
      const entries: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
      return Array.isArray(entries) ? entries.filter(item => item && typeof item.name === 'string' && item.patch && typeof item.patch === 'object') : [];
    } catch { return []; }
  });
  const [chosen, setChosen] = useState('');
  const favorite = chosen === '' ? undefined : presets[Number(chosen)];
  const complete = section === 'complete';
  const [editing, setEditing] = useState<'create' | 'rename' | 'delete'>();
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const start = (action: 'create' | 'rename' | 'delete') => {
    setEditing(action);
    setName(action === 'rename' ? favorite?.name ?? '' : '');
    setNotice('');
  };
  const persist = (next: Preset[], selected: string, message: string) => {
    if (disabled) return;
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setPresets(next);
      setChosen(selected);
      setEditing(undefined);
      setName('');
      setNotice(message);
    } catch { setNotice('Não foi possível salvar a alteração neste navegador.'); }
  };
  const save = () => {
    const title = name.trim();
    const rename = editing === 'rename';
    if (!title || (rename ? !favorite : !current)) return;
    if (presets.some((preset, index) => (!rename || String(index) !== chosen) && preset.name.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setNotice('Já existe um favorito com esse nome.');
      return;
    }
    if (rename) {
      persist(presets.map((preset, index) => String(index) === chosen ? { ...preset, name: title } : preset), chosen, 'Favorito renomeado.');
    } else if (current) {
      persist([...presets, { name: title, patch: current }], String(presets.length), 'Favorito salvo.');
    }
  };
  const cancel = () => { setEditing(undefined); setNotice(''); };
  return <div className="se-treatment-presets">
    {presets.length > 0 && <StudioSelect label="Favoritos" accessibleLabel={complete ? 'Favoritos de visual completo' : section === 'adjustment' ? 'Favoritos de ajuste' : 'Favoritos de assinatura'}
      value={chosen} disabled={disabled || !!editing} options={[['', 'Escolher favorito'], ...presets.map(({ name }, index) => [String(index), name] as const)]}
      onChange={value => { setChosen(value); setNotice(''); }} />}
    {favorite && !editing && <div className="se-treatment-actions">
      {onApplyAll && <button type="button" className="se-inspector-apply" disabled={disabled}
        onClick={() => onApplyAll(favorite.patch)}>Aplicar a todos os takes</button>}
      <button type="button" className="se-text-button" disabled={disabled} onClick={() => onApply(favorite.patch)}>Aplicar à seleção</button>
      <div className="se-treatment-preset-name" role="group" aria-label="Gerenciar favorito">
        <button type="button" className="se-text-button" disabled={disabled || !current} onClick={() => {
          if (current) persist(presets.map((preset, index) => String(index) === chosen ? { ...preset, patch: current } : preset), chosen, 'Favorito atualizado.');
        }}>Atualizar com o visual atual</button>
        <button type="button" className="se-text-button" disabled={disabled} onClick={() => start('rename')}>Renomear</button>
        <button type="button" className="se-text-button" disabled={disabled} onClick={() => start('delete')}>Excluir</button>
      </div>
    </div>}
    {editing === 'delete' && favorite ? <div className="se-treatment-preset-name">
      <p>Excluir o favorito “{favorite.name}”?</p>
      <button type="button" className="se-inspector-apply" disabled={disabled}
        onClick={() => persist(presets.filter((_, index) => String(index) !== chosen), '', 'Favorito excluído.')}>Confirmar exclusão</button>
      <button type="button" className="se-text-button" onClick={cancel}>Cancelar</button>
    </div> : editing ? <div className="se-treatment-preset-name">
      <input type="text" aria-label="Nome do favorito" placeholder="Nome do favorito" value={name} maxLength={50}
        disabled={disabled} onChange={event => setName(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); save(); } }} />
      <button type="button" className="se-inspector-apply" disabled={disabled || !name.trim()} onClick={save}>Salvar</button>
      <button type="button" className="se-text-button" onClick={cancel}>Cancelar</button>
    </div> : <button type="button" className="se-text-button" disabled={disabled || !current} onClick={() => start('create')}>
      <Bookmark size={14} />{complete ? 'Salvar visual completo' : 'Salvar favorito'}
    </button>}
    {notice && <p className="se-muted" role="status">{notice}</p>}
  </div>;
}
