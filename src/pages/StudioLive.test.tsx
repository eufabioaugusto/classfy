import { StrictMode, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  user: { id: 'creator-test' },
  list: vi.fn(), invoke: vi.fn(), storage: vi.fn(), removeChannel: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: boundary.user, role: 'creator', loading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const query = { select: () => query, eq: () => query, order: () => query, limit: boundary.list };
    return query;
  },
  channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel; },
  removeChannel: boundary.removeChannel,
  functions: { invoke: boundary.invoke },
  storage: { from: boundary.storage },
} }));
vi.mock('@/components/layout', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
}));
vi.mock('@/components/templates', () => ({
  CreatorTemplate: ({ children, header, toolbar }: { children: ReactNode; header: ReactNode; toolbar: ReactNode }) => <>{header}{toolbar}{children}</>,
}));
vi.mock('@/components/studio/StudioNavigation', () => ({ StudioNavigation: () => <nav>Studio</nav> }));
vi.mock('@/components/CoverImageCropper', () => ({ CoverImageCropper: () => null }));
vi.mock('@/components/v2', () => ({
  V2Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  V2Button: ({ children, disabled, onClick }: { children?: ReactNode; disabled?: boolean; onClick?: () => void }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
  V2Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  V2CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  V2CardHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  V2ConfirmDialog: () => null,
}));

import StudioLive from './StudioLive';

let host: HTMLDivElement, root: Root;
function Screen() {
  const location = useLocation();
  return <><output aria-label="Rota atual">{location.pathname}{location.search}</output><StudioLive /></>;
}
async function mount(state?: unknown) {
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={[{ pathname: '/studio/live', state }]}><Screen /></MemoryRouter></StrictMode>));
}
const titleInput = () => host.querySelector<HTMLInputElement>('#live-title')!;
function expectOnlyPreparation() {
  expect(host.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/studio/live');
  expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Preparar live')?.disabled).toBe(true);
  expect(boundary.invoke).not.toHaveBeenCalled();
  expect(boundary.storage).not.toHaveBeenCalled();
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); boundary.list.mockResolvedValue({ data: [], error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('StudioLive: nome recebido da preparação', () => {
  it('preenche o título recebido sem criar sala, enviar capa ou iniciar transmissão', async () => {
    await mount({ studioRecordingTitle: '  Conversa com minha comunidade  ' });
    expect(titleInput().value).toBe('Conversa com minha comunidade');
    expect(titleInput().maxLength).toBe(150);
    expectOnlyPreparation();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(titleInput(), 'Título refinado');
      titleInput().dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(titleInput().value).toBe('Título refinado');
    expectOnlyPreparation();
  });

  it('respeita o limite da live quando recebe um nome mais longo de outro formato', async () => {
    await mount({ studioRecordingTitle: 'A'.repeat(160) });
    expect(titleInput().value).toBe('A'.repeat(150));
    expectOnlyPreparation();
  });

  it.each([undefined, { studioRecordingTitle: null }, { studioRecordingTitle: 42 }])('mantém o formulário vazio ao abrir diretamente ou sem nome válido (%j)', async state => {
    await mount(state);
    expect(titleInput().value).toBe('');
    expectOnlyPreparation();
  });
});
