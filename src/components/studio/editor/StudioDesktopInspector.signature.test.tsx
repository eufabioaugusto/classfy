import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compileStudioRecipe, emptyStudioEditing, studioTicks, withStudioTakes, type StudioSignature } from '../../../../shared/studio';
import { StudioDesktopInspector } from './StudioDesktopInspector';

let host: HTMLDivElement, root: Root;
const signature: StudioSignature = { version: 1, strength: .85, backgroundBlur: .28, backgroundExposure: -1.25, subjectExposure: .45, temperature: .18 };
const editing = emptyStudioEditing('aula');
editing.assets = [{ id: 'asset', kind: 'image', uri: 'file:///original.jpg', name: 'Original', width: 3840, height: 2160, durationTicks: 0 }];
editing.main = [{ id: 'clip', assetId: 'asset', sourceStartTicks: 0, sourceEndTicks: 0, durationTicks: studioTicks(2), signature, portrait: { version: 1, strength: .4 } }];
const clip = compileStudioRecipe(withStudioTakes({ id: 'test', ownerId: 'owner', version: 2, kind: 'aula', title: '', description: '', objective: '', audience: '', script: '', tags: [], visibility: 'free', price: '0', editing, revision: 0, state: 'draft', progress: 0, createdAt: '', updatedAt: '' })).clips[0];
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount() {
  const draft = vi.fn(), commit = vi.fn();
  await act(async () => root.render(<StudioDesktopInspector clip={clip} canSplit={false} outputHeight={2160} onDraft={draft} onCommit={commit} onRemove={() => undefined} onDuplicate={() => undefined} onSplit={() => undefined} />));
  return { draft, commit };
}
async function move(label: string, value: number) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('pointerup', { bubbles: true }));
  });
}
describe('controles independentes da assinatura e retoque intenso', () => {
  it('cada slider altera só seu parâmetro, conserva cor e confirma a interação', async () => {
    const { draft, commit } = await mount();
    const moves = [['Intensidade da assinatura', 'strength', 1], ['Suavidade do fundo', 'backgroundBlur', .8], ['Luz do fundo', 'backgroundExposure', -.5], ['Luz no rosto', 'subjectExposure', .9]] as const;
    for (const [label, key, value] of moves) {
      await move(label, value);
      expect(draft.mock.lastCall?.[0]).toEqual({ signature: { ...signature, [key]: value } });
    }
    expect(commit).toHaveBeenCalledTimes(4);
    expect(host.querySelector('input[aria-label="Luz do fundo"]')!.closest('label')!.textContent).toContain('-1.25 EV');
    expect(host.querySelector('input[aria-label="Luz no rosto"]')!.closest('label')!.textContent).toContain('+0.45 EV');
    expect(clip.signature).toEqual(signature);
  });
  it('ajuste intencional do retoque atualiza v1 para v2 sem alterar a assinatura', async () => {
    const { draft } = await mount();
    expect(draft).not.toHaveBeenCalled();
    await move('Suavização do rosto', 1);
    expect(draft.mock.lastCall?.[0]).toEqual({ portrait: { version: 2, strength: 1 } });
    expect(clip.portrait).toEqual({ version: 1, strength: .4 });
    expect(clip.signature).toEqual(signature);
  });
});
