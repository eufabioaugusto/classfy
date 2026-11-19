import { useMediaUpload } from '@/hooks/useMediaUpload';
import { supabase } from '@/integrations/supabase/client';
import { publicationDraftService, type StandalonePublicationDraft } from '@/lib/studio/publication';
import { dataURLtoFile, seekAndCaptureCover } from '@/components/video-lobby/seekAndCapture';
import type { StudioPromotionFile } from '@/components/studio/editor/StudioPromotionDialog';
import type { StudioProject } from '../../shared/studio';

async function coverFile(url: string, duration: number) {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        video.onloadeddata = video.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const timeout = window.setTimeout(() => finish(new Error('Tempo limite ao preparar a capa.')), 15000);
      video.onloadeddata = () => finish();
      video.onerror = () => finish(new Error('Não foi possível abrir o corte para gerar a capa.'));
      video.src = url;
    });
    const frame = await seekAndCaptureCover(video, Math.min(2, duration / 4), 540, 960, { x: 50, y: 50 }, .9);
    return dataURLtoFile(frame, 'capa.jpg');
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

async function mediaStatus(id: string) {
  const { data, error } = await supabase.from('media_assets').select('status').eq('id', id).maybeSingle();
  if (error) throw new Error('A conexão com o processamento de vídeo foi interrompida. Tente novamente.');
  return data?.status;
}

export function useStudioPromotionPublish(project: StudioProject) {
  const { upload } = useMediaUpload();
  return async (files: StudioPromotionFile[], onStage: (status: string) => void) => {
    const ownerId = project.ownerId;
    const submit = async () => {
      for (const [index, clip] of files.entries()) {
        const draftKey = `short:promotion:${project.id}:${project.revision}:${clip.start}:${clip.end}`;
        onStage(`Enviando corte ${index + 1} de ${files.length}`);
        const { data: existing, error: readError } = await supabase.from('publication_drafts')
          .select('id,state,payload').eq('owner_id', ownerId).eq('draft_key', draftKey).maybeSingle();
        if (readError) throw new Error('Não foi possível conferir os envios anteriores. Tente novamente.');
        if (existing?.state === 'submitted') continue;
        let payload = existing?.state === 'draft' && existing.payload
          ? existing.payload as unknown as StandalonePublicationDraft : undefined;
        if (!payload?.thumbnailUrl) {
          const duration = clip.end - clip.start;
          const cover = await coverFile(clip.url, duration);
          const storage = supabase.storage.from('contents');
          const path = `thumbnails/${ownerId}/${crypto.randomUUID()}.jpg`;
          const { error } = await storage.upload(path, cover);
          if (error) throw new Error('Não foi possível enviar a capa do corte.');
          payload = {
            title: clip.title, description: `Trecho de ${project.title}`, tags: project.tags,
            visibility: 'free', price: '', discount: '', duration: Math.ceil(duration),
            fileName: clip.file.name, fileUrl: '', thumbnailUrl: storage.getPublicUrl(path).data.publicUrl,
            mediaAssetId: null, videoProvider: null, uploadState: 'idle',
          };
        }
        const save = async (value: StandalonePublicationDraft) => {
          const { remote, record } = await publicationDraftService.save({ ownerId, kind: 'short', draftKey, payload: value });
          if (!remote) throw new Error('Não foi possível salvar o rascunho do corte. Tente novamente.');
          return record.id;
        };
        const draftId = existing?.state === 'draft' && existing.id || await save(payload);
        let status = payload.mediaAssetId && await mediaStatus(payload.mediaAssetId);
        if (!status || ['failed', 'deleted', 'missing'].includes(status)) {
          const result = await upload({ file: clip.file, title: payload.title, mediaType: 'video', draftId, slotKey: 'short:primary' });
          payload = { ...payload, fileUrl: result.fileUrl, mediaAssetId: result.mediaAssetId, videoProvider: result.provider, uploadState: 'processing' };
          await save(payload);
        }
        onStage(`Aguardando processamento do corte ${index + 1} de ${files.length}`);
        const deadline = Date.now() + 180_000;
        while (status !== 'ready') {
          status = await mediaStatus(payload.mediaAssetId!);
          if (status === 'ready') break;
          if (status === 'failed' || status === 'deleted' || status === 'missing')
            throw new Error('O processamento de um corte falhou. Os envios concluídos foram mantidos.');
          if (Date.now() >= deadline) throw new Error('O vídeo ainda está sendo processado. Tente novamente para continuar de onde parou.');
          await new Promise(resolve => setTimeout(resolve, 2500));
        }
        await save({ ...payload, uploadState: 'ready' });
        const { error } = await supabase.rpc('submit_standalone_publication', { p_draft_id: draftId });
        if (error) throw new Error('Não foi possível enviar um corte para análise. Tente novamente para continuar.');
      }
    };
    const lock = `classfy:studio:promotion:${ownerId}:${project.id}:${project.revision}`;
    if (navigator.locks) await navigator.locks.request(lock, submit);
    else await submit();
  };
}
