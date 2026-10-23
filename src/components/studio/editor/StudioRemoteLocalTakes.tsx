import { Check, Download, Film, Loader2, Smartphone, Upload } from 'lucide-react';
import { formatStudioDuration } from '../../../../shared/studio';
import type { StudioRemoteLocalTakeView, StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';

/** Phone receipts appear before any browser asset exists. Receiving is explicit. */
export function StudioRemoteLocalTakes({ state, savedIds, savingId, disabled, recording, onSend, onImport }: {
  state: StudioRemoteView; savedIds: Set<string>; savingId?: string | null; disabled: boolean; recording: boolean;
  onSend(id: string): void; onImport(id?: string): void;
}) {
  const takes = state.localTakes?.filter(take => take.localSaved || ['uploaded', 'uploading', 'failed', 'local_ready'].includes(take.phase)) ?? [];
  const active = !['idle', 'complete', 'retry'].includes(state.transfer);
  const label = (take: StudioRemoteLocalTakeView) => savedIds.has(take.id) ? 'Salvo no computador' : savingId === take.id ? 'Salvando no computador…' : state.transferTakeId === take.id && active ? state.transfer === 'downloading' ? 'Recebendo original…' : state.transfer === 'validating' ? 'Conferindo original…' : 'Enviando ao computador…' : take.phase === 'uploaded' ? 'Disponível para receber' : take.phase === 'uploading' ? 'Envio em andamento no iPhone' : take.phase === 'preparing' ? 'Preparando envio no iPhone' : take.localSaved ? 'Salvo no iPhone' : 'Envio pendente';
  return <section className="se-recording-phone-takes" aria-label="Originais do iPhone">
    <header><div><Smartphone size={16} /><strong>Originais do iPhone</strong><span>{takes.length}</span></div><button disabled={disabled || !!savingId} onClick={() => onImport()}><Download size={14} />Importar original recebido</button></header>
    <p>A gravação fica salva no iPhone. Envie quando quiser ou compartilhe por AirDrop no app.</p>
    {!!takes.length && <div className="se-recording-phone-takes-list">{takes.map((take, index) => {
      const sending = state.transferTakeId === take.id && active, saved = savedIds.has(take.id), archived = !!take.sessionId && !!state.session && take.sessionId !== state.session.id;
      const progress = sending && state.transferTotalBytes && Number.isFinite(state.transferBytes) ? Math.min(100, Math.floor(state.transferBytes! / state.transferTotalBytes * 100)) : null;
      return <article key={take.id}><div className="se-recording-phone-take-icon">{saved ? <Check size={19} /> : sending ? <Loader2 size={19} className="se-spin" /> : <Film size={19} />}</div><div className="se-recording-phone-take-info"><strong>Take {index + 1}{take.metadata ? ` · ${formatStudioDuration(take.metadata.duration)}` : ''}</strong><small>{label(take)}{archived && take.phase !== 'uploaded' ? ' · importe por AirDrop' : ''}{progress !== null ? ` ${progress}%` : ''}</small>{state.transferTakeId === take.id && state.transfer === 'retry' && state.error ? <small role="alert">{state.error}</small> : take.error ? <small>{take.error}</small> : null}{sending && <progress aria-label={`Envio do take ${index + 1}`} max={100} value={progress ?? undefined} />}</div><div className="se-recording-phone-take-actions">{!saved && <><button disabled={disabled || !!savingId || active || recording && take.phase !== 'uploaded' || archived && take.phase !== 'uploaded'} onClick={() => onSend(take.id)}><Upload size={13} />{state.transferTakeId === take.id && state.transfer === 'retry' ? 'Retomar envio' : 'Enviar ao computador'}</button><button aria-label={`Importar original recebido do take ${index + 1}`} disabled={disabled || !!savingId} onClick={() => onImport(take.id)} title="Importar este original recebido por AirDrop"><Download size={14} /></button></>}</div></article>;
    })}</div>}
    {recording && <small>Os envios já iniciados continuam enquanto você grava. Inicie outro envio após encerrar este take.</small>}
  </section>;
}
