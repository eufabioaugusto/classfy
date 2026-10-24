import { useEffect, useRef, useState } from 'react';
import { Check, Download, Film, FolderInput, Loader2, MoreHorizontal, Smartphone } from 'lucide-react';
import { formatStudioDuration } from '../../../../shared/studio';
import type { StudioRemoteLocalTakeView, StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';

type ThumbnailGetter = (takeId: string, sessionId: string) => Promise<string | null>;
function OriginalThumbnail({ owner, take, index, saved, getThumbnail }: { owner: string; take: StudioRemoteLocalTakeView; index: number; saved: boolean; getThumbnail?: ThumbnailGetter }) {
  const thumbnail = take.thumbnail;
  const valid = !!thumbnail && thumbnail.version === 1 && typeof thumbnail.hash === 'string' && /^[a-f0-9]{64}$/.test(thumbnail.hash) && thumbnail.mime === 'image/jpeg' && Number.isSafeInteger(thumbnail.bytes) && thumbnail.bytes > 0 && thumbnail.bytes <= 16384 && [thumbnail.width, thumbnail.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 320);
  const identity = JSON.stringify([owner, take.sessionId, take.id, valid ? thumbnail.hash : null, saved]);
  const getter = useRef(getThumbnail); getter.current = getThumbnail;
  const enabled = !!getThumbnail && !!take.sessionId && (valid || saved);
  const [loaded, setLoaded] = useState<{ key: string; url: string | null }>({ key: '', url: null });
  const [reload, setReload] = useState(0), request = useRef({ identity, retried: false });
  if (request.current.identity !== identity) request.current = { identity, retried: false };
  useEffect(() => {
    let current = true, ownedURL: string | null = null;
    const release = (url: string | null) => { if (url?.startsWith('blob:')) URL.revokeObjectURL(url); };
    if (enabled) void getter.current!(take.id, take.sessionId!).then(url => {
      if (!current) { release(url); return; } ownedURL = url; setLoaded({ key: identity, url });
    }, () => { if (current) setLoaded({ key: identity, url: null }); });
    return () => { current = false; release(ownedURL); };
  }, [identity, enabled, take.id, take.sessionId, reload]);
  const url = enabled && loaded.key === identity ? loaded.url : null;
  return <div className="se-recording-phone-take-thumb">
    {url ? <img key={`${identity}:${reload}`} src={url} alt={`Miniatura do take ${index + 1}`} loading="lazy" onError={() => {
      if (request.current.identity !== identity) return;
      setLoaded(value => value.key === identity ? { ...value, url: null } : value);
      // A lazy image may enter the viewport after its private URL has expired.
      if (!request.current.retried) { request.current.retried = true; setReload(value => value + 1); }
    }} /> : <Film size={24} aria-label="Miniatura indisponível" />}
    {take.metadata && <span className="se-recording-phone-take-duration">{formatStudioDuration(take.metadata.duration)}</span>}
  </div>;
}
function OriginalImportMenu({ label, disabled, onImport }: { label: string; disabled: boolean; onImport(): void }) {
  const [open, setOpen] = useState(false), container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="se-recording-phone-take-menu" ref={container}>
    <button type="button" ref={trigger} className="se-recording-phone-take-more" aria-label={`Mais opções do ${label}`} aria-expanded={open} aria-haspopup="menu" disabled={disabled} onClick={() => setOpen(value => !value)}><MoreHorizontal size={16} /></button>
    {open && <div ref={panel} role="menu" aria-label={`Opções do ${label}`}><button type="button" role="menuitem" aria-label={`Importar original recebido do ${label}`} onClick={() => { setOpen(false); trigger.current?.focus(); onImport(); }}><FolderInput size={14} /><span>Importar arquivo recebido<small>AirDrop ou arquivo do computador</small></span></button></div>}
  </div>;
}

/** One receive gesture transfers, links the project and downloads the requested file. */
export function StudioRemoteLocalTakes({ owner, state, savedIds, savingId, disabled, recording, onDownload, onImport, getThumbnail }: {
  owner: string; state: StudioRemoteView; savedIds: Set<string>; savingId?: string | null; disabled: boolean; recording: boolean;
  onDownload(id: string): void; onImport(id?: string): void; getThumbnail?: ThumbnailGetter;
}) {
  const takes = state.localTakes?.filter(take => take.localSaved || ['uploaded', 'uploading', 'failed', 'local_ready'].includes(take.phase)) ?? [];
  const active = !['idle', 'complete', 'retry'].includes(state.transfer);
  return <section className="se-recording-phone-takes" aria-label="Originais do iPhone">
    <header><div><Smartphone size={16} /><strong>Originais do iPhone</strong><span>{takes.length}</span></div><button type="button" className="se-recording-phone-import" aria-label="Importar original recebido" disabled={disabled || !!savingId} onClick={() => onImport()}><FolderInput size={13} />Importar arquivo</button></header>
    {!takes.length && <p>Seus takes aparecem aqui depois de gravar. Já recebeu um arquivo do iPhone? Importe para continuar.</p>}
    {!!takes.length && <div className="se-recording-phone-takes-list">{takes.map((take, index) => {
      const sending = state.transferTakeId === take.id && active, saving = savingId === take.id, saved = savedIds.has(take.id);
      const archived = !!take.sessionId && !!state.session && take.sessionId !== state.session.id && take.phase !== 'uploaded';
      const progress = sending && state.transferTotalBytes && Number.isFinite(state.transferBytes) ? Math.max(0, Math.min(100, Math.floor(state.transferBytes! / state.transferTotalBytes * 100))) : null;
      const status = saved ? 'No projeto' : saving ? 'Adicionando ao projeto…' : sending ? state.transfer === 'downloading' ? 'Baixando para o computador…' : state.transfer === 'validating' ? 'Conferindo original…' : state.transfer === 'uploading' ? 'Enviando do iPhone…' : 'Preparando transferência…' : archived ? 'No iPhone · conexão anterior' : take.phase === 'uploaded' ? 'Pronto para baixar' : take.phase === 'uploading' ? 'Transferência no iPhone…' : take.phase === 'preparing' ? 'Preparando no iPhone…' : 'No iPhone';
      const error = state.transferTakeId === take.id && state.transfer === 'retry' && state.error ? state.error : take.error;
      const blocked = disabled || !!savingId || !saved && !archived && (active || recording && take.phase !== 'uploaded');
      const busy = sending || saving;
      return <article key={`${owner}:${take.id}`} aria-label={`Take ${index + 1}`} aria-busy={busy}>
        <OriginalThumbnail owner={owner} take={take} index={index} saved={saved} getThumbnail={getThumbnail} />
        <div className="se-recording-phone-take-content"><div className="se-recording-phone-take-heading"><strong>Take {index + 1}</strong><OriginalImportMenu label={`take ${index + 1}`} disabled={disabled || !!savingId} onImport={() => onImport(take.id)} /></div>
          <small className={saved ? 'is-saved' : ''} title={status}>{saved && <Check size={11} />}{status}{progress !== null ? ` ${progress}%` : ''}</small>
          {busy && <progress aria-label={`Transferência do take ${index + 1}`} max={100} value={progress ?? undefined} />}
          {error && !saved && <small className="se-recording-phone-take-error" role="alert" title={error}>{error}</small>}
          <button type="button" className="se-recording-phone-take-download" aria-label={`${archived && !saved ? 'Adicionar arquivo do' : 'Baixar'} take ${index + 1}`} disabled={blocked} onClick={() => archived && !saved ? onImport(take.id) : onDownload(take.id)}>{busy ? <Loader2 size={13} className="se-spin" /> : archived && !saved ? <FolderInput size={13} /> : <Download size={13} />}{archived && !saved ? 'Adicionar arquivo' : saving || state.transfer === 'validating' && sending ? 'Salvando…' : sending ? 'Transferindo…' : 'Baixar'}</button>
        </div>
      </article>;
    })}</div>}
    {recording && <small>Os arquivos em transferência continuam enquanto você grava.</small>}
  </section>;
}
