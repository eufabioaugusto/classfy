import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Camera, Check, Copy, Crown, Loader2, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';
import '@/styles/studio-remote-camera.css';

export function StudioRemoteCameraPairing({ state, onReconnect, onCancel, onUnpair, disabled = false }: { state: StudioRemoteView; onReconnect(): void; onCancel?(): void; onUnpair?(): void; disabled?: boolean }) {
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
    <h2>{connected ? 'Aguardando meu iPhone.' : 'Seu iPhone. Sua câmera Pro.'}</h2>
    <p>{connected ? 'Abra a Câmera remota no app Classfy. Seu iPhone já está vinculado a este computador; a prévia conecta automaticamente.' : 'Abra o Studio no app Classfy, entre em Câmera remota e leia este código uma vez para vincular este computador.'}</p>
    {!connected && code && <div className="src-pairing-body">
      <div className="src-qr">{qr ? <img src={qr} alt="Código QR para parear seu iPhone com esta gravação" /> : <Loader2 className="se-spin" size={25} />}</div>
      <div className="src-pairing-code"><small>OU COLE O CÓDIGO NO APP</small><button type="button" aria-label="Copiar código de conexão" onClick={() => void copy()}><strong>{code}</strong>{copied ? <Check size={15} /> : <Copy size={15} />}</button><span>{copied ? 'Código copiado' : remaining ? `Válido por ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : 'Código expirado'}</span><p>Use a mesma conta da Classfy nos dois aparelhos.</p></div>
    </div>}
    {(!code || connected) && <div className="src-pairing-progress"><Loader2 size={16} className="se-spin" />{state.connection === 'reconnecting' ? 'Reconectando a prévia…' : connected ? 'Conectando câmera…' : 'Preparando sua conexão privada…'}</div>}
    {state.error && <p className="src-error" role="alert">{state.error}</p>}
    {(['connecting', 'reconnecting', 'disconnected'].includes(state.connection) || !!code && !remaining && !connected || state.error) && <button type="button" className="src-secondary" disabled={disabled} onClick={onReconnect}><RefreshCw size={15} />{!connected && !!code && !remaining ? 'Gerar novo código' : 'Reconectar prévia'}</button>}
    {(onCancel || connected && onUnpair) && <div className="src-pairing-actions">{onCancel && <button type="button" className="src-secondary" disabled={disabled} onClick={onCancel}>Cancelar conexão</button>}{connected && onUnpair && <button type="button" className="src-secondary" disabled={disabled} onClick={onUnpair}>Desvincular iPhone</button>}</div>}
    <small className="src-private"><ShieldCheck size={13} />Prévia leve no computador. Original preservado no iPhone.</small>
  </section>;
}

export function studioRemoteTransferLabel(state: StudioRemoteView): string {
  const device = state.session?.deviceState;
  if (device?.processing === true && ['waiting', 'uploading'].includes(state.transfer)) {
    const value = device.processingProgress;
    const progress = typeof value === 'number' && Number.isFinite(value) ? ` · ${Math.floor(Math.max(0, Math.min(1, value)) * 100)}%` : '…';
    return `${device.processingStage === 'validating' ? 'Conferindo imagem no iPhone' : 'Preparando imagem no iPhone'}${progress}`;
  }
  const bytes = state.transferBytes, total = state.transferTotalBytes;
  const progress = typeof bytes === 'number' && typeof total === 'number' && total > 0 ? ` ${Math.min(100, Math.max(0, Math.floor(bytes / total * 100)))}%` : '';
  return state.transfer === 'waiting' ? 'Confirmando o original no iPhone…' : state.transfer === 'uploading' ? `Enviando original do iPhone…${progress}` : state.transfer === 'downloading' ? `Recebendo original no computador…${progress}` : state.transfer === 'validating' ? 'Conferindo imagem, áudio e duração do original…' : state.transfer === 'retry' ? 'Original aguardando transferência' : state.transfer === 'complete' ? 'Original recebido' : 'Preparando transferência…';
}

export function StudioRemoteCameraStatus({ state, onReconnect, onUnpair, disabled = false, audioMonitorVisible = false }: { state: StudioRemoteView; onReconnect(): void; onUnpair?(): void; disabled?: boolean; audioMonitorVisible?: boolean }) {
  const transferring = !['idle', 'complete'].includes(state.transfer);
  const text = transferring ? studioRemoteTransferLabel(state) : state.connection === 'reconnecting' ? 'Reconectando prévia…' : state.connection === 'disconnected' ? 'Prévia desconectada' : 'iPhone conectado';
  return <div className={`src-status${state.connection !== 'connected' ? ' src-status--attention' : ''}${audioMonitorVisible ? ' src-status--above-meter' : ''}`} role="status"><span>{transferring && state.transfer !== 'retry' ? <Loader2 size={14} className="se-spin" /> : <Smartphone size={14} />}{text}</span><small>{state.session?.deviceState?.deviceName ?? 'Câmera remota'} · original no aparelho</small>{state.connection === 'disconnected' && <button type="button" onClick={onReconnect} disabled={disabled}><RefreshCw size={12} />Reconectar</button>}{onUnpair && !state.pendingTakeId && <button type="button" onClick={onUnpair} disabled={disabled}>Desvincular iPhone</button>}</div>;
}
