import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import type { StudioRemoteView } from '@/lib/studio/editor/remoteCameraCapture';

const validBytes = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const formatGB = (bytes: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.floor(bytes / 100_000_000) / 10);

/** Camera storage always belongs to the paired iPhone, independently of narration. */
export function StudioRemoteStorageIndicator({ state }: { state: StudioRemoteView }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  if (!state.session?.deviceId) return null;
  const device = state.session.deviceState, seen = Date.parse(state.session.deviceSeenAt ?? '');
  const fresh = Number.isFinite(seen) && now - seen >= -3000 && now - seen <= 6000;
  const connected = state.connection === 'connected' && !['disconnected', 'media-timeout', 'subscription-failed'].includes(state.previewDiagnostic?.stage ?? '');
  const available = fresh && connected && validBytes(device?.storageAvailableBytes) ? device.storageAvailableBytes : null;
  const total = validBytes(device?.storageTotalBytes) && device.storageTotalBytes > 0 && available !== null && available <= device.storageTotalBytes ? device.storageTotalBytes : null;
  const low = available !== null && available < 5_000_000_000;
  const label = available === null ? 'Indisponível' : `${formatGB(available)} GB livres`;
  const detail = available === null ? 'Armazenamento do iPhone indisponível. Aguarde a conexão e uma atualização do aparelho.' : `${label} no iPhone${total === null ? '' : ` de ${formatGB(total)} GB`}${low ? '. Pouco espaço disponível.' : '.'}`;
  return <div className={`src-storage${low ? ' is-low' : ''}${available === null ? ' is-unavailable' : ''}`} role="group" aria-label="Armazenamento do iPhone" title={detail}>
    <div className="src-storage-heading"><HardDrive size={15} aria-hidden="true" /><span><small>{low ? 'iPhone · Pouco espaço' : 'iPhone'}</small><strong>{label}</strong></span></div>
    {available !== null && total !== null && <div className="src-storage-meter" role="meter" aria-label="Espaço livre no iPhone" aria-valuemin={0} aria-valuemax={total} aria-valuenow={available} aria-valuetext={detail}><i style={{ width: `${available / total * 100}%` }} /></div>}
    <span className="src-storage-notice" role="status" aria-live="polite">{low ? 'Pouco espaço disponível no iPhone.' : ''}</span>
  </div>;
}
