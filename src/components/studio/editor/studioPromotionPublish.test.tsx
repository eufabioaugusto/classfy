import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useStudioPromotionPublish } from '@/hooks/useStudioPromotionPublish';
import type { StandalonePublicationDraft } from '@/lib/studio/publication';
import type { StudioProject } from '../../../../shared/studio';
import type { StudioPromotionFile } from './StudioPromotionDialog';

const services = vi.hoisted(() => ({
  lookup: vi.fn(), submit: vi.fn(), save: vi.fn(), upload: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: services.lookup, rpc: services.submit } }));
vi.mock('@/lib/studio/publication', () => ({ publicationDraftService: { save: services.save } }));
vi.mock('@/hooks/useMediaUpload', () => ({ useMediaUpload: () => ({ upload: services.upload }) }));

it('retoma o envio em lote sem recriar uploads ou submeter novamente cortes já enviados', async () => {
  const project = { id: 'project', ownerId: 'owner', revision: 2 } as StudioProject;
  const files: StudioPromotionFile[] = [0, 16, 32].map(start => ({
    start, end: start + 16, title: `Corte ${start}`, url: 'blob:cut',
    file: new File(['mp4'], `corte-${start}.mp4`, { type: 'video/mp4' }),
  }));
  const ids = new Map(files.map(file => [`short:promotion:project:2:${file.start}:${file.end}`, String(file.start)]));
  const drafts = new Map(files.map(file => [String(file.start), {
    id: String(file.start), state: 'draft',
    payload: { thumbnailUrl: 'https://example.test/cover.jpg', mediaAssetId: `m-${file.start}`, uploadState: 'processing' },
  }]));
  services.lookup.mockImplementation((table: string) => {
    let key = '';
    const query = {
      select: () => query,
      eq: (name: string, value: string) => {
        if (name === 'draft_key') key = value;
        return query;
      },
      maybeSingle: async () => ({ data: table === 'media_assets' ? { status: 'ready' } : drafts.get(ids.get(key)!) }),
    };
    return query;
  });
  services.save.mockImplementation(async ({ draftKey, payload }: { draftKey: string; payload: StandalonePublicationDraft }) => {
    const draft = drafts.get(ids.get(draftKey)!)!;
    draft.payload = { ...draft.payload, ...payload };
    return { remote: true, record: { id: draft.id } };
  });
  let failed = false;
  services.submit.mockImplementation(async (_name: string, { p_draft_id }: { p_draft_id: string }) => {
    if (p_draft_id === '16' && !failed) {
      failed = true;
      return { error: { message: 'Falha temporária' } };
    }
    drafts.get(p_draft_id)!.state = 'submitted';
    return { data: { submissionId: p_draft_id } };
  });

  let publish!: ReturnType<typeof useStudioPromotionPublish>;
  function Harness() { publish = useStudioPromotionPublish(project); return null; }
  const previous = globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await expect(publish(files, vi.fn())).rejects.toThrow('enviar um corte para análise');
    await expect(publish(files, vi.fn())).resolves.toBeUndefined();
    expect(services.submit.mock.calls.map(call => call[1].p_draft_id)).toEqual(['0', '16', '16', '32']);
    expect(services.upload).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous;
  }
});
