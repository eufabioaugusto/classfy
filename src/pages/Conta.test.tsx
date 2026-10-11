import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const boundary = vi.hoisted(() => ({
  user: { id: 'owner-one', email: 'one@example.test' } as { id: string; email: string } | null,
  profiles: new Map<string, Record<string, unknown>>(),
  delayedProfile: null as Promise<unknown> | null,
  refresh: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: boundary.user, loading: false, role: 'user', profile: boundary.profiles.get(boundary.user?.id ?? ''), refreshProfile: boundary.refresh }) }));
vi.mock('@/components/billing/SubscriptionCheckoutProvider', () => ({ useSubscriptionCheckout: () => ({ startSubscription: vi.fn() }) }));
vi.mock('@/components/billing/SubscriptionBillingPanel', () => ({ SubscriptionBillingPanel: ({ ownerId, onViewPlan }: { ownerId: string; onViewPlan: () => void }) => <section aria-label="Cobranças da assinatura"><span>{ownerId}</span><button onClick={onViewPlan}>Ver meu plano</button></section> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    let owner = '';
    const result = () => table === 'profiles' ? { data: boundary.profiles.get(owner), error: null } : table === 'wallets' ? { data: { balance: 0, reserved_balance: 0, total_earned: 0, total_withdrawn: 0 }, error: null } : { data: null, error: null };
    const chain = {
      select: () => chain, eq: (_key: string, value: string) => { owner = value; return chain; },
      single: () => table === 'profiles' && owner === 'owner-one' && boundary.delayedProfile ? boundary.delayedProfile : Promise.resolve(result()),
      maybeSingle: () => Promise.resolve(result()), order: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  },
} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useProfileComplete', () => ({ useProfileComplete: vi.fn() }));
vi.mock('@/hooks/useCreatorMilestones', () => ({ useCreatorMilestones: () => ({ milestones: [], loading: false }) }));
vi.mock('@/components/layout', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>, PageHeader: ({ title, description }: { title: string; description: string }) => <header><h1>{title}</h1><p>{description}</p></header> }));
vi.mock('@/components/EditableAvatar', () => ({ EditableAvatar: () => <div aria-label="Foto de perfil" /> }));
vi.mock('@/components/CoverUpload', () => ({ CoverUpload: () => <div>Capa do canal</div> }));
vi.mock('@/components/BecomeCreatorModal', () => ({ BecomeCreatorModal: () => null }));
vi.mock('@/components/settings/MessagePrivacySettings', () => ({ MessagePrivacySettings: () => <section>Privacidade das mensagens</section> }));
vi.mock('@/components/rewards/UserAchievementsCard', () => ({ UserAchievementsCard: () => <section>Conquistas de aprendizado</section> }));

import Conta from './Conta';

let root: Root, host: HTMLDivElement;
function Harness() {
  const location = useLocation(), navigate = useNavigate();
  return <><output aria-label="Endereço">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>Voltar no histórico</button><button onClick={() => navigate(1)}>Avançar no histórico</button><Conta /></>;
}
async function render(url = '/conta') {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><Harness /></MemoryRouter>));
}
async function click(text: string) {
  const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label') === text || button.textContent?.trim() === text);
  expect(target, text).toBeTruthy();
  await act(async () => {
    if (target!.getAttribute('role') === 'tab') {
      target!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    } else target!.click();
  });
}
const selected = () => host.querySelector('[role="tab"][data-state="active"]')?.textContent;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  boundary.user = { id: 'owner-one', email: 'one@example.test' };
  boundary.profiles.clear();
  boundary.profiles.set('owner-one', { id: 'owner-one', display_name: 'Pessoa um', plan: 'free', creator_status: 'pending' });
  boundary.profiles.set('owner-two', { id: 'owner-two', display_name: 'Pessoa dois', plan: 'free', creator_status: 'pending' });
  boundary.delayedProfile = null;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });

describe('Conta: navegação e isolamento da identidade', () => {
  it('abre Cobranças diretamente e mantém Plano e Carteira separados', async () => {
    await render('/conta?tab=billing');
    expect(selected()).toContain('Cobranças');
    expect(host.querySelector('[aria-label="Cobranças da assinatura"]')?.textContent).toContain('owner-one');
    await click('Ver meu plano'); expect(selected()).toContain('Plano');
    expect(host.querySelector('[aria-label="Endereço"]')?.textContent).toBe('/conta?tab=plan');
    await click('Carteira'); expect(selected()).toContain('Carteira');
    expect(host.querySelector('[aria-label="Cobranças da assinatura"]')).toBeNull();
  });
  it('preserva parâmetros de retorno e restaura seções ao voltar e avançar', async () => {
    await render('/conta?tab=plano&billing_session_id=cs_fixture');
    expect(selected()).toContain('Plano');
    await click('Cobranças');
    expect(host.querySelector('[aria-label="Endereço"]')?.textContent).toContain('billing_session_id=cs_fixture');
    await click('Voltar no histórico'); expect(selected()).toContain('Plano');
    await click('Avançar no histórico'); expect(selected()).toContain('Cobranças');
  });
  it('uma resposta tardia do perfil anterior não substitui a conta atual', async () => {
    let resolve!: (value: unknown) => void;
    boundary.delayedProfile = new Promise(done => { resolve = done; });
    await render();
    boundary.user = { id: 'owner-two', email: 'two@example.test' };
    await render();
    expect(host.textContent).toContain('Pessoa dois');
    await act(async () => { resolve({ data: boundary.profiles.get('owner-one'), error: null }); });
    expect(host.textContent).toContain('Pessoa dois');
    expect(host.textContent).not.toContain('Pessoa um');
  });
});
