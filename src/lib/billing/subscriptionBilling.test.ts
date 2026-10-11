import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const io = vi.hoisted(() => ({ owner: 'owner-a', session: vi.fn(), user: vi.fn(), invoke: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: io.session, getUser: io.user }, functions: { invoke: io.invoke } } }));
import { formatSubscriptionBillingAmount, readSubscriptionBilling, trustedSubscriptionInvoiceUrl } from './subscriptionBilling';

const invoice = { id: 'in_fixture', number: 'CF-100', status: 'paid', plan: 'premium', createdAt: '2026-10-01T12:00:00Z', dueAt: null, paidAt: '2026-10-01T12:01:00Z', amountDue: 4990, amountPaid: 4990, amountRemaining: 0, currency: 'brl', pdfUrl: 'https://pay.stripe.com/invoice/fixture/pdf', hostedUrl: 'https://invoice.stripe.com/i/fixture' };
const page = { invoices: [invoice], nextCursor: null, subscription: null };
beforeEach(() => {
  vi.clearAllMocks(); io.owner = 'owner-a';
  io.session.mockImplementation(async () => ({ data: { session: { user: { id: io.owner }, access_token: 'test-boundary-token' } }, error: null }));
  io.user.mockImplementation(async () => ({ data: { user: { id: io.owner } }, error: null }));
  io.invoke.mockResolvedValue({ data: page, error: null });
});
afterEach(() => { vi.useRealTimers(); });
describe('subscription-billing authenticated reading', () => {
  it('consults only the authenticated owner, sends the global filter and opaque cursor without customer or owner overrides', async () => {
    expect((await readSubscriptionBilling('owner-a', { status: 'pending', cursor: 'opaque', limit: 25 })).invoices).toHaveLength(1);
    expect(io.invoke).toHaveBeenCalledWith('subscription-billing', expect.objectContaining({ body: { status: 'pending', limit: 25, cursor: 'opaque' }, signal: expect.any(AbortSignal) }));
    await expect(readSubscriptionBilling('owner-b')).rejects.toThrow('sessão mudou');
    expect(io.invoke).toHaveBeenCalledTimes(1);
  });
  it('discards financial data after an account switch during the request', async () => {
    io.invoke.mockImplementation(async () => { io.owner = 'owner-b'; return { data: page, error: null }; });
    await expect(readSubscriptionBilling('owner-a')).rejects.toThrow('sessão mudou');
  });
  it('refuses a changed owner during identity verification before querying history', async () => {
    io.user.mockImplementation(async () => { io.owner = 'owner-b'; return { data: { user: { id: 'owner-a' } }, error: null }; });
    await expect(readSubscriptionBilling('owner-a')).rejects.toThrow('sessão mudou');
    expect(io.invoke).not.toHaveBeenCalled();
  });
  it.each([{ amountDue: -1 }, { amountPaid: 49.9 }, { currency: 'invalid' }, { createdAt: 'invalid' }, { status: 'invented' }])('rejects unconfirmed financial values %j', async patch => {
    io.invoke.mockResolvedValue({ data: { ...page, invoices: [{ ...invoice, ...patch }] }, error: null });
    await expect(readSubscriptionBilling('owner-a')).rejects.toThrow('não puderam ser confirmados');
  });
  it('strips malicious links without inventing a document and never exposes draft payment links', async () => {
    io.invoke.mockResolvedValue({ data: { ...page, invoices: [{ ...invoice, hostedUrl: 'https://invoice.stripe.com.evil.test/i/fixture', pdfUrl: 'javascript:alert(1)' }, { ...invoice, id: 'in_draft', status: 'draft' }] }, error: null });
    const result = await readSubscriptionBilling('owner-a');
    expect(result.invoices.every(row => row.pdfUrl === null && row.hostedUrl === null)).toBe(true);
  });
  it.each(['http://invoice.stripe.com/i/x', 'https://user:pass@invoice.stripe.com/i/x', 'https://invoice.stripe.com:8443/i/x', 'https://stripe.com.evil.test/i/x', 'https://evil.test/?next=invoice.stripe.com'])('refuses unsafe Stripe-looking URL %s', url => {
    expect(trustedSubscriptionInvoiceUrl(url)).toBeNull();
  });
  it('accepts actual invoice domains and formats minor units including Stripe legacy currency rules', () => {
    expect(trustedSubscriptionInvoiceUrl(invoice.pdfUrl)).toBe(invoice.pdfUrl);
    expect(trustedSubscriptionInvoiceUrl('https://files.stripe.com/invoice.pdf')).toBe('https://files.stripe.com/invoice.pdf');
    expect(formatSubscriptionBillingAmount(4990, 'brl')).toContain('49,90');
    expect(formatSubscriptionBillingAmount(500, 'jpy')).toContain('500');
    expect(formatSubscriptionBillingAmount(500, 'isk')).toContain('5');
    expect(formatSubscriptionBillingAmount(500, 'isk')).not.toContain('500');
  });
  it('shows the backend error and preserves a history-only request', async () => {
    io.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: 'Esta página do histórico expirou. Atualize a consulta.' }), { status: 400 }) } });
    await expect(readSubscriptionBilling('owner-a')).rejects.toThrow('histórico expirou');
    expect(io.invoke.mock.calls[0][0]).toBe('subscription-billing');
  });
  it('aborts IO and has one global deadline even when auth or the request never resolve', async () => {
    const cancelled = new AbortController(); cancelled.abort();
    await expect(readSubscriptionBilling('owner-a', { signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(io.session).not.toHaveBeenCalled();
    vi.useFakeTimers(); io.invoke.mockImplementation(() => new Promise(() => {}));
    const pending = readSubscriptionBilling('owner-a').catch(cause => cause);
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await pending).message).toContain('demorou');
    expect(io.invoke.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
