import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasCurrentPaidPlan, readSubscriptionCheckoutStatus, type BillingPlan, type BillingStatusReference, type SubscriptionStatus } from '@/lib/billing/subscriptionCheckout';
import { SubscriptionCheckoutDialog } from './SubscriptionCheckoutDialog';
import '@/styles/subscription-checkout.css';

type SubscriptionCheckoutContextValue = { startSubscription(plan: BillingPlan, onConfirmed?: () => Promise<void> | void): void };
type Offer = { owner: string; plan: BillingPlan; id: number; onConfirmed?: () => Promise<void> | void };
type ReturnedPayment = { owner: string; reference: BillingStatusReference; key: string };
const SubscriptionCheckoutContext = createContext<SubscriptionCheckoutContextValue | null>(null);
const RETURN_KEYS = ['billing_session_id', 'billing_subscription_id', 'billing_payment_intent_id', 'payment_intent', 'payment_intent_client_secret', 'redirect_status', 'subscription'];

function returnReference(search: string): BillingStatusReference | null {
  const params = new URLSearchParams(search);
  const sessionId = params.get('billing_session_id');
  if (sessionId && /^cs_(?:test_|live_)?[a-zA-Z0-9]+$/.test(sessionId)) return { sessionId };
  const paymentIntentId = params.get('billing_payment_intent_id') ?? params.get('payment_intent');
  const subscriptionId = params.get('billing_subscription_id');
  if (paymentIntentId && /^pi_[a-zA-Z0-9]+$/.test(paymentIntentId)) {
    return { paymentIntentId, ...(subscriptionId && /^sub_[a-zA-Z0-9]+$/.test(subscriptionId) ? { subscriptionId } : {}) };
  }
  if (subscriptionId && /^sub_[a-zA-Z0-9]+$/.test(subscriptionId)) return { subscriptionId };
  return null;
}

function interrupted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Verificação cancelada.', 'AbortError');
}
function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Verificação cancelada.', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  interrupted(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('Verificação cancelada.', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    task.then(value => { signal.removeEventListener('abort', abort); if (!signal.aborted) resolve(value); }, error => { signal.removeEventListener('abort', abort); if (!signal.aborted) reject(error); });
  });
}

/** A Stripe return verifies the existing owner-scoped operation; it never prepares a payment. */
function ReturnedPaymentDialog({ payment, isCurrent, onActive, onClose }: { payment: ReturnedPayment; isCurrent(): boolean; onActive(): Promise<void>; onClose(): void }) {
  const [result, setResult] = useState<SubscriptionStatus | null>(null), [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [container, setContainer] = useState<Element | null>(() => document.fullscreenElement);
  const alive = useRef(false), operation = useRef<AbortController | null>(null), latest = useRef({ isCurrent, onActive });
  latest.current = { isCurrent, onActive };
  const fresh = (controller?: AbortController) => alive.current && latest.current.isCurrent() && (!controller || operation.current === controller && !controller.signal.aborted);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; operation.current?.abort(); operation.current = null; };
  }, []);
  useEffect(() => {
    const update = () => setContainer(document.fullscreenElement);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const verify = async (automatic: boolean) => {
    if (!fresh() || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 20_000);
    setBusy(true); setMessage(null);
    try {
      for (const delay of automatic ? [0, 1200, 2200, 3500] : [0]) {
        if (delay) await wait(delay, controller.signal);
        if (!fresh(controller)) return;
        if (document.visibilityState === 'hidden') { setMessage('Volte a esta página e verifique o pagamento.'); return; }
        const value = await readSubscriptionCheckoutStatus(payment.owner, payment.reference, controller.signal);
        if (!fresh(controller)) return;
        setResult(value);
        if (value.state === 'active') { await abortable(latest.current.onActive(), controller.signal); return; }
        if (value.state !== 'pending') { setMessage(value.message ?? null); return; }
      }
    } catch (cause) {
      if (alive.current && latest.current.isCurrent() && operation.current === controller && (timedOut || !controller.signal.aborted)) {
        setMessage(timedOut ? 'A verificação demorou mais que o esperado. Confira o pagamento novamente; não inicie outra cobrança.' : cause instanceof Error ? cause.message : 'Não foi possível verificar o pagamento. Tente novamente.');
      }
    } finally {
      clearTimeout(timer);
      if (operation.current === controller) {
        operation.current = null;
        if (alive.current && latest.current.isCurrent()) setBusy(false);
      }
    }
  };
  const verifyRef = useRef(verify); verifyRef.current = verify;
  useEffect(() => { void verifyRef.current(true); return () => { operation.current?.abort(); operation.current = null; }; }, []);
  const close = () => { operation.current?.abort(); operation.current = null; onClose(); };
  const active = result?.state === 'active';
  const title = active ? 'Plano confirmado.' : result?.state === 'expired' ? 'Este pagamento expirou.' : result?.state === 'failed' ? 'Pagamento não confirmado.' : 'Confira seu pagamento.';
  return <Dialog.Root open onOpenChange={open => { if (!open) close(); }}><Dialog.Portal container={container ?? undefined}>
    <Dialog.Overlay className="sc-checkout-overlay" />
    <Dialog.Content className="sc-checkout-dialog" onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); close(); }} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <header className="sc-checkout-header"><img src="/brand/classfy-icone-principal.svg" alt="Classfy" width="30" height="30" /><div><span>CLASSFY · PAGAMENTO</span><Dialog.Title>{title}</Dialog.Title></div><button className="sc-checkout-close" type="button" aria-label="Fechar verificação do pagamento" onClick={close}><X size={19} /></button></header>
      <Dialog.Description className="sc-checkout-description">Verificamos com o servidor o pagamento que você já iniciou.</Dialog.Description>
      <section className={active ? 'sc-checkout-result' : 'sc-checkout-status'} role="status">
        {busy ? <Loader2 size={30} className="sc-checkout-spin" /> : active ? <CheckCircle2 size={42} /> : <ShieldCheck size={30} />}
        <p>{active ? `Sua assinatura ${result.plan === 'premium' ? 'Premium' : 'Pro'} está ativa.` : result?.state === 'expired' ? 'Nenhuma nova cobrança foi iniciada. Você pode fechar esta janela e escolher um plano novamente.' : result?.state === 'failed' ? 'Confira o resultado antes de tentar uma nova assinatura.' : 'Seu plano será liberado quando a confirmação chegar ao servidor.'}</p>
      </section>
      {message && <p className="sc-checkout-error" role="alert">{message}</p>}
      {(!active || message) && <button type="button" className="sc-checkout-secondary" disabled={busy} onClick={() => { void verify(false); }}><RefreshCw size={16} />Verificar pagamento</button>}
      {active && <button type="button" className="sc-checkout-primary" onClick={close}>Concluir</button>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function SubscriptionCheckoutProvider({ children }: { children: ReactNode }) {
  const { user, loading, profile, refreshProfile } = useAuth();
  const location = useLocation(), navigate = useNavigate();
  const owner = user?.id ?? '';
  const [offer, setOffer] = useState<Offer | null>(null), [returned, setReturned] = useState<ReturnedPayment | null>(null);
  const sequence = useRef(0), offerRef = useRef<Offer | null>(null), returnedRef = useRef<ReturnedPayment | null>(null), consumedReturn = useRef<string | null>(null);
  const latest = useRef({ owner, loading, profile, refreshProfile, mounted: true }); latest.current = { owner, loading, profile, refreshProfile, mounted: latest.current.mounted };
  offerRef.current = offer; returnedRef.current = returned;
  useLayoutEffect(() => {
    latest.current.mounted = true;
    return () => { latest.current.mounted = false; ++sequence.current; offerRef.current = null; returnedRef.current = null; };
  }, []);
  useEffect(() => { if (offer && offer.owner !== owner) { offerRef.current = null; setOffer(null); } if (returned && returned.owner !== owner) { returnedRef.current = null; setReturned(null); } }, [owner, offer, returned]);
  const startSubscription = useCallback((plan: BillingPlan, onConfirmed?: () => Promise<void> | void) => {
    const current = latest.current;
    if (!current.mounted || current.loading || !current.owner || !['pro', 'premium'].includes(plan) || offerRef.current || returnedRef.current) return;
    if (current.profile?.plan === 'premium' && hasCurrentPaidPlan(current.profile) && plan === 'pro') { navigate('/conta?tab=plan'); return; }
    const value: Offer = { owner: current.owner, plan, onConfirmed, id: ++sequence.current };
    offerRef.current = value; setOffer(value);
  }, [navigate]);
  useEffect(() => {
    if (loading || !owner || location.pathname !== '/conta') return;
    const reference = returnReference(location.search);
    if (!reference) return;
    const key = reference.sessionId ?? reference.paymentIntentId ?? reference.subscriptionId!;
    if (consumedReturn.current === key) return;
    consumedReturn.current = key;
    const value = { owner, reference, key };
    offerRef.current = null; setOffer(null); returnedRef.current = value; setReturned(value);
    const params = new URLSearchParams(location.search); RETURN_KEYS.forEach(name => params.delete(name));
    navigate({ pathname: location.pathname, search: params.size ? `?${params.toString()}` : '', hash: location.hash }, { replace: true, state: location.state });
  }, [owner, loading, location, navigate]);
  const confirmOffer = async (target: Offer) => {
    const current = () => latest.current.mounted && latest.current.owner === target.owner && offerRef.current?.id === target.id;
    if (!current()) return;
    await latest.current.refreshProfile();
    if (!current()) return;
    await target.onConfirmed?.();
    if (current()) { offerRef.current = null; setOffer(null); }
  };
  const confirmReturn = async (target: ReturnedPayment) => {
    if (!latest.current.mounted || latest.current.owner !== target.owner || returnedRef.current !== target) return;
    await latest.current.refreshProfile();
  };
  return <SubscriptionCheckoutContext.Provider value={{ startSubscription }}>
    {children}
    {offer && offer.owner === owner && <SubscriptionCheckoutDialog open owner={offer.owner} plan={offer.plan} onOpenChange={open => { if (!open && offerRef.current?.id === offer.id) { offerRef.current = null; setOffer(null); } }} onConfirmed={() => confirmOffer(offer)} />}
    {returned && returned.owner === owner && <ReturnedPaymentDialog key={`${returned.owner}:${returned.key}`} payment={returned} isCurrent={() => latest.current.mounted && latest.current.owner === returned.owner && returnedRef.current === returned} onActive={() => confirmReturn(returned)} onClose={() => { if (returnedRef.current === returned) { returnedRef.current = null; setReturned(null); } }} />}
  </SubscriptionCheckoutContext.Provider>;
}

export function useSubscriptionCheckout() {
  const context = useContext(SubscriptionCheckoutContext);
  if (!context) throw new Error('useSubscriptionCheckout precisa de SubscriptionCheckoutProvider.');
  return context;
}
