import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, CalendarDays, Check, CreditCard, ExternalLink, Loader2, ReceiptText, RefreshCw } from 'lucide-react';
import { formatSubscriptionBillingAmount, readSubscriptionBilling, type SubscriptionBillingFilter, type SubscriptionBillingPage, type SubscriptionInvoice } from '@/lib/billing/subscriptionBilling';
import '@/styles/subscription-billing.css';

export type SubscriptionBillingPanelProps = { ownerId: string; onViewPlan: () => void };
const filters: { id: SubscriptionBillingFilter; label: string }[] = [{ id: 'all', label: 'Todas' }, { id: 'paid', label: 'Pagas' }, { id: 'pending', label: 'Pendentes' }];
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
const statuses: Record<string, string> = { active: 'Ativa', trialing: 'Período de teste', past_due: 'Pagamento pendente', unpaid: 'Pagamento pendente', incomplete: 'Aguardando pagamento', incomplete_expired: 'Pagamento expirado', canceled: 'Encerrada', paused: 'Pausada' };
const brands: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', elo: 'Elo', discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay' };
function invoiceStatus(invoice: SubscriptionInvoice) {
  if (invoice.status === 'paid') return { label: 'Paga', kind: 'paid' };
  if (invoice.status === 'void') return { label: 'Cancelada', kind: 'neutral' };
  if (invoice.status === 'draft') return { label: 'Em preparação', kind: 'neutral' };
  if (invoice.status === 'uncollectible') return { label: 'Não paga', kind: 'pending' };
  if (invoice.dueAt && Date.parse(invoice.dueAt) < Date.now() && invoice.amountRemaining > 0) return { label: 'Vencida', kind: 'pending' };
  return { label: 'Pendente', kind: 'pending' };
}
function InvoiceRow({ invoice }: { invoice: SubscriptionInvoice }) {
  const status = invoiceStatus(invoice);
  const name = invoice.plan ? `Assinatura Classfy ${invoice.plan === 'premium' ? 'Premium' : 'Pro'}` : 'Assinatura Classfy';
  return <li className="sb-invoice" aria-label={`${name}, ${status.label}`}>
    <div className="sb-invoice-date"><time dateTime={invoice.createdAt}>{date(invoice.createdAt)}</time><small>{invoice.number || 'Fatura da assinatura'}</small></div>
    <div className="sb-invoice-description"><strong>{name}</strong>{invoice.status === 'paid' && invoice.paidAt ? <small>Pagamento em {date(invoice.paidAt)}</small> : invoice.dueAt ? <small>Vencimento em {date(invoice.dueAt)}</small> : <small>Cobrança da assinatura</small>}</div>
    <div className="sb-invoice-value"><strong>{formatSubscriptionBillingAmount(invoice.status === 'paid' ? invoice.amountPaid : invoice.amountDue, invoice.currency)}</strong>{invoice.status === 'open' && invoice.amountPaid > 0 && invoice.amountRemaining > 0 && <small>Restam {formatSubscriptionBillingAmount(invoice.amountRemaining, invoice.currency)}</small>}</div>
    <span className={`sb-status sb-status--${status.kind}`}>{status.kind === 'paid' && <Check size={12} aria-hidden="true" />}{status.label}</span>
    <div className="sb-invoice-links">
      {invoice.pdfUrl && <a href={invoice.pdfUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Abrir PDF da fatura ${invoice.number || date(invoice.createdAt)}`}><ArrowDownToLine size={16} aria-hidden="true" /><span>PDF</span></a>}
      {invoice.hostedUrl && <a href={invoice.hostedUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Ver fatura ${invoice.number || date(invoice.createdAt)} no Stripe`}><ExternalLink size={16} aria-hidden="true" /><span>Ver fatura</span></a>}
      {!invoice.pdfUrl && !invoice.hostedUrl && <small>Sem documento disponível</small>}
    </div>
  </li>;
}

/** Keyed by authenticated owner so no previous account's data is painted during a switch. */
export function SubscriptionBillingPanel(props: SubscriptionBillingPanelProps) {
  return <BillingPanel key={props.ownerId} {...props} />;
}
function BillingPanel({ ownerId, onViewPlan }: SubscriptionBillingPanelProps) {
  const [filter, setFilter] = useState<SubscriptionBillingFilter>('all');
  const [result, setResult] = useState<{ filter: SubscriptionBillingFilter; page: SubscriptionBillingPage } | null>(null);
  const page = result?.filter === filter ? result.page : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ epoch: number; controller: AbortController | null }>({ epoch: 0, controller: null });
  const pageRef = useRef(page); pageRef.current = page;
  const current = useRef({ ownerId, filter }); current.current = { ownerId, filter };

  const load = useCallback(async (status: SubscriptionBillingFilter, append = false) => {
    if (append && request.current.controller) return;
    request.current.controller?.abort();
    const controller = new AbortController(), epoch = ++request.current.epoch;
    request.current.controller = controller;
    const cursor = append ? pageRef.current?.nextCursor : undefined;
    setLoading(true); setError(null);
    const owns = () => !controller.signal.aborted && request.current.epoch === epoch && current.current.ownerId === ownerId && current.current.filter === status;
    try {
      const result = await readSubscriptionBilling(ownerId, { status, cursor: cursor || undefined, signal: controller.signal });
      if (!owns()) return;
      setResult(previous => {
        if (!append || previous?.filter !== status) return { filter: status, page: result };
        const ids = new Set(previous.page.invoices.map(invoice => invoice.id));
        return { filter: status, page: { ...result, invoices: [...previous.page.invoices, ...result.invoices.filter(invoice => !ids.has(invoice.id))] } };
      });
    } catch (cause) {
      if (owns()) setError(cause instanceof Error ? cause.message : 'Não foi possível consultar suas cobranças. Tente novamente.');
    } finally {
      if (owns()) { request.current.controller = null; setLoading(false); }
    }
  }, [ownerId]);
  useEffect(() => {
    setResult(null); pageRef.current = null;
    void load(filter);
    const owned = request.current;
    return () => { owned.epoch++; owned.controller?.abort(); owned.controller = null; };
  }, [filter, load]);

  const subscription = page?.subscription;
  const next = subscription?.nextRenewal;
  const method = subscription?.paymentMethod;
  return <section className="sb-panel" aria-label="Cobranças da assinatura" aria-busy={loading}>
    <header className="sb-heading"><div><span className="sb-eyebrow">SUA ASSINATURA</span><h2>Cobranças</h2><p>Consulte os pagamentos e as faturas da sua assinatura Classfy.</p></div><button className="sb-button sb-button--quiet" onClick={onViewPlan}>Ver meu plano<ArrowRight size={16} aria-hidden="true" /></button></header>
    {page && <div className="sb-summary">
      <article className="sb-summary-card"><span><CalendarDays size={17} aria-hidden="true" />Próxima cobrança</span>
        {next ? <><strong>{next.amountDue !== null && next.currency ? formatSubscriptionBillingAmount(next.amountDue, next.currency) : 'Valor a confirmar'}</strong><p>Renovação prevista para {date(next.at)}.</p></> : subscription?.cancelAtPeriodEnd ? <><strong>Renovação desativada</strong><p>{subscription.periodEnd ? `Encerramento previsto para ${date(subscription.periodEnd)}.` : 'Sua assinatura não será renovada automaticamente.'}</p></> : <><strong>Sem cobrança prevista</strong><p>Não há uma mensalidade recorrente confirmada.</p></>}
      </article>
      <article className="sb-summary-card"><span><ReceiptText size={17} aria-hidden="true" />Assinatura</span><strong>{subscription ? `Classfy ${subscription.plan === 'premium' ? 'Premium' : 'Pro'}` : 'Sem assinatura ativa'}</strong><p>{subscription ? statuses[subscription.status] || 'Status a confirmar' : 'Você pode consultar suas faturas anteriores abaixo.'}</p></article>
      <article className="sb-summary-card"><span><CreditCard size={17} aria-hidden="true" />Forma de pagamento</span><strong>{method ? `${brands[method.brand] || 'Cartão'} •••• ${method.last4}` : 'Sem cartão confirmado'}</strong><p>{method ? `Validade ${String(method.expMonth).padStart(2, '0')}/${method.expYear}` : 'Os dados aparecem quando confirmados pelo provedor de pagamento.'}</p></article>
    </div>}
    <div className="sb-history"><div className="sb-history-heading"><h3>Histórico da assinatura</h3><div className="sb-filters" role="group" aria-label="Filtrar cobranças">{filters.map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div></div>
      {error && <div className="sb-error" role="alert"><p>{error}</p><button className="sb-button" onClick={() => void load(filter)} disabled={loading}><RefreshCw size={16} aria-hidden="true" />Tentar novamente</button></div>}
      {loading && !page && <div className="sb-placeholder" role="status"><Loader2 className="sb-spin" size={24} aria-hidden="true" /><strong>Consultando suas cobranças…</strong><p>Buscando as faturas da sua assinatura.</p></div>}
      {page && page.invoices.length > 0 && <><div className="sb-list-heading" aria-hidden="true"><span>Emissão</span><span>Descrição</span><span>Valor</span><span>Status</span><span>Documentos</span></div><ul className="sb-invoices">{page.invoices.map(invoice => <InvoiceRow key={invoice.id} invoice={invoice} />)}</ul></>}
      {page && page.invoices.length === 0 && !loading && <div className="sb-placeholder"><ReceiptText size={30} aria-hidden="true" /><strong>{filter === 'paid' ? 'Nenhuma cobrança paga nesta consulta' : filter === 'pending' ? 'Nenhuma cobrança pendente nesta consulta' : 'Nenhuma cobrança de assinatura por aqui'}</strong><p>{page.nextCursor ? 'Ainda há páginas para consultar no histórico.' : filter === 'all' ? 'As faturas aparecerão aqui quando houver uma cobrança da sua assinatura.' : 'Experimente o filtro Todas para consultar o restante do histórico.'}</p></div>}
      {page?.nextCursor && <div className="sb-pagination"><button className="sb-button" onClick={() => void load(filter, true)} disabled={loading}>{loading ? <><Loader2 className="sb-spin" size={16} aria-hidden="true" />Carregando…</> : 'Carregar mais cobranças'}</button></div>}
    </div>
    <p className="sb-note"><ExternalLink size={13} aria-hidden="true" />Os documentos e detalhes de cada fatura abrem no Stripe.</p>
  </section>;
}
