import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Maximize2, Minimize2, Monitor, RefreshCw, ShieldCheck, Smartphone, WifiOff, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createStudioCameraMonitorViewer, type StudioCameraMonitorView } from '@/lib/studio/editor/cameraMonitorViewer';
import { studioCameraMonitorFresh } from '@/lib/studio/editor/cameraMonitorClient';
import '@/styles/studio-monitor.css';

const initialView = (): StudioCameraMonitorView => ({ monitor: null, connection: 'waiting', stream: null, error: null, serverOffset: 0 });
const clock = (seconds: number) => { const total = Math.max(0, Math.floor(seconds)); return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; };

/** A private display for mobile-led recording; this workspace never owns REC. */
export function StudioMonitorWorkspace({ owner, sessionId, onClose, createViewer = createStudioCameraMonitorViewer }: { owner: string; sessionId?: string; onClose?: () => void; createViewer?: typeof createStudioCameraMonitorViewer }) {
  const navigate = useNavigate(), shell = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null);
  const viewer = useRef<ReturnType<typeof createStudioCameraMonitorViewer> | null>(null);
  const [view, setView] = useState(initialView), [now, setNow] = useState(Date.now()), [fullscreen, setFullscreen] = useState(false), [playError, setPlayError] = useState<string | null>(null);
  const [fullscreenNotice, setFullscreenNotice] = useState<string | null>(null);
  useEffect(() => {
    const controller = createViewer({ owner, ...(sessionId ? { sessionId } : {}) }); viewer.current = controller;
    const unsubscribe = controller.subscribe(setView); void controller.start();
    return () => { unsubscribe(); if (viewer.current === controller) viewer.current = null; void controller.dispose(); };
  }, [owner, sessionId, createViewer]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    const sync = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', sync);
    return () => { clearInterval(timer); document.removeEventListener('fullscreenchange', sync); };
  }, []);
  const fresh = studioCameraMonitorFresh(view.monitor, now + view.serverOffset), visible = !!view.stream && fresh && view.connection === 'connected';
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    setPlayError(null); element.srcObject = visible ? view.stream : null;
    let active = true;
    if (visible) void element.play().catch(() => { if (active) setPlayError('Toque em Reconectar para abrir a imagem do iPhone.'); });
    return () => { active = false; element.pause(); element.srcObject = null; };
  }, [view.stream, visible]);
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement === shell.current) await document.exitFullscreen(); else await shell.current?.requestFullscreen(); setFullscreenNotice(null); }
    catch { setFullscreenNotice('O navegador não abriu a tela cheia.'); }
  };
  const device = view.monitor?.state, recording = visible && device?.recording;
  const elapsed = recording ? device.elapsedSeconds + Math.max(0, (now + view.serverOffset - Date.parse(view.monitor!.deviceSeenAt!)) / 1000) : device?.elapsedSeconds ?? 0;
  const lost = view.connection === 'lost' || !!view.monitor && !fresh;
  const status = recording ? 'Gravando no iPhone' : visible ? 'iPhone conectado' : lost ? 'Conexão perdida' : view.connection === 'connecting' || view.connection === 'reconnecting' ? 'Conectando ao iPhone' : 'Aguardando seu iPhone';
  return <div className="scm-monitor" ref={shell}>
    <header className="scm-header">
      <div className="scm-heading"><button type="button" aria-label={onClose ? 'Fechar monitor' : 'Voltar ao Studio'} onClick={() => onClose ? onClose() : navigate('/studio')}>{onClose ? <X size={20} /> : <ArrowLeft size={20} />}</button><Monitor size={21} className="scm-mark" /><div><span>CLASSFY STUDIO</span><h1>Monitor do iPhone</h1></div></div>
      <div className="scm-header-actions"><span className="scm-private"><ShieldCheck size={14} />Só você pode ver</span><button type="button" aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}</button></div>
    </header>
    <main className="scm-main">
      <div className="scm-status-row"><span className={`scm-connection${recording ? ' is-recording' : visible ? ' is-connected' : lost ? ' is-lost' : ''}`} role="status"><i />{status}{recording && <time aria-label="Tempo de gravação">{clock(elapsed)}</time>}</span><span className="scm-title">{view.monitor?.title || 'Sua cena, em uma tela maior'}</span></div>
      <div className={`scm-preview${visible ? ' is-live' : ''}`}>
        <video ref={video} muted autoPlay playsInline aria-label="Prévia do iPhone" hidden={!visible || !!playError} />
        {(!visible || playError) && <div className="scm-empty"><div className="scm-empty-icon">{lost ? <WifiOff size={31} strokeWidth={1.5} /> : view.connection === 'connecting' || view.connection === 'reconnecting' ? <Loader2 size={31} className="scm-spin" /> : <><Smartphone size={36} strokeWidth={1.3} /><Monitor size={23} strokeWidth={1.5} /></>}</div><h2>{playError ? 'Vamos abrir sua prévia.' : lost ? 'Seu iPhone está desconectado.' : view.monitor ? 'Abrindo sua câmera.' : 'Veja sua cena por aqui.'}</h2><p>{playError ?? (lost ? 'Mantenha o app aberto e reconecte o monitor. Seu take continua no iPhone.' : view.monitor ? 'Mantenha o app aberto no iPhone.' : <>No app do iPhone, prepare a gravação e toque em <strong>Ver no computador</strong>.</>)}</p>{view.error && <p className="scm-error" role="alert">{view.error}</p>}</div>}
      </div>
      <footer className="scm-footer"><div><Smartphone size={16} /><span>Controle a gravação pelo iPhone.{visible && device && <small>Gravação no iPhone: {device.width} × {device.height} · {device.fps} FPS · Câmera {device.cameraFacing === 'back' ? 'traseira' : 'frontal'}</small>}{fullscreenNotice && <small className="scm-error" role="status">{fullscreenNotice}</small>}</span></div><button type="button" onClick={() => { setPlayError(null); void viewer.current?.reconnect(); }}><RefreshCw size={15} />Reconectar</button></footer>
    </main>
  </div>;
}
