import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Check, Copy, Film, Loader2, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { createProject, deleteProject, duplicateProject, getAsset, listProjects, saveProject } from '@/lib/studio/editor/storage';
import { formatStudioDuration, timelineDuration, withStudioTakes, type StudioKind, type StudioProject } from '../../../../shared/studio';
import '@/styles/studio-editor.css';

export function StudioProjectThumbnail({ owner, project }: { owner: string; project: StudioProject }) {
  const [url, setUrl] = useState<string>();
  const asset = project.editing?.assets.find(a => a.id === project.editing?.main[0]?.assetId);
  useEffect(() => {
    let active = true, objectURL: string | undefined;
    setUrl(undefined);
    if (asset) getAsset(owner, project.id, `${asset.id}:thumbnail`).then(blob => {
      if (!blob || !active) return;
      objectURL = URL.createObjectURL(blob); setUrl(objectURL);
    }).catch(() => undefined);
    return () => { active = false; if (objectURL) URL.revokeObjectURL(objectURL); };
  }, [owner, project.id, asset?.id]);
  return url ? <img src={url} alt="" /> : <div className="se-project-placeholder"><Film size={30} strokeWidth={1} /></div>;
}

export function StudioProjectsWorkspace({ owner }: { owner: string }) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(''), [order, setOrder] = useState<'recent' | 'old'>('recent');
  const [creating, setCreating] = useState(false), [format, setFormat] = useState<StudioKind>('aula');
  const [selected, setSelected] = useState<StudioProject | null>(null), [action, setAction] = useState<'options' | 'rename' | 'delete'>('options');
  const [name, setName] = useState('');
  const generation = useRef(0), reservation = useRef(false), hold = useRef<ReturnType<typeof setTimeout>>(), didHold = useRef(false);
  const refresh = async (token: number) => { const list = await listProjects(owner); if (token === generation.current) setProjects(list); };
  useEffect(() => {
    const token = ++generation.current; setLoading(true); setProjects([]); setSelected(null); setCreating(false); setError(null); reservation.current = false;
    refresh(token).catch(cause => { if (generation.current === token) setError(cause.message); }).finally(() => { if (generation.current === token) setLoading(false); });
    return () => { ++generation.current; clearTimeout(hold.current); };
  }, [owner]);
  const execute = async (task: (token: number) => Promise<void>) => {
    if (reservation.current) return;
    reservation.current = true; const token = generation.current; setBusy(true); setError(null);
    try { await task(token); } catch (cause) { if (token === generation.current) setError(cause instanceof Error ? cause.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { if (token === generation.current) { reservation.current = false; setBusy(false); } }
  };
  const options = (project: StudioProject) => { if (reservation.current) return; setSelected(project); setName(project.title); setAction('options'); };
  const visible = projects.filter(p => p.title.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
    .sort((a, b) => (order === 'recent' ? -1 : 1) * a.updatedAt.localeCompare(b.updatedAt));
  return <div className="se-projects">
    <header className="se-projects-header"><div><button className="se-icon" aria-label="Voltar ao Studio" onClick={() => navigate('/studio')}><ArrowLeft size={19} /></button><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" /><span>Studio</span><span className="se-header-divider" /><strong>Projetos</strong></div>
      <button className="se-button se-primary" disabled={busy} onClick={() => { setCreating(true); setName(''); }}><Plus size={17} /> Novo projeto</button></header>
    <main className="se-projects-main"><div className="se-projects-heading"><div><h1>Seus projetos</h1><p>Salvos neste navegador</p></div><div className="se-projects-filters"><label className="se-search"><Search size={17} /><input aria-label="Buscar projetos" placeholder="Buscar projetos" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Ordenar projetos" value={order} onChange={e => setOrder(e.target.value as typeof order)}><option value="recent">Mais recentes</option><option value="old">Mais antigos</option></select></div></div>
      {error && <div className="se-error" role="alert">{error}<button onClick={() => void execute(async token => refresh(token))}>Tentar novamente</button></div>}
      {loading ? <div className="se-project-grid">{Array.from({ length: 4 }, (_, i) => <div className="se-project-skeleton" key={i} />)}</div> : <div className="se-project-grid">{visible.map(project => <article className="se-project-card" key={project.id}>
        <button className="se-project-cover" disabled={busy} onContextMenu={e => { e.preventDefault(); options(project); }} onPointerDown={e => { if (e.button !== 0) return; didHold.current = false; clearTimeout(hold.current); hold.current = setTimeout(() => { didHold.current = true; options(project); }, 450); }} onPointerUp={() => clearTimeout(hold.current)} onPointerCancel={() => clearTimeout(hold.current)} onPointerLeave={() => clearTimeout(hold.current)} onClick={() => { if (didHold.current) { didHold.current = false; return; } navigate(`/studio/projects/${project.id}`); }} aria-label={`Editar ${project.title}`}>
          <StudioProjectThumbnail owner={owner} project={project} /><span className="se-project-kind">{project.kind === 'aula' ? 'Aula' : project.kind === 'short' ? 'Short' : 'Podcast'}</span><span className="se-project-duration">{formatStudioDuration(timelineDuration(project.takes))}</span><span className="se-project-open"><ArrowUpRight size={22} /></span>
        </button><div className="se-project-caption"><div><h2>{project.title}</h2><p>Em edição · {new Date(project.updatedAt).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}</p></div><button className="se-icon" disabled={busy} aria-label={`Opções de ${project.title}`} onClick={() => options(project)}><MoreHorizontal size={20} /></button></div>
      </article>)}</div>}
      {!loading && !visible.length && <div className="se-empty"><Film size={40} strokeWidth={1} /><h2>{query ? 'Nenhum projeto encontrado' : 'Sua próxima aula começa aqui'}</h2><p>{query ? 'Experimente outro nome.' : 'Importe seus arquivos ou grave direto no Studio.'}</p>{!query && <button className="se-button se-primary" onClick={() => setCreating(true)}>Criar projeto</button>}</div>}
    </main>
    {(creating || selected) && <div className="se-modal-backdrop" onClick={() => { if (!busy) { setCreating(false); setSelected(null); } }}><section className="se-modal" role="dialog" aria-modal="true" aria-label={creating ? 'Novo projeto' : 'Opções do projeto'} onClick={e => e.stopPropagation()}><header><h2>{creating ? 'Novo projeto' : action === 'rename' ? 'Renomear projeto' : action === 'delete' ? 'Excluir projeto?' : selected?.title}</h2><button className="se-icon" disabled={busy} aria-label="Fechar opções" onClick={() => { setCreating(false); setSelected(null); }}><X size={18} /></button></header>
      {creating ? <><div className="se-format-grid">{(['aula', 'short', 'podcast'] as const).map(kind => <button key={kind} className={format === kind ? 'selected' : ''} onClick={() => setFormat(kind)}><Film size={22} /><strong>{kind === 'aula' ? 'Aula' : kind === 'short' ? 'Short' : 'Podcast'}</strong><span>{kind === 'aula' ? '16:9' : kind === 'short' ? '9:16' : 'Áudio'}</span></button>)}</div><label className="se-field">Nome<input value={name} placeholder="Título do projeto" maxLength={160} onChange={e => setName(e.target.value)} /></label><button className="se-button se-primary se-wide" disabled={busy} onClick={() => void execute(async token => { const project = await createProject(owner, format, name.trim() || undefined); if (token === generation.current) navigate(`/studio/projects/${project.id}`); })}>{busy ? <Loader2 size={16} className="se-spin" /> : <Plus size={16} />} Criar e editar</button></> : selected && action === 'options' ? <div className="se-project-options"><div className="se-options-thumb"><StudioProjectThumbnail owner={owner} project={selected} /></div><button className="se-button" onClick={() => { setAction('rename'); setName(selected.title); }}>Renomear</button><button className="se-button" disabled={busy} onClick={() => void execute(async token => { await duplicateProject(owner, selected.id); await refresh(token); if (token === generation.current) setSelected(null); })}><Copy size={16} />Duplicar projeto</button><button className="se-button se-danger" onClick={() => setAction('delete')}><Trash2 size={16} />Excluir</button></div> : selected && action === 'rename' ? <><label className="se-field">Nome<input autoFocus value={name} maxLength={160} onChange={e => setName(e.target.value)} /></label><button className="se-button se-primary se-wide" disabled={busy || !name.trim()} onClick={() => void execute(async token => { await saveProject(owner, withStudioTakes({ ...selected, editing: selected.editing!, title: name.trim() })); await refresh(token); if (token === generation.current) setSelected(null); })}><Check size={16} />Salvar nome</button></> : selected && <><p className="se-muted">A montagem e os arquivos locais deste projeto serão removidos deste navegador. Publicações enviadas continuam preservadas.</p><div className="se-modal-actions"><button className="se-button" disabled={busy} onClick={() => setAction('options')}>Cancelar</button><button className="se-button se-danger" disabled={busy} onClick={() => void execute(async token => { await deleteProject(owner, selected.id); await refresh(token); if (token === generation.current) setSelected(null); })}>Excluir projeto</button></div></>}
      {busy && <p className="se-muted" role="status">Concluindo…</p>}
    </section></div>}
  </div>;
}
