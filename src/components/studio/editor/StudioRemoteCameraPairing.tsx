import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, Check, Copy, Crown, Loader2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import '@/styles/studio-remote-camera.css';

export function StudioRemoteCameraPairing({ state, onReconnect, disabled = false }: { state: StudioRemoteView; onReconnect(): void; disabled?: boolean }) {
  const [qr, setQR] = useState<string>(), [copied, setCopied] = useState(false), [now, setNow] = useState(Date.now);
  const code = state.pairing?.code;
  useEffect(() => {
    let active = true; setQR(undefined); setCopied(false);
    if (code) void QRCode.toDataURL(`classfy://studio/remote-camera?code=${encodeURIComponent(code)}`, { width: 280, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#101013', light: '#faf8f5' } }).then(value => { if (active) setQR(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [code]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const remaining = Math.max(0, Math.ceil((Date.parse(state.pairing?.expiresAt ?? '') - now) / 1000));
  const connected = !!state.session?.deviceId;
  const copy = async () => { if (!code) return; try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } };
  return <section className="src-pairing" aria-label="Conectar meu iPhone">
    <span className="src-eyebrow"><Crown size={12} /> STUDIO PREMIUM</span>
    <div className="src-pairing-symbol"><Smartphone size={30} /><Camera size={19} /></div>
    <h2>{connected ? 'Seu iPhone está chegando.' : 'Seu iPhone. Sua câmera Pro.'}</h2>
    <p>{connected ? 'Aguarde a prévia da câmera. O original será gravado no aparelho.' : 'Abra o Studio no app Classfy, entre em Câmera remota e leia este código.'}</p>
    {!connected && code && <div className="src-pairing-body">
      <div className="src-qr">{qr ? <img src={qr} alt="Código QR para parear seu iPhone com esta gravação" /> : <Loader2 className="se-spin" size={25} />}</div>
      <div className="src-pairing-code"><small>OU COLE O CÓDIGO NO APP</small><button type="button" aria-label="Copiar código de conexão" onClick={() => void copy()}><strong>{code}</strong>{copied ? <Check size={15} /> : <Copy size={15} />}</button><span>{copied ? 'Código copiado' : remaining ? `Válido por ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Código expirado'}</span><p>Use a mesma conta da Classfy nos dois aparelhos.</p></div>
    </div>}
    {(!code || connected) && <div className="src-pairing-progress"><Loader2 size={16} className="se-spin" />{state.connection === 'reconnecting' ? 'Reconectando a prévia…' : connected ? 'Conectando câmera…' : 'Preparando sua conexão privada…'}</div>}
    {state.error && <p className="src-error" role="alert">{state.error}</p>}
    {(state.connection === 'disconnected' || !!code && !remaining && !connected || state.error) && <button type="button" className="src-secondary" disabled={disabled} onClick={onReconnect}><RefreshCw size={15} />Tentar novamente</button>}
    <small className="src-private"><ShieldCheck size={13} />Prévia leve no computador. Original preservado no iPhone.</small>
  </section>;
}

export function StudioRemoteCameraStatus({ state, onReconnect, disabled = false, audioMonitorVisible = false }: { state: StudioRemoteView; onReconnect(): void; disabled?: boolean; audioMonitorVisible?: boolean }) {
  const transferring = !['idle', 'complete'].includes(state.transfer);
  const text = state.transfer === 'waiting' ? 'Finalizando original no iPhone…' : state.transfer === 'uploading' ? 'Enviando original…' : state.transfer === 'downloading' ? 'Recebendo original…' : state.transfer === 'validating' ? 'Conferindo original…' : state.transfer === 'retry' ? 'Original aguardando recuperação' : state.connection === 'reconnecting' ? 'Reconectando prévia…' : state.connection === 'disconnected' ? 'Prévia desconectada' : 'iPhone conectado';
  return <div className={`src-status${state.connection !== 'connected' ? ' src-status--attention' : ''}${audioMonitorVisible ? ' src-status--above-meter' : ''}`} role="status"><span>{transferring && state.transfer !== 'retry' ? <Loader2 size={14} className="se-spin" /> : <Smartphone size={14} />}{text}</span><small>{state.session?.deviceState?.deviceName ?? 'Câmera remota'} · original no aparelho</small>{state.connection === 'disconnected' && <button type="button" onClick={onReconnect} disabled={disabled}><RefreshCw size={12} />Reconectar</button>}</div>;
}
