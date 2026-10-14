import { StrictMode, act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudioPremiumProfile } from '@/lib/studio/editor/entitlementPremium';

// StudioRecord, workspace, capture, entitlement, upgrade offer and checkout all
// remain real. These boundaries represent Auth, server data and hosted Stripe;
// no request can charge a card, open a camera or confer a production plan.
const boundary = vi.hoisted(() => ({
  auth: { user: { id: 'creator' }, role: 'creator', loading: false, profile: { plan: 'free', plan_expires_at: null as string | null }, refreshProfile: vi.fn() },
  profile: null as StudioPremiumProfile | null,
  selects: vi.fn(), invoke: vi.fn(), prepare: vi.fn(), status: vi.fn(), confirm: vi.fn(), load: vi.fn(), upgrade: vi.fn(), cancel: vi.fn(), createProject: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => boundary.auth }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: { user: boundary.auth.user, access_token: 'fixture-session' } }, error: null }),
    getUser: async () => ({ data: { user: boundary.auth.user }, error: null }),
  },
  functions: { invoke: boundary.invoke },
  from: () => ({ select: () => ({ eq: (_column: string, owner: string) => ({ abortSignal: () => ({ single: async () => {
    boundary.selects(owner); return { data: boundary.profile, error: null };
  } }) }) }) }),
} }));
vi.mock('@/lib/billing/subscriptionCheckout', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/billing/subscriptionCheckout')>()),
  prepareSubscriptionCheckout: boundary.prepare, readSubscriptionCheckoutStatus: boundary.status,
  loadBillingStripe: boundary.load, confirmSubscriptionUpgrade: boundary.upgrade, requestSubscriptionCheckoutCancel: boundary.cancel,
}));
vi.mock('@stripe/react-stripe-js/checkout', () => ({
  CheckoutProvider: ({ children }: { children: ReactNode }) => children,
  useCheckout: () => ({ type: 'success', checkout: { confirm: boundary.confirm } }),
  PaymentElement: function HostedPayment({ onReady }: { onReady(): void }) {
    useEffect(() => { onReady(); }, [onReady]);
    return <input aria-label="Cartão seguro do Stripe" />;
  },
}));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }: { children: ReactNode }) => children,
  useStripe: () => ({}), useElements: () => ({}), PaymentElement: () => null,
}));
vi.mock('@/lib/studio/editor/storage', () => ({
  createProject: boundary.createProject, getProject: vi.fn(), saveProject: vi.fn(), putAsset: vi.fn(), getAsset: vi.fn(), studioAssetUri: vi.fn(),
}));

import StudioRecord from '@/pages/StudioRecord';
import { SubscriptionCheckoutProvider } from '@/components/billing/SubscriptionCheckoutProvider';

function profile(plan: 'free' | 'premium'): StudioPremiumProfile {
  return {
    id: 'creator', plan, plan_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    entitlement_source: plan === 'free' ? 'free' : 'stripe', subscription_status: 'active', subscription_grace_until: null,
    stripe_subscription_id: plan === 'premium' ? 'sub_fixture' : null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
class Track extends EventTarget {
  id: string; readyState = 'live'; enabled = true; muted = false;
  onended: null | (() => void) = null; onmute = null; onunmute = null;
  constructor(public kind: 'video' | 'audio', public label: string) { super(); this.id = `fixture-${kind}`; }
  stop = vi.fn(() => { this.readyState = 'ended'; });
  getSettings() { return { deviceId: this.id, width: 1920, height: 1080, frameRate: 30 }; }
}
class Stream {
  constructor(public tracks: Track[]) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
}
class Audio {
  resume = vi.fn(async () => {}); close = vi.fn(async () => {});
  createMediaStreamSource() { return { connect: vi.fn() }; }
  createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples: Float32Array) { samples.fill(.1); } }; }
}
let root: Root, host: HTMLDivElement, permissions: ReturnType<typeof vi.fn>;
function CurrentRoute() { const location = useLocation(); return <output aria-label="Rota atual">{location.pathname}{location.search}</output>; }
async function mount() {
  await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={['/studio/record']}>
    <SubscriptionCheckoutProvider><CurrentRoute /><Routes><Route path="/studio/record" element={<StudioRecord />} /><Route path="*" element={<p>Fora do Studio</p>} /></Routes></SubscriptionCheckoutProvider>
  </MemoryRouter></StrictMode>));
}
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>('button')].find(value => value.getAttribute('aria-label') === label || value.textContent?.includes(label));
  expect(result, label).toBeTruthy(); return result!;
}
async function click(label: string) { await act(async () => button(label).click()); }
const card = () => host.querySelector<HTMLButtonElement>('.srs-scenes-card')!;
const workspace = () => host.querySelector<HTMLElement>('.se-recording')!;
const titleInput = () => host.querySelector<HTMLInputElement>('input[aria-label="Nome da gravação"]')!;
async function prepareNameAndFormat(activate = false) {
  await click('Short');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(titleInput(), 'Minha próxima aula');
    titleInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (activate) await click('Ativar câmera');
  return { workspace: workspace(), input: titleInput(), preview: host.querySelector<HTMLVideoElement>('video[aria-label="Prévia da gravação"]') };
}
function expectPreparation(original: Awaited<ReturnType<typeof prepareNameAndFormat>>) {
  expect(workspace()).toBe(original.workspace);
  expect(titleInput()).toBe(original.input);
  expect(titleInput().value).toBe('Minha próxima aula');
  expect(button('Short').getAttribute('aria-pressed')).toBe('true');
  expect(workspace().getAttribute('data-stage')).toBe('setup');
  expect(host.querySelector('[aria-label="Rota atual"]')?.textContent).toBe('/studio/record');
  expect(boundary.createProject).not.toHaveBeenCalled();
  expect(window.open).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); localStorage.clear();
  boundary.auth.user = { id: 'creator' }; boundary.auth.role = 'creator'; boundary.auth.loading = false;
  // The UI's cached auth profile deliberately disagrees with the server. It
  // cannot grant Premium until the owner-scoped entitlement read confirms it.
  boundary.auth.profile = { plan: 'premium', plan_expires_at: new Date(Date.now() + 86_400_000).toISOString() };
  boundary.profile = profile('free'); boundary.auth.refreshProfile.mockResolvedValue(undefined);
  boundary.invoke.mockResolvedValue({ data: { hasSubscription: true, plan: 'premium' }, error: null });
  boundary.prepare.mockResolvedValue({ kind: 'checkout', plan: 'premium', sessionId: 'cs_test_fixture', clientSecret: 'fixture', publishableKey: 'pk_test_fixture', expiresAt: new Date(Date.now() + 600_000).toISOString(), amountDue: 4990, recurringAmount: 4990, currency: 'brl' });
  boundary.status.mockResolvedValue({ kind: 'status', state: 'active', plan: 'premium' });
  boundary.load.mockResolvedValue({}); boundary.confirm.mockResolvedValue({ type: 'success', session: {} });
  for (const name of ['MediaStreamTrackProcessor', 'MediaStreamTrackGenerator', 'Worker', 'OffscreenCanvas', 'VideoFrame']) vi.stubGlobal(name, class {});
  vi.stubGlobal('MediaStream', Stream); vi.stubGlobal('AudioContext', Audio); vi.stubGlobal('MediaRecorder', class { static isTypeSupported() { return true; } });
  permissions = vi.fn(async () => new Stream([new Track('video', 'Câmera de teste'), new Track('audio', 'Microfone de teste')]));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: permissions, enumerateDevices: vi.fn(async () => [
    { deviceId: 'fixture-video', kind: 'videoinput', label: 'Câmera de teste' }, { deviceId: 'fixture-audio', kind: 'audioinput', label: 'Microfone de teste' },
  ]) } });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(window, 'open').mockReturnValue(null);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('upgrade Premium integrado à preparação real do Studio', () => {
  it('Free paga na mesma página e só ganha Novo após Stripe, status e perfil do servidor confirmarem, sem substituir a câmera', async () => {
    const status = deferred<unknown>(); boundary.status.mockReturnValue(status.promise);
    await mount(); const original = await prepareNameAndFormat(true);
    const stream = original.preview!.srcObject as unknown as Stream;
    expect(stream.getVideoTracks()[0].readyState).toBe('live'); expect(permissions).toHaveBeenCalledTimes(1);
    expect(card().classList.contains('is-locked')).toBe(true); expect(card().textContent).not.toContain('Novo');
    await click('Câmera e tela'); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Gravação com cenas');
    expect(boundary.prepare).not.toHaveBeenCalled(); expectPreparation(original);
    await click('Ativar Premium'); expect(document.querySelector('[aria-label="Cartão seguro do Stripe"]')).toBeTruthy();
    expect(boundary.prepare.mock.calls.every(call => call[0] === 'creator' && call[1] === 'premium')).toBe(true);
    expect(card().getAttribute('aria-pressed')).toBe('false'); expectPreparation(original);
    await click('Confirmar assinatura');
    expect(boundary.confirm).toHaveBeenCalledTimes(1); expect(card().classList.contains('is-locked')).toBe(true);
    expect(boundary.auth.refreshProfile).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    boundary.profile = profile('premium');
    await act(async () => status.resolve({ kind: 'status', state: 'active', plan: 'premium' }));
    expect(boundary.auth.refreshProfile).toHaveBeenCalledTimes(1);
    expect(boundary.invoke).toHaveBeenCalledWith('verify-subscription', expect.anything());
    expect(card().classList.contains('is-locked')).toBe(false); expect(card().textContent).toContain('Novo');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expectPreparation(original);
    expect(original.preview!.srcObject).toBe(stream); expect(permissions).toHaveBeenCalledTimes(1);
    expect(stream.getTracks().every(track => track.stop.mock.calls.length === 0)).toBe(true);
  });

  it('status ativo sem perfil Premium mantém o pagamento aberto e bloqueado; Atualizar plano conclui sem cobrar novamente', async () => {
    await mount(); const original = await prepareNameAndFormat();
    await click('Câmera e tela'); await click('Ativar Premium'); await click('Confirmar assinatura');
    expect(boundary.confirm).toHaveBeenCalledTimes(1); expect(boundary.status).toHaveBeenCalledTimes(1);
    expect(card().classList.contains('is-locked')).toBe(true); expect(card().textContent).not.toContain('Novo');
    expect(document.querySelector('[role="dialog"]')).toBeTruthy(); expectPreparation(original);
    boundary.profile = profile('premium'); await click('Atualizar plano');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(card().textContent).toContain('Novo');
    expect(boundary.confirm).toHaveBeenCalledTimes(1); expect(boundary.status).toHaveBeenCalledTimes(1);
    expect(new Set(boundary.prepare.mock.calls.map(call => call[2])).size).toBe(1); expectPreparation(original);
  });

  it('fechar a oferta ou o pagamento mantém nome, formato, câmera e o mesmo workspace sem iniciar outra cobrança', async () => {
    await mount(); const original = await prepareNameAndFormat(true), stream = original.preview!.srcObject as unknown as Stream;
    await click('Câmera e tela'); await click('Continuar com gravação básica');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(boundary.prepare).not.toHaveBeenCalled(); expectPreparation(original);
    await click('Câmera e tela'); await click('Ativar Premium'); await click('Fechar pagamento');
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expectPreparation(original);
    expect(card().classList.contains('is-locked')).toBe(true); expect(card().getAttribute('aria-pressed')).toBe('false');
    expect(boundary.confirm).not.toHaveBeenCalled(); expect(boundary.cancel).not.toHaveBeenCalled();
    expect(original.preview!.srcObject).toBe(stream); expect(permissions).toHaveBeenCalledTimes(1);
    expect(stream.getTracks().every(track => track.stop.mock.calls.length === 0)).toBe(true);
  });

  it('Premium confirmado mostra Novo e seleciona cenas direto, sem oferta, pagamento ou nova permissão', async () => {
    boundary.profile = profile('premium'); await mount(); const original = await prepareNameAndFormat();
    expect(card().textContent).toContain('Novo'); expect(card().classList.contains('is-locked')).toBe(false);
    await click('Câmera e tela'); expect(card().getAttribute('aria-pressed')).toBe('true');
    expect(workspace().classList.contains('has-scenes')).toBe(true); expectPreparation(original);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(boundary.prepare).not.toHaveBeenCalled(); expect(boundary.confirm).not.toHaveBeenCalled(); expect(boundary.invoke).not.toHaveBeenCalled(); expect(permissions).not.toHaveBeenCalled();
  });
});
