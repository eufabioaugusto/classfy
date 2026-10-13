import { useEffect, useRef, useState } from 'react';
import { Check, ChevronUp, Loader2, Mic, X } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';

const portKind = (type: string) => /usb/i.test(type) ? 'USB · Conectado ao iPhone' : /built.?in/i.test(type) ? 'Microfone integrado' : /bluetooth/i.test(type) ? 'Bluetooth · Conectado ao iPhone' : 'Conectado ao iPhone';
const percent = (db: number) => Math.max(0, Math.min(100, (db + 60) / 60 * 100));

/** The original's input and levels belong to the iPhone, never the Mac's microphone. */
export function StudioRemoteMicrophoneMonitor({ state, disabled, onSelect }: {
  state: StudioRemoteView; disabled: boolean; onSelect(id: string | null): Promise<void>;
}) {
  const device = state.session?.deviceState, audio = device?.audioInput, monitor = device?.audioMonitor;
  const capable = device?.capabilities?.audioInputSelection === true;
  const [open, setOpen] = useState(false), [selecting, setSelecting] = useState(false), [error, setError] = useState<string | null>(null), [now, setNow] = useState(Date.now);
  const container = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null), operation = useRef(0);
  useEffect(() => { ++operation.current; setOpen(false); setSelecting(false); setError(null); return () => { ++operation.current; }; }, [state.session?.id]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const blocked = disabled || selecting || audio?.selecting === true || state.connection !== 'connected';
  const close = (restoreFocus = false) => { setOpen(false); if (restoreFocus) trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled),button')?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const choose = async (id: string | null) => {
    if (blocked || !capable || id !== null && !audio?.available.some(port => port.id === id)) return;
    const owned = ++operation.current; setSelecting(true); setError(null);
    try { await onSelect(id); }
    catch (cause) { if (operation.current === owned) setError(cause instanceof Error ? cause.message : 'Não foi possível confirmar esse microfone. Escolha outra entrada.'); }
    finally { if (operation.current === owned) setSelecting(false); }
  };
  const seen = Date.parse(state.session?.deviceSeenAt ?? ''), fresh = Number.isFinite(seen) && now - seen <= 6000;
  const confirmed = capable ? audio?.confirmed === true && !!audio.current && !audio.selecting && (audio.preferredId === null || audio.preferredId === audio.current.id) : !!monitor?.input;
  const name = confirmed ? capable ? audio!.current!.name : monitor!.input!.name : 'Microfone do iPhone';
  const matchingInput = !capable || !!audio?.current && monitor?.input?.id === audio.current.id;
  const channels = fresh && confirmed && matchingInput && !selecting && !audio?.selecting && state.connection === 'connected' && monitor?.status === 'live' ? monitor.channels.filter(channel => Number.isFinite(channel.averageDb) && Number.isFinite(channel.peakDb)).slice(0, 2) : [];
  const warning = error || audio?.warning;
  const detail = selecting || audio?.selecting ? 'Confirmando microfone…' : !fresh || monitor?.status === 'waiting' || !confirmed ? 'Aguardando áudio no iPhone' : monitor?.status === 'interrupted' ? 'Entrada interrompida' : monitor?.status === 'unavailable' ? 'Medidor indisponível' : channels.length ? `${Math.round(channels[0].averageDb)} dBFS` : 'Aguardando amostra';
  return <div ref={container} className="src-audio">
    <button ref={trigger} type="button" className="src-audio-trigger" aria-label="Selecionar microfone do iPhone" aria-expanded={open} aria-haspopup="dialog" disabled={blocked} onClick={() => { setError(null); setOpen(value => !value); }}>
      <span className="src-audio-heading"><Mic size={14} /><strong>{name}</strong>{!disabled && <ChevronUp size={12} />}</span>
      {channels.length ? channels.map((channel, index) => <span key={index} className="src-audio-meter" role="meter" aria-label={`Nível do microfone do iPhone${channels.length > 1 ? ` · canal ${index + 1}` : ''}`} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.max(-60, Math.min(0, channel.averageDb))}><i style={{ width: `${percent(channel.averageDb)}%`, background: channel.peakDb >= -3 ? '#f36f76' : undefined }} /><b style={{ left: `${percent(channel.peakDb)}%` }} /></span>) : <span className="src-audio-meter is-waiting" aria-hidden="true" />}
      <small className={warning ? 'src-audio-warning' : ''}>{selecting && <Loader2 size={11} className="se-spin" />}{warning || detail}</small>
    </button>
    {open && <section ref={panel} className="src-audio-picker" role="dialog" aria-label="Microfone do iPhone" aria-busy={selecting || audio?.selecting === true}>
      <header><div><span className="src-eyebrow">ENTRADA DE ÁUDIO</span><h3>Microfone do iPhone</h3></div><button type="button" className="se-recording-icon" aria-label="Fechar seleção de microfone" onClick={() => close(true)}><X size={16} /></button></header>
      <p>Este microfone grava o áudio junto à câmera do iPhone.</p>
      {capable ? <div className="src-audio-options" role="group" aria-label="Entradas de áudio do iPhone">
        <button type="button" className="src-audio-option" aria-pressed={audio?.preferredId === null && confirmed} disabled={blocked} onClick={() => void choose(null)}><span><strong>Automático</strong><small>Segue a entrada padrão do iPhone.</small></span>{audio?.preferredId === null && confirmed && <Check size={15} />}</button>
        {(audio?.available ?? []).map(port => <button type="button" key={port.id} className="src-audio-option" aria-pressed={audio?.preferredId === port.id && confirmed} disabled={blocked} onClick={() => void choose(port.id)}><span><strong>{port.name}{confirmed && audio.current?.id === port.id && <em>Em uso</em>}</strong><small>{portKind(port.type)}</small></span>{audio?.preferredId === port.id && confirmed && <Check size={15} />}</button>)}
        {!audio?.available.length && <p className="src-audio-note">Conecte seu microfone ao iPhone para vê-lo aqui.</p>}
      </div> : <p className="src-audio-note">Atualize o app do iPhone para escolher entre os microfones disponíveis.</p>}
      {selecting || audio?.selecting ? <p className="src-audio-receipt" role="status"><Loader2 size={12} className="se-spin" />Confirmando a entrada no iPhone…</p> : confirmed && <p className="src-audio-receipt" role="status"><Check size={12} />Em uso: {name}</p>}
      {warning && <p className="src-audio-picker-warning" role="alert">{warning}</p>}
    </section>}
  </div>;
}
