import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Film, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { createStudioRemoteSceneStore, recoverStudioRemoteScene, type StudioRemoteSceneRecovery } from '@/lib/studio/editor/remoteSceneRecovery';

function download(file: File, name: string) { const url = URL.createObjectURL(file), anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10_000); }
/** Account-scoped recovery remains available after the Premium entitlement expires. */
export type StudioRemoteSceneRecoveredSource = { takeId: string; kind: 'aula' | 'short'; projectId: string | null; title: string };
export function StudioRemoteSceneRecoveryList({ owner, onRecoveredFile }: { owner: string; onRecoveredFile(file: File, source?: StudioRemoteSceneRecoveredSource): Promise<void> }) {
  const [entries, setEntries] = useState<StudioRemoteSceneRecovery[]>([]), [busy, setBusy] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const current = useRef(owner), lifecycle = useRef<AbortController | null>(null); current.current = owner;
  const refresh = useCallback(async () => { if (!globalThis.indexedDB) { setEntries([]); return; } try { const values = await createStudioRemoteSceneStore().list(owner); if (current.current === owner) setEntries(values); } catch (cause) { if (current.current === owner) setError(cause instanceof Error ? cause.message : 'Não foi possível acessar os originais.'); } }, [owner]);
  useEffect(() => { setEntries([]); setAdded([]); setError(null); void refresh(); return () => lifecycle.current?.abort(); }, [refresh]);
  const recover = async (entry: StudioRemoteSceneRecovery) => {
    const controller = new AbortController(); lifecycle.current = controller; setBusy(entry.key); setError(null);
    try { const file = await recoverStudioRemoteScene(owner, entry.key, { signal: controller.signal }); if (current.current !== owner || controller.signal.aborted) return;
      const saved = await createStudioRemoteSceneStore().get(owner, entry.key); if (current.current !== owner || controller.signal.aborted) return;
      const source = saved?.takeId && saved.session ? { takeId: saved.takeId, kind: saved.session.kind, projectId: saved.session.projectId, title: saved.session.title } : undefined;
      await onRecoveredFile(file, source);
      if (current.current === owner) setAdded(values => [...values, entry.key]);
    }
    catch (cause) { if (current.current === owner && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Os originais continuam preservados. Tente novamente.'); }
    finally { if (current.current === owner) { setBusy(null); await refresh(); } }
  };
  if (!entries.length && !error) return null;
  return <section className="src-recovery-list" aria-label="Originais das gravações com iPhone">
    <span className="src-eyebrow"><ShieldCheck size={13} /> SEUS ORIGINAIS PRESERVADOS</span>
    <h3>Continue de onde parou.</h3><p>Receba o original do iPhone e monte suas cenas sem gravar outra vez. Tela e câmera também podem ser baixadas separadamente.</p>
    {entries.map(entry => <article key={entry.key} style={{ borderTop: '1px solid rgba(255,255,255,.12)', padding: '16px 0' }}>
      <strong><Film size={15} /> {entry.title || 'Gravação com iPhone'}</strong>
      <p>{new Date(entry.createdAt).toLocaleDateString('pt-BR')} · {entry.output.width} × {entry.output.height} · {entry.output.frameRate} FPS</p>
      {entry.error && <p className="src-error">{entry.error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="src-secondary" disabled={!!busy || added.includes(entry.key)} onClick={() => void recover(entry)}>{busy === entry.key ? <Loader2 size={14} className="se-spin" /> : <RefreshCw size={14} />}{added.includes(entry.key) ? 'Take adicionado' : entry.outputFile ? 'Adicionar take pronto' : 'Receber e montar take'}</button>
        {entry.cameraFile && <button type="button" className="src-secondary" onClick={() => download(entry.cameraFile!, entry.cameraFile!.name || (entry.cameraFile!.type.includes('quicktime') ? 'iPhone original Classfy.mov' : 'iPhone original Classfy.mp4'))}><Download size={14} />Câmera original</button>}
        {entry.screenFile && <button type="button" className="src-secondary" onClick={() => download(entry.screenFile!, entry.screenFile!.name || 'Tela original Classfy.webm')}><Download size={14} />Tela original</button>}
      </div>
    </article>)}
    {error && <p role="alert" className="src-error">{error}</p>}
  </section>;
}
