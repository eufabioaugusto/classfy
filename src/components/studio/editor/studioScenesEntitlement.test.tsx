import { StrictMode, act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioPremiumProfile } from '@/lib/studio/editor/entitlementPremium';
const io = vi.hoisted(() => ({ owner: 'creator', role: 'creator', rows: new Map<string, unknown>(), query: null as null | ((owner: string) => Promise<unknown>), selects: vi.fn(), invoke: vi.fn(), open: vi.fn(), checkout: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: io.owner }, access_token: 'fixture-session' } }, error: null }), getUser: async () => ({ data: { user: { id: io.owner } }, error: null }) },
  functions: { invoke: io.invoke },
  from: () => ({ select: () => ({ eq: (_column: string, owner: string) => ({ abortSignal: () => ({ single: () => { io.selects(owner); return io.query ? io.query(owner) : Promise.resolve({ data: io.rows.get(owner), error: null }); } }) }) }) }),
} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: io.owner }, role: io.role, loading: false, profile: { plan: 'premium', plan_expires_at: null } }) }));
// The shared provider owns payment/session identity; its real component suite
// covers Stripe and stale acknowledgements. Here the handoff is the boundary.
vi.mock('@/components/billing/SubscriptionCheckoutProvider', () => ({ useSubscriptionCheckout: () => ({ startSubscription: io.checkout }) }));
// The page test exercises the entitlement/offer boundary. Recording and file
// persistence are owned by the workspace suite; this host starts no devices.
vi.mock('./StudioRecordingWorkspace', () => ({ StudioRecordingWorkspace: (props: { owner: string; canUseScenes?: boolean; onUpgradeScenes?: () => void; onUpgradeRemote?: () => void }) => <div><output aria-label="Acesso a cenas">{props.canUseScenes ? 'liberado' : 'bloqueado'}</output><button onClick={() => { if (!props.canUseScenes) props.onUpgradeScenes?.(); }}>Gravação com cenas</button><button onClick={() => { if (!props.canUseScenes) props.onUpgradeRemote?.(); }}>Usar meu iPhone</button><button>Gravação básica</button></div> }));
import { useStudioPremiumEntitlement } from './useStudioPremiumEntitlement';
import { StudioScenesUpgradeDialog } from './StudioScenesUpgradeDialog';
import StudioRecord from '@/pages/StudioRecord';
import { PLAN_OFFERS } from '@/config/planOffers';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const profile = (owner = 'creator', patch: Partial<StudioPremiumProfile> = {}): StudioPremiumProfile => ({ id: owner, plan: 'premium', plan_expires_at: '2026-11-11T12:00:00Z', entitlement_source: 'stripe', subscription_status: 'active', subscription_grace_until: null, stripe_subscription_id: 'sub-fixture', ...patch });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
let root: Root, host: HTMLDivElement, access: ReturnType<typeof useStudioPremiumEntitlement>;
function HookHarness({ owner = io.owner, offer = false }: { owner?: string; offer?: boolean }) {
  access = useStudioPremiumEntitlement(owner); const [open, setOpen] = useState(false);
  return <><output>{access.canUseScenes ? 'liberado' : 'bloqueado'}</output><button onClick={() => void access.refresh()}>Recarregar</button><button onClick={() => void access.refresh(true)}>Verificar</button><button onClick={() => setOpen(true)}>Solicitar cenas</button>{offer && <StudioScenesUpgradeDialog key={owner} owner={owner} entitlement={access} open={open} onOpenChange={setOpen} />}</>;
}
async function render(owner = io.owner, offer = false) { await act(async () => root.render(<StrictMode><HookHarness owner={owner} offer={offer} /></StrictMode>)); }
async function page() { await act(async () => root.render(<MemoryRouter initialEntries={['/studio/record']}><Routes><Route path="/studio/record" element={<StudioRecord />} /><Route path="/" element={<p>Início</p>} /><Route path="/auth" element={<p>Entrar</p>} /></Routes></MemoryRouter>)); }
async function click(label: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === label)!; expect(button, label).toBeTruthy(); await act(async () => button.click()); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
  io.owner = 'creator'; io.role = 'creator'; io.query = null; io.rows = new Map([['creator', profile()]]); io.invoke.mockResolvedValue({ data: { hasSubscription: false, plan: 'free' }, error: null }); io.open.mockReturnValue(null);
  vi.spyOn(window, 'open').mockImplementation(io.open); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('entitlement de cenas e oferta ligada à conta atual', () => {
  it.each(['free', 'pro'] as const)('%s recebe oferta específica do iPhone sem nova aba, sessão de captura ou cobrança', async plan => {
    io.rows.set('creator', profile('creator', { plan, entitlement_source: plan === 'free' ? 'free' : 'stripe' })); await page(); await click('Usar meu iPhone');
    const dialog = document.querySelector('[role="dialog"]')!; expect(dialog.textContent).toContain('Seu iPhone vira câmera Pro.'); expect(dialog.textContent).toContain('Original até 4K'); expect(dialog.textContent).not.toContain('Três cenas');
    expect(io.invoke).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled(); expect(io.checkout).not.toHaveBeenCalled();
    await click('Continuar com gravação básica'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).toContain('Gravação básica');
  });
  it('loading permanece bloqueado até consulta real confirmar Premium', async () => {
    const pending = deferred<unknown>(); io.query = () => pending.promise; await render(); expect(access.loading).toBe(true); expect(access.canUseScenes).toBe(false);
    await act(async () => pending.resolve({ data: profile(), error: null })); expect(access.canUseScenes).toBe(true); expect(access.loading).toBe(false); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('expiração bloqueia cenas na aba aberta sem alterar o plano ou invocar billing', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); vi.setSystemTime(NOW);
    io.rows.set('creator', profile('creator', { plan_expires_at: new Date(NOW + 50).toISOString() })); await render(); expect(access.canUseScenes).toBe(true);
    await act(async () => vi.advanceTimersByTime(51)); expect(access.canUseScenes).toBe(false); expect(access.reason).toBe('expired'); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('perfil Premium anterior não aparece por um frame na conta nova, nem por resposta tardia', async () => {
    const late = deferred<unknown>(); io.query = owner => owner === 'creator' ? late.promise : Promise.resolve({ data: profile(owner, { plan: 'free', entitlement_source: 'free' }), error: null });
    await render(); io.owner = 'other'; await render('other'); expect(access.canUseScenes).toBe(false);
    await act(async () => late.resolve({ data: profile(), error: null })); expect(access.canUseScenes).toBe(false); expect(access.profile?.id).toBe('other');
  });
  it('falha na consulta não usa AuthContext Premium como fallback; retry pode confirmar acesso', async () => {
    io.query = async () => ({ data: null, error: new Error('private backend detail') }); await render(); expect(access.canUseScenes).toBe(false); expect(access.error).toBe('Não foi possível confirmar seu plano. Tente novamente.');
    io.query = null; await click('Recarregar'); expect(access.canUseScenes).toBe(true); expect(access.error).toBeNull();
  });
  it('retorno à aba revalida alteração de plano sem consultar enquanto oculta', async () => {
    await render(); expect(access.canUseScenes).toBe(true); const count = io.selects.mock.calls.length; io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' }));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); await act(async () => window.dispatchEvent(new Event('focus'))); expect(io.selects).toHaveBeenCalledTimes(count);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(access.canUseScenes).toBe(false);
  });
  it('desmontagem aborta espera e uma resposta tardia não remonta oferta/acesso', async () => {
    const late = deferred<unknown>(); io.query = () => late.promise; await render(); await act(async () => root.render(null));
    await act(async () => late.resolve({ data: profile(), error: null })); expect(host.textContent).toBe(''); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('focus/visibility não cancelam a verificação explícita ainda pendente', async () => {
    io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' })); await render();
    const verifying = deferred<unknown>(); io.invoke.mockImplementation(() => verifying.promise); let result!: Promise<boolean>;
    await act(async () => { result = access.refresh(true); }); const reads = io.selects.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
    expect(io.selects).toHaveBeenCalledTimes(reads); io.rows.set('creator', profile());
    await act(async () => verifying.resolve({ data: { plan: 'premium' }, error: null })); expect(await result).toBe(true); expect(access.canUseScenes).toBe(true);
  });
  it('creator Free mantém gravação básica e abre oferta central sem abrir câmera ou checkout', async () => {
    io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' })); await page();
    expect(host.querySelector('[aria-label="Acesso a cenas"]')?.textContent).toBe('bloqueado'); await click('Gravação com cenas');
    const dialog = document.querySelector('[role="dialog"]')!; expect(dialog.textContent).toContain('Gravação com cenas'); expect(dialog.textContent).toContain(`R$ ${PLAN_OFFERS.premium.price}`); expect(dialog.textContent).toContain('Tela + câmera'); expect(dialog.textContent).not.toContain('Este conteúdo');
    expect(io.invoke).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled(); await click('Continuar com gravação básica'); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(host.textContent).toContain('Gravação básica');
  });
  it('role admin Free não ganha Premium, mas Premium remoto creator libera e usuário comum continua sem rota', async () => {
    io.role = 'admin'; io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' })); await page(); expect(host.querySelector('[aria-label="Acesso a cenas"]')?.textContent).toBe('bloqueado');
    io.rows.set('creator', profile()); await act(async () => window.dispatchEvent(new Event('focus'))); expect(host.querySelector('[aria-label="Acesso a cenas"]')?.textContent).toBe('liberado');
    io.role = 'user'; await page(); expect(host.textContent).toBe('Início');
  });
  it('Já assinei confirma remoto, fecha oferta e nunca libera por resposta otimista de verify', async () => {
    io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' })); await render('creator', true); await click('Solicitar cenas');
    io.invoke.mockResolvedValue({ data: { plan: 'premium', hasSubscription: true }, error: null }); await click('Já assinei · Verificar acesso'); expect(access.canUseScenes).toBe(false); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    io.rows.set('creator', profile()); await click('Já assinei · Verificar acesso'); expect(access.canUseScenes).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('Premium confirmado após abrir durante loading fecha oferta sem iniciar checkout', async () => {
    const loading = deferred<unknown>(); io.query = () => loading.promise;
    await render('creator', true); await click('Solicitar cenas'); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    await act(async () => loading.resolve({ data: profile(), error: null }));
    expect(access.canUseScenes).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(io.invoke).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled();
  });
  it('erro de leitura oferece retry do perfil sem depender de Stripe nem iniciar cobrança', async () => {
    io.query = async () => ({ data: null, error: new Error('offline') }); await render('creator', true); await click('Solicitar cenas');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Não foi possível confirmar seu plano. Tente novamente.');
    io.query = null; await click('Tentar confirmar plano'); expect(access.canUseScenes).toBe(true); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(io.invoke).not.toHaveBeenCalled();
  });
  it('checkout integrado é explícito, fecha a oferta sem popup e não libera cenas por resposta otimista', async () => {
    io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' }));
    await render('creator', true); await click('Solicitar cenas'); await click('Ativar Premium');
    expect(io.checkout).toHaveBeenCalledOnce(); expect(io.checkout).toHaveBeenCalledWith('premium', expect.any(Function));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(window.open).not.toHaveBeenCalled(); expect(io.invoke).not.toHaveBeenCalled(); expect(access.canUseScenes).toBe(false);
    const onConfirmed = io.checkout.mock.calls[0][1];
    io.invoke.mockResolvedValue({ data: { hasSubscription: true, plan: 'premium' }, error: null });
    await act(async () => onConfirmed()); expect(access.canUseScenes).toBe(false);
    io.rows.set('creator', profile()); await act(async () => onConfirmed()); expect(access.canUseScenes).toBe(true);
  });
  it('owner/unmount após handoff não verifica nem libera a conta nova pelo callback antigo', async () => {
    io.rows.set('creator', profile('creator', { plan: 'free', entitlement_source: 'free' }));
    await render('creator', true); await click('Solicitar cenas'); await click('Ativar Premium');
    const onConfirmed = io.checkout.mock.calls[0][1];
    io.owner = 'other'; io.rows.set('other', profile('other', { plan: 'free', entitlement_source: 'free' })); await render('other', true);
    const reads = io.selects.mock.calls.length; await act(async () => onConfirmed());
    expect(io.selects).toHaveBeenCalledTimes(reads); expect(io.invoke).not.toHaveBeenCalled(); expect(access.canUseScenes).toBe(false); expect(access.profile?.id).toBe('other');
    await act(async () => root.render(null)); await act(async () => onConfirmed());
    expect(io.selects).toHaveBeenCalledTimes(reads); expect(io.invoke).not.toHaveBeenCalled(); expect(window.open).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
