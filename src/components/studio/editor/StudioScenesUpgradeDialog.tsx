import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, Crown, Loader2, Monitor, RefreshCw, Video, X } from 'lucide-react';
import { PLAN_OFFERS } from '@/config/planOffers';
import { requestStudioPremiumCheckout, StudioPremiumError, studioPremiumAccess, type StudioPremiumProfile } from '@/lib/studio/editor/entitlementPremium';
import '@/styles/studio-scenes-upgrade.css';

type Entitlement = {
  canUseScenes: boolean; loading: boolean; error: string | null; profile: StudioPremiumProfile | null;
  refresh(verifySubscription?: boolean): Promise<boolean>;
};
type Props = { open: boolean; onOpenChange(open: boolean): void; owner: string; entitlement: Entitlement };
type Operation = { controller: AbortController; popup: Window | null };

/** This offer unlocks a Studio recording tool, never content playback. */
export function StudioScenesUpgradeDialog({ open, onOpenChange, owner, entitlement }: Props) {
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [portal, setPortal] = useState<HTMLElement | undefined>(() => document.fullscreenElement as HTMLElement ?? undefined);
  const live = useRef({ mounted: false, open, owner }); live.current.open = open; live.current.owner = owner;
  const operation = useRef<Operation | null>(null);
  useEffect(() => {
    const lifecycle = live.current;
    lifecycle.mounted = true;
    const syncFullscreen = () => setPortal(document.fullscreenElement as HTMLElement ?? undefined);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => { lifecycle.mounted = false; operation.current?.controller.abort(); operation.current?.popup?.close(); operation.current = null; document.removeEventListener('fullscreenchange', syncFullscreen); };
  }, []);
  useEffect(() => {
    operation.current?.controller.abort(); operation.current?.popup?.close(); operation.current = null;
    setBusy(false); setFailure(null); setNotice(null); setCheckoutUrl(null);
  }, [owner, open]);
  useEffect(() => {
    // A Premium subscriber can tap while the initial check is still pending.
    // Confirmation dismisses the offer; entering scenes remains a fresh click.
    if (open && entitlement.canUseScenes && !entitlement.loading) onOpenChange(false);
  }, [open, entitlement.canUseScenes, entitlement.loading, onOpenChange]);

  const run = async (action: 'checkout' | 'verify') => {
    if (operation.current || !open || !live.current.mounted || entitlement.loading) return;
    const current: Operation = { controller: new AbortController(), popup: null };
    operation.current = current; setBusy(true); setFailure(null); setNotice(null); setCheckoutUrl(null);
    const isCurrent = () => live.current.mounted && live.current.open && live.current.owner === owner && operation.current === current;
    try {
      if (action === 'verify') {
        // A failed profile read needs a fresh read, not a dependency on Stripe.
        // "Já assinei" explicitly reconciles billing when the profile is known.
        const active = await entitlement.refresh(!entitlement.error);
        if (!isCurrent()) return;
        if (active) onOpenChange(false);
        else setNotice('O Premium ainda não foi confirmado. A gravação básica continua disponível.');
        return;
      }
      // Reserve a tab inside the user's click; delayed window.open is blocked
      // by browsers. Only the official checkout response can navigate this tab.
      try { current.popup = window.open('about:blank', '_blank'); if (current.popup) current.popup.opener = null; } catch { current.popup = null; }
      const result = await requestStudioPremiumCheckout(owner, { signal: current.controller.signal, isCurrent });
      if (!isCurrent()) return;
      if (result.alreadyActive) {
        current.popup?.close(); current.popup = null;
        if (await entitlement.refresh() && isCurrent()) onOpenChange(false);
      } else if (result.url) {
        if (current.popup && !current.popup.closed) { current.popup.location.replace(result.url); current.popup = null; }
        else { current.popup = null; setCheckoutUrl(result.url); }
        setNotice('Conclua a assinatura e volte aqui para verificar o acesso.');
      } else {
        current.popup?.close(); current.popup = null; setNotice(result.message ?? 'Solicitação recebida. Verifique sua assinatura após a confirmação.');
      }
    } catch (cause) {
      current.popup?.close(); current.popup = null;
      if (isCurrent()) setFailure(cause instanceof StudioPremiumError ? cause.message : 'Não foi possível confirmar a solicitação. Tente verificar sua assinatura.');
    } finally { if (operation.current === current) { operation.current = null; if (isCurrent()) setBusy(false); else if (live.current.mounted && live.current.owner === owner) setBusy(false); } }
  };
  const access = studioPremiumAccess(entitlement.profile);
  const plan = entitlement.loading ? 'Confirmando plano…' : entitlement.error || !entitlement.profile ? 'Plano ainda não confirmado' : access.effectivePlan === 'premium' ? 'Premium' : access.effectivePlan === 'pro' ? 'Pro' : 'Free';
  const manage = entitlement.profile?.entitlement_source === 'stripe' && entitlement.profile.plan === 'premium' && !!entitlement.profile.stripe_subscription_id;
  const actionLabel = manage ? 'Gerenciar assinatura' : access.effectivePlan === 'pro' ? 'Mudar para Premium' : 'Ativar Premium';
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal container={portal}>
      <Dialog.Overlay className="sce-upgrade-overlay" />
      <Dialog.Content className="sce-upgrade" onOpenAutoFocus={event => { event.preventDefault(); document.getElementById('sce-upgrade-close')?.focus(); }}>
        <Dialog.Close id="sce-upgrade-close" className="sce-upgrade-close" aria-label="Fechar oferta de cenas"><X size={20} /></Dialog.Close>
        <div className="sce-upgrade-brand"><Crown size={17} /> STUDIO PREMIUM</div>
        <Dialog.Title className="sce-upgrade-title">Gravação com cenas</Dialog.Title>
        <Dialog.Description className="sce-upgrade-description">Sua aula acompanha o que você está mostrando. Alterne a apresentação enquanto grava.</Dialog.Description>
        <div className="sce-upgrade-scenes" aria-label="Três cenas de gravação">
          <div><div className="sce-upgrade-scene sce-upgrade-scene--camera"><span className="sce-upgrade-person" /></div><strong><Video size={14} /> Câmera</strong></div>
          <div><div className="sce-upgrade-scene sce-upgrade-scene--screen"><span className="sce-upgrade-screen"><i /><i /><i /></span></div><strong><Monitor size={14} /> Tela</strong></div>
          <div><div className="sce-upgrade-scene sce-upgrade-scene--both"><span className="sce-upgrade-screen"><i /><i /><i /></span><span className="sce-upgrade-pip"><span className="sce-upgrade-person" /></span></div><strong><Video size={14} /> Tela + câmera</strong></div>
        </div>
        <ul className="sce-upgrade-benefits">
          <li><Check size={16} /> Troque de cena sem encerrar o take.</li>
          <li><Check size={16} /> Ajuste a posição e o tamanho da câmera sobre a tela.</li>
          <li><Check size={16} /> Apresente demonstrações e volte à câmera no mesmo vídeo.</li>
        </ul>
        <div className="sce-upgrade-offer"><div><span>PLANO {PLAN_OFFERS.premium.title.toUpperCase()}</span><p><strong>R$ {PLAN_OFFERS.premium.price}</strong> / mês</p></div><span className="sce-upgrade-plan">Seu plano: {plan}</span></div>
        {(failure || entitlement.error) && <p className="sce-upgrade-error" role="alert">{failure ?? entitlement.error}</p>}
        {notice && <p className="sce-upgrade-notice" role="status">{notice}</p>}
        {checkoutUrl && <a className="sce-upgrade-checkout" href={checkoutUrl} target="_blank" rel="noopener noreferrer">Abrir assinatura segura <ArrowRight size={16} /></a>}
        <button type="button" className="sce-upgrade-primary" disabled={busy || entitlement.loading || !entitlement.profile} onClick={() => void run('checkout')}>{busy ? <Loader2 className="sce-upgrade-spinner" size={17} /> : <Crown size={17} />}{actionLabel}<ArrowRight size={18} /></button>
        <button type="button" className="sce-upgrade-verify" disabled={busy || entitlement.loading} onClick={() => void run('verify')}><RefreshCw size={14} />{busy || entitlement.loading ? 'Verificando…' : entitlement.error ? 'Tentar confirmar plano' : 'Já assinei · Verificar acesso'}</button>
        <Dialog.Close className="sce-upgrade-basic">Continuar com gravação básica</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
