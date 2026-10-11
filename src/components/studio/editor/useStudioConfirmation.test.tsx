import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStudioConfirmation } from './useStudioConfirmation';

let root: Root, host: HTMLDivElement, api: ReturnType<typeof useStudioConfirmation>;
const options = { title: 'Excluir take 1?', description: 'Este take será removido da montagem.', confirmLabel: 'Excluir take' };
function Harness({ scope = 'owner/project' }: { scope?: string }) {
  api = useStudioConfirmation(scope);
  return <><button onClick={() => void api.confirm(options)}>Solicitar</button><button>Outro controle</button>{api.dialog}</>;
}
async function render(scope = 'owner/project') { await act(async () => root.render(<StrictMode><Harness scope={scope} /></StrictMode>)); }
async function settle() { await act(async () => new Promise(resolve => setTimeout(resolve, 5))); }
async function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(element => element.textContent === label)!;
  expect(button, label).toBeTruthy(); await act(async () => button.click()); await settle();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.spyOn(window, 'confirm').mockImplementation(() => { throw new Error('Confirmação nativa proibida'); });
  vi.spyOn(window, 'alert').mockImplementation(() => { throw new Error('Alerta nativo proibido'); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

describe('decisões do Studio com diálogo real e cancelamento por escopo', () => {
  it('só abre após solicitação, liga título/descrição e foca Cancelar', async () => {
    await render(); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await click('Solicitar'); const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)?.textContent).toBe(options.title);
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe(options.description);
    expect(document.activeElement?.textContent).toBe('Cancelar'); expect(api.pending).toBe(true);
    await click('Cancelar'); expect(api.pending).toBe(false); expect(window.confirm).not.toHaveBeenCalled(); expect(window.alert).not.toHaveBeenCalled();
  });

  it('Escape cancela, confirma somente pelo botão explícito e devolve foco ao solicitante', async () => {
    await render(); const trigger = host.querySelector('button')!; trigger.focus(); let first!: Promise<boolean>;
    await act(async () => { first = api.confirm(options); });
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); await settle();
    expect(await first).toBe(false); expect(document.activeElement).toBe(trigger);
    let second!: Promise<boolean>; await act(async () => { second = api.confirm(options); }); await click('Excluir take');
    expect(await second).toBe(true); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('rejeita perguntas simultâneas sem aprovar duas ações pela mesma escolha', async () => {
    await render(); let first!: Promise<boolean>, second!: Promise<boolean>;
    await act(async () => { first = api.confirm(options); second = api.confirm({ ...options, title: 'Excluir take 2?' }); });
    expect(await second).toBe(false); expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Excluir take 1?');
    await click('Excluir take'); expect(await first).toBe(true);
  });

  it('Escape no botão focado cancela a saída sem autorizar a ação destrutiva', async () => {
    await render(); const trigger = host.querySelector('button')!; trigger.focus(); let decision!: Promise<boolean>;
    await act(async () => { decision = api.confirm({ ...options, title: 'Descartar e sair?', cancelLabel: 'Continuar gravando' }); });
    const focused = document.activeElement!; expect(focused.textContent).toBe('Continuar gravando');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => focused.dispatchEvent(event)); await settle();
    expect(await decision).toBe(false); expect(event.defaultPrevented).toBe(true);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger);
  });

  it('mudança de owner/projeto cancela a pergunta anterior e não autoriza uma ação na nova sessão', async () => {
    await render(); let old!: Promise<boolean>; await act(async () => { old = api.confirm(options); });
    const oldButton = [...document.querySelectorAll('button')].find(element => element.textContent === 'Excluir take')!;
    await render('other-owner/other-project'); expect(await old).toBe(false); expect(api.pending).toBe(false);
    let next!: Promise<boolean>; await act(async () => { next = api.confirm({ ...options, title: 'Excluir projeto novo?' }); });
    await act(async () => oldButton.click()); expect(api.pending).toBe(true);
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Excluir projeto novo?');
    await click('Cancelar'); expect(await next).toBe(false);
  });

  it('unmount encerra a espera como cancelada sem executar confirmação', async () => {
    await render(); let pending!: Promise<boolean>; await act(async () => { pending = api.confirm(options); });
    await act(async () => root.render(null)); expect(await pending).toBe(false); expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('mantém o diálogo dentro do fullscreen e o transporta ao sair sem resolver a decisão', async () => {
    const previous = Object.getOwnPropertyDescriptor(document, 'fullscreenElement'); let fullscreen: Element | null = host;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreen });
    try {
      await render(); let pending!: Promise<boolean>; await act(async () => { pending = api.confirm(options); });
      expect(host.querySelector('[role="alertdialog"]')).toBeTruthy(); fullscreen = null;
      await act(async () => document.dispatchEvent(new Event('fullscreenchange')));
      expect(host.querySelector('[role="alertdialog"]')).toBeNull(); expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
      expect(api.pending).toBe(true); await click('Excluir take'); expect(await pending).toBe(true);
    } finally { if (previous) Object.defineProperty(document, 'fullscreenElement', previous); else Reflect.deleteProperty(document, 'fullscreenElement'); }
  });
});
