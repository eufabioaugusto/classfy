import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyNotes } from './StudyNotes';
const { insert, single } = vi.hoisted(() => ({ insert: vi.fn(), single: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [], error: null }).then(resolve), single };
  insert.mockReturnValue(query);
  return { ...query, insert };
} } }));
afterEach(() => vi.clearAllMocks());
describe('StudyNotes', () => {
  it.each([false, true])('salva nota com timestamp e preserva texto em falha=%s', async (fails) => {
    single.mockResolvedValue(fails ? { error: new Error('offline') } : { data: { id: 'note-1', note_text: 'Minha ideia', timestamp_seconds: 42, created_at: '2026-09-28T00:00:00Z' }, error: null });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    try {
      await act(async () => root.render(createElement(StudyNotes, { studyId: 'unused', activeContentId: 'content-1', currentTime: 42.8 })));
      const textarea = container.querySelector('textarea')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Minha ideia');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const button = Array.from(container.querySelectorAll('button')).find(el => el.textContent === 'Salvar anotação')!;
      await act(async () => button.click());
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ content_id: 'content-1', study_id: null, user_id: 'user-1', note_text: 'Minha ideia', timestamp_seconds: 42 }));
      expect(textarea.value).toBe(fails ? 'Minha ideia' : '');
      if (!fails) expect(container.textContent).toContain('Minha ideia');
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });
});
