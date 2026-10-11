import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { CheckoutProvider, PaymentElement as CheckoutPaymentElement, useCheckout } from '@stripe/react-stripe-js/checkout';
import type { Appearance, Stripe } from '@stripe/stripe-js';
import { Check, CheckCircle2, Crown, CreditCard, Loader2, LockKeyhole, RefreshCw, ShieldCheck, X } from 'lucide-react';
import {
  confirmSubscriptionUpgrade, loadBillingStripe, prepareSubscriptionCheckout,
  readSubscriptionCheckoutStatus,
} from '@/lib/billing/subscriptionCheckout';
import type { PaidPlan } from '@/config/planOffers';
import '@/styles/subscription-checkout.css';

type Prepared = Awaited<ReturnType<typeof prepareSubscriptionCheckout>>;
type UpgradePayment = Awaited<ReturnType<typeof confirmSubscriptionUpgrade>>;
type Flow = Prepared | UpgradePayment;
type Payable = Extract<Flow, { kind: 'checkout' | 'upgrade_payment' }>;
type Verifiable = Payable | Extract<Flow, { kind: 'status' }>;
type Phase = 'preparing' | 'ready' | 'confirming' | 'checking' | 'pending' | 'failed' | 'expired' | 'active' | 'manage' | 'error';
type Operation = { controller: AbortController; generation: number };
type CheckoutProps = { open: boolean; onOpenChange(open: boolean): void; owner: string; plan: PaidPlan; onConfirmed?(): Promise<void> | void };
type SessionHandle = { close(): void };

const appearance: Appearance = {
  theme: 'night', variables: { colorPrimary: '#EF5066', colorBackground: '#17181d', colorText: '#f6f6f8', colorDanger: '#ff8b91', fontFamily: 'Inter, system-ui, sans-serif', borderRadius: '10px', spacingUnit: '4px' },
  rules: { '.Input': { boxShadow: 'none', border: '1px solid #363840' }, '.Input:focus': { borderColor: '#EF5066', boxShadow: '0 0 0 1px #EF5066' }, '.Label': { fontWeight: '500' }, '.Tab': { border: '1px solid #363840', boxShadow: 'none' }, '.Tab--selected': { borderColor: '#EF5066' } },
};
const paymentOptions = { layout: 'tabs' as const };
const planName = (plan: PaidPlan) => plan === 'premium' ? 'Premium' : 'Pro';
function money(amount: number, currency: string) {
  const formatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() });
  return formatter.format(amount / 10 ** formatter.resolvedOptions().maximumFractionDigits);
}
function returnURL(flow: Payable) {
  const url = new URL('/conta', window.location.origin);
  if (flow.kind === 'checkout') url.searchParams.set('billing_session_id', flow.sessionId);
  else { url.searchParams.set('billing_subscription_id', flow.subscriptionId); if (flow.paymentIntentId) url.searchParams.set('billing_payment_intent_id', flow.paymentIntentId); }
  return url.href;
}
function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Operação cancelada.', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
function awaitConfirmation(confirm: () => Promise<string | null>, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout>;
  let abort: () => void;
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Operação cancelada.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error('Confirmação pendente.')), 120_000);
  });
  const confirmation = Promise.resolve().then(() => { if (signal.aborted) throw new DOMException('Operação cancelada.', 'AbortError'); return confirm(); });
  return Promise.race([confirmation, interrupted]).finally(() => { clearTimeout(timer); signal.removeEventListener('abort', abort); });
}

function PlanSummary({ flow }: { flow: Extract<Flow, { amountDue: number }> }) {
  return <section className="sc-checkout-summary" aria-label="Resumo da assinatura">
    <div><span className="sc-checkout-plan"><Crown size={17} />Classfy {planName(flow.plan)}</span><strong>{money(flow.recurringAmount, flow.currency)}<small>/ mês</small></strong></div>
    <div className="sc-checkout-due"><span>{flow.kind === 'upgrade_quote' || flow.kind === 'upgrade_payment' ? 'Ajuste do período atual · hoje' : 'Total de hoje'}</span><b>{money(flow.amountDue, flow.currency)}</b></div>
    {(flow.kind === 'upgrade_quote' || flow.kind === 'upgrade_payment') && <p>O valor considera a mudança do plano Pro para o Premium neste período.</p>}
  </section>;
}

type FormProps = { flow: Payable; busy: boolean; submit(confirm: () => Promise<string | null>): void };
function CheckoutForm({ flow, busy, submit }: FormProps) {
  const result = useCheckout(), [ready, setReady] = useState(false), [loadError, setLoadError] = useState(false);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !ready || result.type !== 'success') return;
    submit(async () => {
      const response = await result.checkout.confirm({ returnUrl: returnURL(flow), redirect: 'if_required' });
      return response.type === 'error' ? response.error.message : null;
    });
  };
  return <form className="sc-checkout-form" onSubmit={onSubmit}>
    {result.type === 'error' ? <p className="sc-checkout-error" role="alert">Não foi possível carregar o formulário de pagamento. Tente recarregá-lo.</p> : <CheckoutPaymentElement options={paymentOptions} onReady={() => { setReady(true); setLoadError(false); }} onLoadError={() => { setReady(false); setLoadError(true); }} />}
    {loadError && <p className="sc-checkout-error" role="alert">O formulário de pagamento não carregou. Tente recarregá-lo.</p>}
    <button className="sc-checkout-primary" type="submit" disabled={busy || !ready || result.type !== 'success'}>{busy ? <Loader2 size={18} className="sc-checkout-spin" /> : <LockKeyhole size={17} />}Confirmar assinatura<span>{money(flow.amountDue, flow.currency)}</span></button>
  </form>;
}
function UpgradePaymentForm({ flow, busy, submit }: FormProps) {
  const stripe = useStripe(), elements = useElements(), [ready, setReady] = useState(false), [loadError, setLoadError] = useState(false);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || !ready || !stripe || !elements || flow.kind !== 'upgrade_payment' || !flow.clientSecret) return;
    submit(async () => {
      const response = await stripe.confirmPayment({ elements, clientSecret: flow.clientSecret!, confirmParams: { return_url: returnURL(flow) }, redirect: 'if_required' });
      return response.error ? response.error.message ?? 'O pagamento não foi confirmado. Confira os dados e tente novamente.' : null;
    });
  };
  return <form className="sc-checkout-form" onSubmit={onSubmit}>
    <PaymentElement options={paymentOptions} onReady={() => { setReady(true); setLoadError(false); }} onLoadError={() => { setReady(false); setLoadError(true); }} />
    {loadError && <p className="sc-checkout-error" role="alert">O formulário de pagamento não carregou. Tente recarregá-lo.</p>}
    <button className="sc-checkout-primary" type="submit" disabled={busy || !stripe || !elements || !ready}>{busy ? <Loader2 size={18} className="sc-checkout-spin" /> : <LockKeyhole size={17} />}Confirmar pagamento<span>{money(flow.amountDue, flow.currency)}</span></button>
  </form>;
}

function UpgradeAuthentication({ stripe, flow, busy, submit }: FormProps & { stripe: Stripe }) {
  return <section className="sc-checkout-quote">
    <p>Seu banco precisa autenticar este pagamento. Continue para concluir a confirmação do mesmo cartão.</p>
    <button className="sc-checkout-primary" type="button" disabled={busy} onClick={() => {
      if (busy || !flow.clientSecret) return;
      submit(async () => {
        const response = await stripe.handleNextAction({ clientSecret: flow.clientSecret! });
        return response.error ? response.error.message ?? 'A autenticação não foi concluída. Tente novamente.' : null;
      });
    }}>{busy ? <Loader2 size={18} className="sc-checkout-spin" /> : <LockKeyhole size={17} />}Autenticar pagamento</button>
  </section>;
}

function StripeForm({ flow, busy, submit }: FormProps) {
  const [reload, setReload] = useState(0), [stripe, setStripe] = useState<Stripe | null>(null), [sdkError, setSDKError] = useState(false);
  const checkoutOptions = useMemo(() => ({ clientSecret: flow.clientSecret!, elementsOptions: { appearance } }), [flow.clientSecret]);
  const elementsOptions = useMemo(() => ({ clientSecret: flow.clientSecret!, appearance, locale: 'pt-BR' as const }), [flow.clientSecret]);
  useEffect(() => {
    let active = true; setStripe(null); setSDKError(false);
    void loadBillingStripe(flow.publishableKey).then(value => { if (active) { setStripe(value); setSDKError(!value); } }, () => { if (active) setSDKError(true); });
    return () => { active = false; };
  }, [flow.publishableKey, reload]);
  return <section className="sc-checkout-payment" aria-label="Pagamento seguro">
    {sdkError ? <p className="sc-checkout-error" role="alert">Não foi possível carregar o pagamento seguro. Confira sua conexão e tente novamente.</p> : !stripe ? <div className="sc-checkout-loading" role="status"><Loader2 size={20} className="sc-checkout-spin" />Carregando pagamento seguro…</div> : flow.kind === 'checkout' ? <CheckoutProvider key={reload} stripe={stripe} options={checkoutOptions}><CheckoutForm flow={flow} busy={busy} submit={submit} /></CheckoutProvider> : flow.status === 'requires_action' ? <UpgradeAuthentication stripe={stripe} flow={flow} busy={busy} submit={submit} /> : <Elements key={reload} stripe={stripe} options={elementsOptions}><UpgradePaymentForm flow={flow} busy={busy} submit={submit} /></Elements>}
    <button className="sc-checkout-text-button" type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>Recarregar formulário</button>
  </section>;
}

const CheckoutSession = forwardRef<SessionHandle, { owner: string; plan: PaidPlan; isCurrent(): boolean; onConfirmed?(): Promise<void> | void; onAuthenticationChange(active: boolean): void }>(function CheckoutSession({ owner, plan, isCurrent, onConfirmed, onAuthenticationChange }, ref) {
  const [flow, setFlow] = useState<Flow | null>(null), [phase, setPhase] = useState<Phase>('preparing'), [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const alive = useRef(false), generation = useRef(0), operation = useRef<Operation | null>(null), flowRef = useRef<Flow | null>(null), confirmed = useRef(false);
  const ids = useRef({ prepare: crypto.randomUUID(), upgrade: crypto.randomUUID() });
  const latest = useRef({ isCurrent, onConfirmed }); latest.current = { isCurrent, onConfirmed };
  const fresh = (owned?: Operation) => alive.current && latest.current.isCurrent() && (!owned || operation.current === owned && generation.current === owned.generation && !owned.controller.signal.aborted);
  const reserve = () => {
    if (!fresh() || operation.current) return null;
    const owned = { controller: new AbortController(), generation: ++generation.current }; operation.current = owned; return owned;
  };
  const release = (owned: Operation) => { if (operation.current === owned) operation.current = null; };
  const stopWork = () => { alive.current = false; ++generation.current; operation.current?.controller.abort(); operation.current = null; };
  useLayoutEffect(() => { alive.current = true; return stopWork; }, []);
  // Closing the modal interrupts only local work. Stripe payments remain
  // resumable; dismissing this UI is not an instruction to cancel payment.
  useImperativeHandle(ref, () => ({ close: stopWork }));

  const acceptActive = async (owned: Operation) => {
    if (!fresh(owned)) return;
    setPhase('active'); setError(null); setMessage(null);
    if (confirmed.current) return; confirmed.current = true;
    try { await latest.current.onConfirmed?.(); }
    catch { if (fresh(owned)) setError('Seu plano foi confirmado. Não conseguimos atualizar esta página; tente atualizar o plano novamente.'); }
  };
  const verify = async (target: Verifiable, owned: Operation, automatic = true) => {
    const delays = automatic ? [0, 1200, 2200, 3500] : [0];
    for (const delay of delays) {
      if (delay) await wait(delay, owned.controller.signal);
      if (!fresh(owned)) return;
      if (document.visibilityState === 'hidden') { setPhase('pending'); setMessage('Volte a esta página para verificar a confirmação do pagamento.'); return; }
      const result = await readSubscriptionCheckoutStatus(owner, target, owned.controller.signal);
      if (!fresh(owned)) return;
      if (result.state === 'active') { await acceptActive(owned); return; }
      if (result.state === 'failed' || result.state === 'expired') { setPhase(result.state); setError(result.message ?? (result.state === 'expired' ? 'Este pagamento expirou. Abra uma nova tentativa para continuar.' : 'O pagamento não foi confirmado. Verifique o status antes de tentar novamente.')); return; }
      setMessage(result.message ?? 'Estamos aguardando a confirmação do pagamento. Seu plano será liberado quando o servidor confirmar.');
    }
    if (fresh(owned)) setPhase('pending');
  };
  const prepare = async (restart = false) => {
    const owned = reserve(); if (!owned) return;
    if (restart) ids.current = { prepare: crypto.randomUUID(), upgrade: crypto.randomUUID() };
    setPhase('preparing'); setError(null); setMessage(null);
    try {
      const result = await prepareSubscriptionCheckout(owner, plan, ids.current.prepare, owned.controller.signal);
      if (!fresh(owned)) return; flowRef.current = result; setFlow(result);
      if (result.kind === 'active') await acceptActive(owned);
      else if (result.kind === 'manage') { setPhase('manage'); setMessage(result.message); }
      else if (result.kind === 'status') {
        if (result.state === 'active') await acceptActive(owned);
        else if (result.state === 'pending') { setPhase('checking'); await verify(result, owned); }
        else { setPhase(result.state); setError(result.message ?? (result.state === 'expired' ? 'Este pagamento expirou. Abra uma nova tentativa para continuar.' : 'O pagamento não foi confirmado.')); }
      }
      else if (result.kind === 'upgrade_payment') {
        if (result.clientSecret && ['requires_action', 'requires_payment_method'].includes(result.status)) setPhase('ready');
        else { setPhase('checking'); await verify(result, owned); }
      }
      else setPhase('ready');
    } catch (cause) { if (fresh(owned)) { setPhase('error'); setError(cause instanceof Error ? cause.message : 'Não foi possível preparar o pagamento. Tente novamente.'); } }
    finally { release(owned); }
  };
  const prepareRef = useRef(prepare); prepareRef.current = prepare;
  useEffect(() => { void prepareRef.current(); }, []);
  const upgrade = async () => {
    const quote = flowRef.current; if (quote?.kind !== 'upgrade_quote') return;
    if (new Date(quote.expiresAt).getTime() <= Date.now()) { setPhase('expired'); setError('O valor deste upgrade expirou. Atualize o valor antes de confirmar.'); return; }
    const owned = reserve(); if (!owned) return;
    setPhase('confirming'); setError(null); setMessage(null);
    try {
      const result = await confirmSubscriptionUpgrade(owner, quote.quoteToken, ids.current.upgrade, owned.controller.signal);
      if (!fresh(owned)) return; flowRef.current = result; setFlow(result);
      if (result.clientSecret && ['requires_action', 'requires_payment_method'].includes(result.status)) setPhase('ready');
      else { setPhase('checking'); await verify(result, owned); }
    } catch (cause) { if (fresh(owned)) { setPhase('ready'); setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar o upgrade. Tente novamente.'); } }
    finally { release(owned); }
  };
  const submit = async (confirmPayment: () => Promise<string | null>) => {
    const target = flowRef.current; if (!target || !['checkout', 'upgrade_payment'].includes(target.kind)) return;
    const owned = reserve(); if (!owned) return;
    setPhase('confirming'); setError(null); setMessage(null);
    // The bank's 3DS iframe lives outside this dialog. Release the focus trap
    // before invoking Stripe, while retaining the same form/session tree.
    onAuthenticationChange(true);
    let authenticationOpen = true;
    const restoreFocus = () => { if (authenticationOpen && fresh(owned)) { authenticationOpen = false; onAuthenticationChange(false); } };
    try {
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); }
        catch { if (fresh(owned)) { setPhase('ready'); setError('Saia da tela cheia para confirmar o pagamento com seu banco.'); } return; }
      }
      if (!fresh(owned)) return;
      const paymentError = await awaitConfirmation(confirmPayment, owned.controller.signal);
      restoreFocus();
      if (!fresh(owned)) return;
      if (paymentError) { setPhase('ready'); setError(paymentError); return; }
      setPhase('checking'); await verify(target as Payable, owned);
    } catch { if (fresh(owned)) { setPhase('pending'); setError('Não conseguimos confirmar o resultado. Verifique o pagamento antes de tentar novamente.'); } }
    finally { restoreFocus(); release(owned); }
  };
  const checkStatus = async () => {
    const target = flowRef.current; if (!target || target.kind !== 'checkout' && target.kind !== 'upgrade_payment' && target.kind !== 'status') return;
    const owned = reserve(); if (!owned) return;
    setPhase('checking'); setError(null);
    try { await verify(target, owned); }
    catch { if (fresh(owned)) { setPhase('pending'); setError('Não foi possível verificar agora. Confira sua conexão e tente novamente.'); } }
    finally { release(owned); }
  };
  const refreshConfirmed = async () => {
    const owned = reserve(); if (!owned) return; setError(null);
    try { await latest.current.onConfirmed?.(); }
    catch { if (fresh(owned)) setError('Não foi possível atualizar esta página. Seu pagamento continua confirmado.'); }
    finally { release(owned); }
  };
  const busy = ['preparing', 'confirming', 'checking'].includes(phase), payable = flow?.kind === 'checkout' || flow?.kind === 'upgrade_payment' ? flow : null;
  const showForm = payable && payable.clientSecret && ['ready', 'confirming'].includes(phase);
  return <div className="sc-checkout-body" aria-busy={busy}>
    {flow && 'amountDue' in flow && <PlanSummary flow={flow} />}
    {phase === 'preparing' && <div className="sc-checkout-loading" role="status"><Loader2 size={23} className="sc-checkout-spin" /><strong>Preparando sua assinatura…</strong><span>Confirmando o plano e o valor com o servidor.</span></div>}
    {error && <p className="sc-checkout-error" role="alert">{error}</p>}
    {phase === 'active' ? <section className="sc-checkout-result"><CheckCircle2 size={42} /><h3>Plano confirmado.</h3><p>Sua assinatura {planName(plan)} está ativa.</p>{error && <button className="sc-checkout-secondary" onClick={() => void refreshConfirmed()}>Atualizar plano</button>}</section> : phase === 'manage' ? <section className="sc-checkout-result"><CreditCard size={34} /><h3>Gerencie sua assinatura.</h3><p>{message}</p><a className="sc-checkout-secondary" href="/conta">Abrir minha Conta</a></section> : <>
      {flow?.kind === 'upgrade_quote' && ['ready', 'confirming'].includes(phase) && <section className="sc-checkout-quote"><p>Ao confirmar, tentaremos cobrar este ajuste no método de pagamento salvo da sua assinatura.</p><button className="sc-checkout-primary" type="button" disabled={busy} onClick={() => void upgrade()}>{busy ? <Loader2 size={18} className="sc-checkout-spin" /> : <Check size={18} />}Confirmar upgrade<span>{money(flow.amountDue, flow.currency)} hoje</span></button></section>}
      {showForm && <StripeForm flow={payable} busy={busy} submit={confirmPayment => { void submit(confirmPayment); }} />}
      {['checking', 'pending', 'failed'].includes(phase) && <section className="sc-checkout-status" role="status">{phase === 'checking' && <Loader2 size={22} className="sc-checkout-spin" />}<h3>{phase === 'checking' ? 'Confirmando o pagamento…' : phase === 'pending' ? 'A confirmação ainda está em andamento.' : 'Pagamento não confirmado.'}</h3><p>{message ?? 'Vamos conferir o resultado com o servidor antes de liberar seu plano.'}</p><button type="button" className="sc-checkout-secondary" disabled={busy} onClick={() => void checkStatus()}><RefreshCw size={16} />Verificar pagamento</button></section>}
      {phase === 'expired' && <button className="sc-checkout-primary" type="button" onClick={() => void prepare(true)}>Atualizar pagamento</button>}
      {phase === 'error' && <button className="sc-checkout-secondary" type="button" onClick={() => void prepare()}><RefreshCw size={16} />Tentar novamente</button>}
    </>}
    {flow && 'recurringAmount' in flow && phase !== 'active' && <p className="sc-checkout-terms">Renovação automática mensal de {money(flow.recurringAmount, flow.currency)}. Você pode cancelar pela sua Conta.</p>}
    <p className="sc-checkout-security"><ShieldCheck size={14} />Pagamento protegido pelo Stripe. A Classfy não recebe os dados do seu cartão.</p>
  </div>;
});

/** Account identity changes dismiss the old flow; they never open a checkout for the new account. */
export function SubscriptionCheckoutDialog({ open, onOpenChange, owner, plan, onConfirmed }: CheckoutProps) {
  const [identity, setIdentity] = useState(() => open && owner ? { owner, plan, id: crypto.randomUUID() } : null);
  const [container, setContainer] = useState<Element | null>(() => document.fullscreenElement);
  const [authenticating, setAuthenticating] = useState(false);
  const authentication = useRef(false), lastFocused = useRef<HTMLElement | null>(null);
  const session = useRef<SessionHandle | null>(null), previousOpen = useRef(open), trigger = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null), dialog = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ owner, plan, open, onOpenChange }); latest.current = { owner, plan, open, onOpenChange };
  const valid = !!identity && open && identity.owner === owner && identity.plan === plan && !!owner;
  useLayoutEffect(() => {
    if (!open) { previousOpen.current = false; authentication.current = false; setIdentity(null); setAuthenticating(false); return; }
    if (identity && (identity.owner !== owner || identity.plan !== plan) || !owner) { latest.current.onOpenChange(false); return; }
    if (!previousOpen.current || !identity) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      previousOpen.current = true; authentication.current = false; setContainer(document.fullscreenElement); setAuthenticating(false); setIdentity({ owner, plan, id: crypto.randomUUID() });
    }
  }, [open, owner, plan, identity]);
  useEffect(() => {
    // Changing the portal container during Stripe's challenge would remount
    // the Checkout and destroy its in-flight confirmation.
    const update = () => { if (!latest.current.open) setContainer(document.fullscreenElement); };
    document.addEventListener('fullscreenchange', update); return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  useEffect(() => {
    if (!valid) return;
    // Radix non-modal keeps the stable content and tab loop. This scoped trap
    // yields synchronously only to Stripe's external authentication challenge.
    const focus = (event: FocusEvent) => {
      const content = dialog.current, target = event.target;
      if (!content || authentication.current || !latest.current.open) return;
      if (target instanceof HTMLElement && content.contains(target)) { lastFocused.current = target; return; }
      const previous = lastFocused.current;
      (previous?.isConnected && content.contains(previous) ? previous : content.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]') ?? content).focus({ preventScroll: true });
    };
    document.addEventListener('focusin', focus); return () => document.removeEventListener('focusin', focus);
  }, [valid]);
  const close = () => { session.current?.close(); latest.current.onOpenChange(false); };
  return <Dialog.Root modal={false} open={valid} onOpenChange={value => { if (!value) close(); }}><Dialog.Portal container={container ?? undefined}>
    <div className="sc-checkout-overlay" aria-hidden="true" />
    <Dialog.Content ref={dialog} className="sc-checkout-dialog" aria-modal={!authenticating} onInteractOutside={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); close(); }} onKeyDownCapture={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }} onCloseAutoFocus={event => { if (trigger.current?.isConnected) { event.preventDefault(); trigger.current.focus({ preventScroll: true }); } }}>
      <header className="sc-checkout-header"><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" width="30" height="30" /><div><span>CLASSFY {planName(plan).toUpperCase()}</span><Dialog.Title>Seu próximo passo.</Dialog.Title></div><button type="button" className="sc-checkout-close" aria-label="Fechar pagamento" onClick={close}><X size={19} /></button></header>
      <Dialog.Description className="sc-checkout-description">Confira sua assinatura e confirme o pagamento aqui.</Dialog.Description>
      {valid && identity && <CheckoutSession key={identity.id} ref={session} owner={owner} plan={plan} onConfirmed={onConfirmed} isCurrent={() => latest.current.open && latest.current.owner === identity.owner && latest.current.plan === identity.plan} onAuthenticationChange={value => {
        authentication.current = value;
        flushSync(() => setAuthenticating(value));
        if (!value && latest.current.open && dialog.current && !dialog.current.contains(document.activeElement)) dialog.current.focus({ preventScroll: true });
      }} />}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
