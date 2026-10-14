import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Check, Crown, Loader2, Monitor, RefreshCw, Smartphone, Video, X } from 'lucide-react';
import { PLAN_OFFERS } from '@/config/planOffers';
import { StudioPremiumError, studioPremiumAccess, type StudioPremiumProfile } from '@/lib/studio/editor/entitlementPremium';
import { useSubscriptionCheckout } from '@/components/billing/SubscriptionCheckoutProvider';
import '@/styles/studio-scenes-upgrade.css';
import '@/styles/studio-remote-camera.css';

type Entitlement = {
  canUseScenes: boolean; loading: boolean; error: string | null; profile: StudioPremiumProfile | null;
  refresh(verifySubscription?: boolean): Promise<boolean>;
};
type Props = { open: boolean; onOpenChange(open: boolean): void; owner: string; entitlement: Entitlement; feature?: 'scenes' | 'iphone' };
type Operation = { controller: AbortController };

/** This offer unlocks a Studio recording tool, never content playback. */
export function StudioScenesUpgradeDialog({ open, onOpenChange, owner, entitlement, feature = 'scenes' }: Props) {
  const [busy, setBusy] = useState(false), [failure, setFailure] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const { startSubscription } = useSubscriptionCheckout();
  const [portal, setPortal] = useState<HTMLElement | undefined>(() => document.fullscreenElement as HTMLElement ?? undefined);
  const live = useRef({ mounted: false, open, owner }); live.current.open = open; live.current.owner = owner;
  const operation = useRef<Operation | null>(null);
  useEffect(() => {
    const lifecycle = live.current;
    lifecycle.mounted = true;
    const syncFullscreen = () => setPortal(document.fullscreenElement as HTMLElement ?? undefined);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => { lifecycle.mounted = false; operation.current?.controller.abort(); operation.current = null; document.removeEventListener('fullscreenchange', syncFullscreen); };
  }, []);
  useEffect(() => {
    operation.current?.controller.abort(); operation.current = null;
    setBusy(false); setFailure(null); setNotice(null);
  }, [owner, open]);
  useEffect(() => {
    // A Premium subscriber can tap while the initial check is still pending.
    // Confirmation dismisses the offer; entering scenes remains a fresh click.
    if (open && entitlement.canUseScenes && !entitlement.loading) onOpenChange(false);
  }, [open, entitlement.canUseScenes, entitlement.loading, onOpenChange]);

  const run = async (action: 'checkout' | 'verify') => {
    if (operation.current || !open || !live.current.mounted || entitlement.loading) return;
    if (action === 'checkout') {
      onOpenChange(false);
      startSubscription('premium', async () => {
        const active = await entitlement.refresh(true);
        // Keep the confirmed payment visible until this owner's Studio access
        // is confirmed too. A delayed profile must not invite another charge.
        if (!active && live.current.mounted && live.current.owner === owner) {
          throw new StudioPremiumError('Seu pagamento foi confirmado. Atualize o acesso para liberar o Premium no Studio.');
        }
      });
      return;
    }
    const current: Operation = { controller: new AbortController() };
    operation.current = current; setBusy(true); setFailure(null); setNotice(null);
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
    } catch (cause) {
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
        <Dialog.Close id="sce-upgrade-close" className="sce-upgrade-close" aria-label={feature === 'iphone' ? 'Fechar oferta de câmera remota' : 'Fechar oferta de cenas'}><X size={20} /></Dialog.Close>
        <div className="sce-upgrade-brand"><Crown size={17} /> STUDIO PREMIUM</div>
        <Dialog.Title className="sce-upgrade-title">{feature === 'iphone' ? 'Seu iPhone vira câmera Pro.' : 'Gravação com cenas'}</Dialog.Title>
        <Dialog.Description className="sce-upgrade-description">{feature === 'iphone' ? 'Enquadre no computador, grave no iPhone e receba seu original direto no Studio.' : 'Alterne câmera, tela e os dois juntos no mesmo take. Assine aqui e continue sua preparação.'}</Dialog.Description>
        {feature === 'iphone' ? <div className="src-upgrade-visual" aria-label="Câmera remota do iPhone"><Smartphone size={58} strokeWidth={1.1} /><ArrowRight size={22} /><span><strong>Original até 4K</strong>Prévia no seu computador<small>Captura nativa. Sem placa de captura.</small></span><i>STUDIO × IPHONE</i></div> : <div className="sce-upgrade-scenes" aria-label="Três cenas de gravação">
          <div><div className="sce-upgrade-scene sce-upgrade-scene--camera"><span className="sce-upgrade-person" /></div><strong><Video size={14} /> Câmera</strong></div>
          <div><div className="sce-upgrade-scene sce-upgrade-scene--screen"><span className="sce-upgrade-screen"><i /><i /><i /></span></div><strong><Monitor size={14} /> Tela</strong></div>
          <div><div className="sce-upgrade-scene sce-upgrade-scene--both"><span className="sce-upgrade-screen"><i /><i /><i /></span><span className="sce-upgrade-pip"><span className="sce-upgrade-person" /></span></div><strong><Video size={14} /> Tela + câmera</strong></div>
        </div>}
        <ul className="sce-upgrade-benefits">
          {feature === 'iphone' ? <><li><Check size={16} /> Original gravado no iPhone, em até 4K.</li><li><Check size={16} /> Controle REC, exposição, foco e balanço de branco.</li><li><Check size={16} /> Continue com seu original mesmo se a prévia oscilar.</li></> : <><li><Check size={16} /> Troque de cena sem encerrar o take.</li><li><Check size={16} /> Ajuste a posição e o tamanho da câmera sobre a tela.</li><li><Check size={16} /> Apresente demonstrações e volte à câmera no mesmo vídeo.</li></>}
        </ul>
        <div className="sce-upgrade-offer"><div><span>PLANO {PLAN_OFFERS.premium.title.toUpperCase()}</span><p><strong>R$ {PLAN_OFFERS.premium.price}</strong> / mês</p></div><span className="sce-upgrade-plan">Seu plano: {plan}</span></div>
        {(failure || entitlement.error) && <p className="sce-upgrade-error" role="alert">{failure ?? entitlement.error}</p>}
        {notice && <p className="sce-upgrade-notice" role="status">{notice}</p>}
        <button type="button" className="sce-upgrade-primary" disabled={busy || entitlement.loading || !entitlement.profile} onClick={() => void run('checkout')}>{busy ? <Loader2 className="sce-upgrade-spinner" size={17} /> : <Crown size={17} />}{actionLabel}<ArrowRight size={18} /></button>
        <button type="button" className="sce-upgrade-verify" disabled={busy || entitlement.loading} onClick={() => void run('verify')}><RefreshCw size={14} />{busy || entitlement.loading ? 'Verificando…' : entitlement.error ? 'Tentar confirmar plano' : 'Já assinei · Verificar acesso'}</button>
        <Dialog.Close className="sce-upgrade-basic">Continuar com gravação básica</Dialog.Close>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
