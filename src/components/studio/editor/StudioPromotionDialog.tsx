import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Clapperboard, Download, Sparkles, X } from 'lucide-react';
import { compileStudioRecipe, type StudioProject } from '../../../../shared/studio';
import { addCaptionTrack } from '@/lib/studio/editor/commands';
import { exportStudioRecipe, releaseStudioExport } from '@/lib/studio/editor/export';
import { createStudioPortraitDetector } from '@/lib/studio/editor/portraitClient';
import { getAsset } from '@/lib/studio/editor/storage';
import { transcribeStudioCaptions } from '@/lib/studio/editor/studioCaptions';
import { studioPromotionCues, studioPromotionRecipe, studioPromotionSubject, suggestStudioPromotionCuts, type StudioPromotionCut } from '@/lib/studio/editor/studioPromotionClips';
import { useStudioPromotionPublish } from '@/hooks/useStudioPromotionPublish';
import { toast } from 'sonner';
import '@/styles/studio-promotion.css';

export type StudioPromotionFile = StudioPromotionCut & { file: File; url: string };

function saveDownload(url: string, name: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
}
function disposeFiles(files: StudioPromotionFile[]) {
  for (const { file, url } of files) {
    URL.revokeObjectURL(url);
    void releaseStudioExport(file);
  }
}
type Props = {
  project: StudioProject;
  open: boolean;
  artwork?: string;
  range?: { start: number; end: number };
  onClose(): void;
};

export default function StudioPromotionDialog({ project, open, artwork, range, onClose }: Props) {
  const [files, setFiles] = useState<StudioPromotionFile[]>([]);
  const [progress, setProgress] = useState<number>();
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState('');
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [published, setPublished] = useState(false);
  const publishClips = useStudioPromotionPublish(project);
  const run = useRef<AbortController>();
  const completed = useRef<StudioPromotionFile[]>([]);
  useEffect(() => () => {
    run.current?.abort();
    disposeFiles(completed.current);
    completed.current = [];
  }, []);
  const generate = async () => {
    if (run.current || files.length) return;
    const work = new AbortController();
    run.current = work;
    const { signal } = work;
    const pending: StudioPromotionFile[] = [];
    const detector = createStudioPortraitDetector();
    setProgress(0); setError(''); setStage('Escolhendo trechos');
    const resolve = (id: string) => getAsset(project.ownerId, project.id, id);
    try {
      let recipe = compileStudioRecipe(project);
      let cues = studioPromotionCues(recipe);
      if (!cues.length) {
        cues = await transcribeStudioCaptions(project, resolve, '', signal, stage => setStage(stage));
        recipe = compileStudioRecipe(addCaptionTrack(project, cues, { visualEffect: 'shadow-strong' }));
      }
      const cuts = suggestStudioPromotionCuts(range ? cues.filter(cue => cue.start >= range.start && cue.end <= range.end) : cues);
      if (!cuts.length) throw new Error('Não encontramos um trecho de fala completo para gerar um corte.');
      setStage('Preparando o enquadramento vertical');
      const faceTimeout = AbortSignal.any([signal, AbortSignal.timeout(12_000)]);
      const canFrameSubject = await detector.prepare(faceTimeout).then(() => true, () => false);
      for (const [index, cut] of cuts.entries()) {
        setStage(`Preparando corte ${index + 1} de ${cuts.length}`);
        if (signal.aborted) return;
        const subject = canFrameSubject ? await studioPromotionSubject(recipe, cut, resolve, detector, signal) : .5;
        const file = await exportStudioRecipe(studioPromotionRecipe(recipe, cut, subject), resolve, {
          signal, name: `${project.title.slice(0, 80)} - corte ${index + 1}`,
          onProgress: value => { if (!signal.aborted) setProgress((index + value) / cuts.length); },
        });
        if (signal.aborted) { await releaseStudioExport(file); return; }
        pending.push({ ...cut, file, url: URL.createObjectURL(file) });
      }
      completed.current = pending;
      setFiles(pending);
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Não foi possível gerar os cortes.');
    } finally {
      detector.dispose();
      if (completed.current !== pending) disposeFiles(pending);
      if (run.current === work) run.current = undefined;
      setProgress(undefined);
    }
  };
  const downloadAll = async () => {
    setSaving(true); setError('');
    try {
      const { zip } = await import('fflate');
      const entries = Object.fromEntries(await Promise.all(files.map(async ({ file }) => [file.name, new Uint8Array(await file.arrayBuffer())])));
      const zipped = await new Promise<Uint8Array>((resolve, reject) => zip(entries, { level: 0 }, (error, bytes) => error ? reject(error) : resolve(bytes)));
      const blob = new Blob([new Uint8Array(zipped)], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      saveDownload(url, 'cortes-classfy.zip');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { setError('Não foi possível baixar todos os cortes juntos. Você pode baixar cada um pelo card.'); }
    finally { setSaving(false); }
  };
  const publish = async () => {
    if (saving || published) return;
    setSaving(true); setError(''); setPublishing('Preparando envio');
    try {
      await publishClips(files, setPublishing);
      setPublished(true);
      setConfirmPublish(false);
      toast.success('Cortes enviados para análise na Classfy.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível enviar os cortes.'); }
    finally { setSaving(false); setPublishing(''); }
  };
  const busy = progress !== undefined || saving;
  return <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="se-promotion-overlay" />
      <Dialog.Content className="se-promotion-dialog" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
        onPointerDownOutside={event => event.preventDefault()}>
        {!busy && <Dialog.Close className="se-promotion-close" aria-label="Fechar"><X size={20} /></Dialog.Close>}
        <Dialog.Title>{files.length ? 'Cortes prontos para divulgar' : 'Vamos gerar três cortes para divulgar?'}</Dialog.Title>
        <Dialog.Description>{files.length ? 'Confira a prévia de cada corte antes de divulgar.' : 'O Studio encontra trechos da sua edição e prepara vídeos verticais com legendas.'}</Dialog.Description>
        {!files.length && <div className={`se-promotion-art${progress !== undefined ? ' generating' : ''}`} aria-hidden="true">
          {artwork && <img src={artwork} alt="" />}
          <div className="se-promotion-wave" />
          <Clapperboard size={44} />
        </div>}
        {progress !== undefined && <div className="se-promotion-progress" role="status">
          <span>{stage}</span><span>{Math.round(progress * 100)}%</span>
          <progress aria-label={stage} max={1} value={progress} />
        </div>}
        {files.length > 0 && <div className="se-promotion-cards">{files.map(({ file, url, title, start, end }, index) =>
          <article key={file.name}>
            <video controls preload="metadata" playsInline src={url} aria-label={`Prévia do corte ${index + 1}`} />
            <strong>{title}</strong><span>{Math.round(end - start)} s</span>
            <button type="button" disabled={saving} onClick={() => saveDownload(url, file.name)}><Download size={15} /> Baixar corte</button>
          </article>
        )}</div>}
        {error && <p role="alert" className="se-promotion-error">{error}</p>}
        {publishing && <p role="status">{publishing}</p>}
        {published && <p role="status">Cortes enviados para análise na Classfy.</p>}
        {confirmPublish && !publishing && <p>Os cortes serão enviados como Shorts gratuitos para análise na Classfy.</p>}
        <footer>{progress !== undefined &&
          <button type="button" onClick={() => run.current?.abort()}>Cancelar geração</button>}
        {progress === undefined && <>
          {!files.length ? <>
            <button type="button" onClick={onClose}>Depois</button>
            <button type="button" className="se-promotion-primary" onClick={() => void generate()}><Sparkles size={17} /> Gerar cortes</button>
          </> : <>
            <button type="button" disabled={saving} onClick={() => void downloadAll()}><Download size={16} /> {files.length === 3 ? 'Baixar os três' : 'Baixar todos'}</button>
            {!published && (confirmPublish ? <>
              <button type="button" disabled={saving} onClick={() => setConfirmPublish(false)}>Voltar</button>
              <button type="button" className="se-promotion-primary" disabled={saving} onClick={() => void publish()}>Enviar para análise</button>
            </> : <button type="button" className="se-promotion-primary" disabled={saving} onClick={() => setConfirmPublish(true)}>{files.length === 3 ? 'Publicar os três' : 'Publicar todos'}</button>)}
          </>}
        </>}</footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
