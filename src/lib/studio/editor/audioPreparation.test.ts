import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resumeStudioCaptureAudio } from './audioPreparation';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const audio = (resume: () => Promise<void>) => ({ resume, close: vi.fn() }) as unknown as AudioContext;
it('retomada confirmada remove deadline e checa sessão antes/depois da operação', async () => {
  const assert = vi.fn(), context = audio(vi.fn(async () => {})); await resumeStudioCaptureAudio(context, assert);
  expect(assert).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0); expect(context.close).not.toHaveBeenCalled();
});
it('política de autoplay não deixa preparo pendente para sempre', async () => {
  const context = audio(() => new Promise(() => {})), preparing = resumeStudioCaptureAudio(context), rejected = expect(preparing).rejects.toThrow('não ativou o áudio');
  await vi.advanceTimersByTimeAsync(8000); await rejected; expect(vi.getTimerCount()).toBe(0);
});
it('rejeição de resume cancela timer sem ocultar causa do navegador', async () => {
  const context = audio(async () => { throw new DOMException('Contexto encerrado', 'InvalidStateError'); }); await expect(resumeStudioCaptureAudio(context)).rejects.toMatchObject({ name: 'InvalidStateError' }); expect(vi.getTimerCount()).toBe(0);
});
it('resume tardio de sessão cancelada não instala áudio nem retém deadline', async () => {
  let complete!: () => void, cancelled = false; const pending = new Promise<void>(resolve => { complete = resolve; });
  const request = resumeStudioCaptureAudio(audio(() => pending), () => { if (cancelled) throw new DOMException('Captura cancelada', 'AbortError'); }), rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  cancelled = true; complete(); await rejected; expect(vi.getTimerCount()).toBe(0);
});
