import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const io = vi.hoisted(() => ({ owner: 'owner-a', session: vi.fn(), user: vi.fn(), invoke: vi.fn(), viewPlan: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: io.session, getUser: io.user }, functions: { invoke: io.invoke } } }));
import { SubscriptionBillingPanel } from './SubscriptionBillingPanel';

// Actual component and service. Only auth and read-only HTTP are controlled boundaries.
const invoice = { id: 'in_paid', number: 'CF-100', status: 'paid', plan: 'premium', createdAt: '2026-10-01T12:00:00Z', dueAt: null, paidAt: '2026-10-01T12:01:00Z', amountDue: 4990, amountPaid: 4990, amountRemaining: 0, currency: 'brl', pdfUrl: 'https://pay.stripe.com/invoice/fixture/pdf', hostedUrl: 'https://invoice.stripe.com/i/fixture' };
const subscription = { plan: 'premium', status: 'active', cancelAtPeriodEnd: false, periodEnd: '2099-11-01T12:00:00Z', nextRenewal: { at: '2099-11-01T12:00:00Z', amountDue: 4990, currency: 'brl' }, paymentMethod: { type: 'card', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2099 } };
const page = { invoices: [invoice], nextCursor: null, subscription };
let root: Root, host: HTMLDivElement;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }
async function render(owner = io.owner) { await act(async () => root.render(<StrictMode><SubscriptionBillingPanel ownerId={owner} onViewPlan={io.viewPlan} /></StrictMode>)); }
function button(label: string) { const value = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.includes(label)); expect(value, label).toBeTruthy(); return value!; }
async function click(label: string) { await act(async () => button(label).click()); }
const text = () => host.textContent || '';
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks(); io.owner = 'owner-a';
  io.session.mockImplementation(async () => ({ data: { session: { user: { id: io.owner }, access_token: 'test-boundary-token' } }, error: null }));
  io.user.mockImplementation(async () => ({ data: { user: { id: io.owner } }, error: null }));
  io.invoke.mockResolvedValue({ data: page, error: null });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Cobranças history and owner isolation', () => {
  it('renders real summary, masked card, paid/overdue/canceled statuses and only trusted document links', async () => {
    io.invoke.mockResolvedValue({ data: { ...page, invoices: [invoice,
      { ...invoice, id: 'in_open', number: 'CF-101', status: 'open', dueAt: '2000-01-01T12:00:00Z', paidAt: null, amountPaid: 2000, amountRemaining: 2990, pdfUrl: null, hostedUrl: 'https://evil.test/invoice' },
      { ...invoice, id: 'in_void', number: 'CF-102', status: 'void', paidAt: null, pdfUrl: null, hostedUrl: null }] }, error: null });
    await render();
    expect(text()).toContain('Próxima cobrança'); expect(text()).toContain('Visa •••• 4242');
    expect(text()).toContain('Paga'); expect(text()).toContain('Vencida'); expect(text()).toContain('Cancelada'); expect(text()).toContain('Restam');
    expect(host.querySelectorAll('.sb-invoice')).toHaveLength(3);
    const links = [...host.querySelectorAll<HTMLAnchorElement>('.sb-invoice a')]; expect(links).toHaveLength(2);
    expect(links.every(link => link.rel === 'noopener noreferrer' && link.getAttribute('referrerpolicy') === 'no-referrer')).toBe(true);
    await click('Ver meu plano'); expect(io.viewPlan).toHaveBeenCalledTimes(1);
    expect(io.invoke.mock.calls.every(call => call[0] === 'subscription-billing')).toBe(true);
  });
  it('filters globally on the server and discards a previous filter response arriving late', async () => {
    await render(); const pending = deferred<{ data: unknown; error: null }>();
    io.invoke.mockImplementation((_name, options) => options.body.status === 'pending' ? pending.promise : Promise.resolve({ data: { ...page, invoices: [{ ...invoice, id: 'in_paid2', number: 'PAGA-NOVA' }] }, error: null }));
    await click('Pendentes'); expect(host.querySelectorAll('.sb-invoice')).toHaveLength(0);
    await click('Pagas'); expect(text()).toContain('PAGA-NOVA');
    await act(async () => pending.resolve({ data: { ...page, invoices: [{ ...invoice, id: 'in_old', number: 'RESPOSTA-ANTIGA', status: 'open' }] }, error: null }));
    expect(text()).not.toContain('RESPOSTA-ANTIGA');
    expect(io.invoke.mock.calls.at(-1)![1].body.status).toBe('paid');
  });
  it('allows an empty filtered page with a cursor and reserves one append, deduplicating overlapping invoices', async () => {
    io.invoke.mockResolvedValue({ data: { ...page, invoices: [], nextCursor: 'page-one' }, error: null }); await render();
    expect(text()).toContain('Ainda há páginas');
    const pending = deferred<{ data: unknown; error: null }>(); io.invoke.mockReturnValue(pending.promise);
    const before = io.invoke.mock.calls.length;
    await act(async () => { button('Carregar mais cobranças').click(); button('Carregar mais cobranças').click(); });
    expect(io.invoke).toHaveBeenCalledTimes(before + 1);
    expect(io.invoke.mock.calls.at(-1)![1].body.cursor).toBe('page-one');
    await act(async () => pending.resolve({ data: { ...page, nextCursor: 'page-two' }, error: null }));
    io.invoke.mockResolvedValue({ data: { ...page, invoices: [invoice, { ...invoice, id: 'in_next', number: 'CF-200' }] }, error: null });
    await click('Carregar mais cobranças');
    expect(host.querySelectorAll('.sb-invoice')).toHaveLength(2);
  });
  it('unmounts the old owner immediately and ignores its late summary and documents', async () => {
    const old = deferred<{ data: unknown; error: null }>(); io.invoke.mockReturnValue(old.promise); await render();
    const oldSignal = io.invoke.mock.calls.at(-1)![1].signal;
    io.owner = 'owner-b'; io.invoke.mockResolvedValue({ data: { invoices: [], nextCursor: null, subscription: null }, error: null }); await render();
    expect(oldSignal.aborted).toBe(true); expect(text()).toContain('Sem assinatura ativa');
    await act(async () => old.resolve({ data: page, error: null }));
    expect(text()).not.toContain('4242'); expect(text()).not.toContain('CF-100'); expect(host.querySelectorAll('.sb-invoice a')).toHaveLength(0);
  });
  it('shows a helpful failure with retry, then an honest Free empty state without manufactured payment or records', async () => {
    io.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: 'Não foi possível consultar agora.' })) } }); await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('consultar agora');
    io.invoke.mockResolvedValue({ data: { invoices: [], nextCursor: null, subscription: null }, error: null }); await click('Tentar novamente');
    expect(text()).toContain('Não há uma mensalidade recorrente confirmada'); expect(text()).toContain('Nenhuma cobrança de assinatura');
    expect(host.querySelectorAll('.sb-invoice')).toHaveLength(0); expect(host.querySelectorAll('a')).toHaveLength(0);
  });
  it('does not invent a renewal value or card when the server has no confirmed metadata', async () => {
    io.invoke.mockResolvedValue({ data: { ...page, subscription: { ...subscription, nextRenewal: { ...subscription.nextRenewal, amountDue: null, currency: null }, paymentMethod: null } }, error: null }); await render();
    expect(text()).toContain('Valor a confirmar'); expect(text()).toContain('Sem cartão confirmado'); expect(text()).not.toContain('4242');
  });
  it('retry replaces an expired pagination cursor with a fresh first page', async () => {
    io.invoke.mockResolvedValue({ data: { ...page, nextCursor: 'expired-page' }, error: null }); await render();
    io.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: 'Esta página do histórico expirou. Atualize a consulta.' })) } });
    await click('Carregar mais cobranças'); expect(text()).toContain('histórico expirou');
    io.invoke.mockResolvedValue({ data: { ...page, invoices: [{ ...invoice, id: 'in_fresh', number: 'CF-FRESH' }] }, error: null });
    await click('Tentar novamente');
    expect(io.invoke.mock.calls.at(-1)![1].body.cursor).toBeUndefined();
    expect(text()).toContain('CF-FRESH'); expect(text()).not.toContain('CF-100');
  });
});
