import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Crown, Monitor, RefreshCw, Smartphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { GlobalLoader } from '@/components/GlobalLoader';
import { useSubscriptionCheckout } from '@/components/billing/SubscriptionCheckoutProvider';
import { useStudioPremiumEntitlement } from '@/components/studio/editor/useStudioPremiumEntitlement';
import { StudioMonitorWorkspace } from '@/components/studio/editor/StudioMonitorWorkspace';
import '@/styles/studio-monitor.css';

function StudioMonitorSession({ owner }: { owner: string }) {
  const entitlement = useStudioPremiumEntitlement(owner), { startSubscription } = useSubscriptionCheckout(), navigate = useNavigate();
  const [notice, setNotice] = useState<string | null>(null);
  if (entitlement.loading) return <GlobalLoader label="Abrindo monitor do iPhone" />;
  if (entitlement.canUseScenes) return <StudioMonitorWorkspace key={owner} owner={owner} />;
  return <div className="scm-monitor"><header className="scm-header"><div className="scm-heading"><button type="button" aria-label="Voltar ao Studio" onClick={() => navigate('/studio')}><ArrowLeft size={20} /></button><Monitor size={21} className="scm-mark" /><div><span>CLASSFY STUDIO</span><h1>Monitor do iPhone</h1></div></div></header><main className="scm-offer"><div className="scm-offer-badge"><Crown size={16} fill="currentColor" /> PREMIUM</div><div className="scm-offer-visual"><Smartphone size={70} strokeWidth={1.1} /><Monitor size={110} strokeWidth={1.1} /></div><h2>Grave no iPhone.<br />Veja sua cena no computador.</h2><p>Use a câmera traseira e acompanhe seu enquadramento em uma tela maior, com o controle da gravação no iPhone.</p>{entitlement.error && <p className="scm-error" role="alert">{entitlement.error}</p>}{notice && <p role="status">{notice}</p>}<button className="scm-offer-primary" type="button" disabled={!entitlement.profile} onClick={() => startSubscription('premium', async () => { if (!await entitlement.refresh(true)) throw new Error('Atualize o acesso para abrir seu monitor.'); })}><Crown size={17} fill="currentColor" />Ativar Premium</button><button className="scm-offer-check" type="button" onClick={() => { void entitlement.refresh(!entitlement.error).then(active => { if (!active) setNotice('O Premium ainda não foi confirmado.'); }); }}><RefreshCw size={14} />{entitlement.error ? 'Confirmar acesso' : 'Já assinei · Verificar acesso'}</button></main></div>;
}
export default function StudioMonitor() {
  const { user, role, loading } = useAuth();
  if (loading) return <GlobalLoader label="Abrindo monitor do iPhone" />;
  if (!user) return <Navigate to="/auth" replace />;
  if (role !== 'creator' && role !== 'admin') return <Navigate to="/" replace />;
  return <StudioMonitorSession key={user.id} owner={user.id} />;
}
