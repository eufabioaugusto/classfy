import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudyQuiz } from './StudyQuiz';
const { invoke, insert } = vi.hoisted(() => ({ invoke: vi.fn(), insert: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke }, from: () => ({ insert }) } }));
vi.mock('@/lib/personalization/interests', () => ({ registerDifficulty: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => vi.clearAllMocks());
describe('StudyQuiz', () => {
  it('usa o estudo real e registra cada resposta e acerto uma única vez', async () => {
    invoke.mockResolvedValue({ data: { id: 'quiz-1', questions: [
      { question: 'Primeira?', options: ['Sim', 'Não'], correctAnswer: 0, explanation: 'Primeira explicação', difficulty: 'easy' },
      { question: 'Segunda?', options: ['Certo', 'Errado'], correctAnswer: 0, explanation: 'Segunda explicação', difficulty: 'easy' },
    ] } });
    insert.mockResolvedValue({ error: null });
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const click = async (text: string) => {
      const target = Array.from(container.querySelectorAll('button, label')).find(el => el.textContent?.trim() === text);
      expect(target, text).toBeTruthy();
      await act(async () => (target as HTMLElement).click());
    };
    try {
      await act(async () => root.render(createElement(StudyQuiz, { studyId: 'study-real', contentId: 'content-1', contentTitle: 'Aula' })));
      await click('Gerar Quiz');
      expect(invoke).toHaveBeenCalledWith('generate-quiz', { body: { studyId: 'study-real', contentId: 'content-1' } });
      await click('Sim'); await click('Confirmar Resposta'); await click('Próxima Questão');
      await click('Certo'); await click('Confirmar Resposta'); await click('Ver Resultado');
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ score: 2, max_score: 2, answers: [0, 0] }));
      expect(container.textContent).toContain('2/2');
      expect(container.textContent).toContain('100%');
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
  });
});
