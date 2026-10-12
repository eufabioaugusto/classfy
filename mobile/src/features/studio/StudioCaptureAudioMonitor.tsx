import { StyleSheet, Text, View } from 'react-native';
import { Mic } from 'lucide-react-native';

export type StudioCaptureAudioMonitorProps = {
  input: { name: string; type: string } | null;
  channels: { averageDb: number; peakDb: number }[];
  status: 'waiting' | 'live' | 'unavailable' | 'interrupted';
  message?: string;
  compact?: boolean;
};

const scale = [-48, -36, -24, -12, -6, 0] as const;
const states = {
  waiting: 'Aguardando o microfone',
  live: 'Entrada ativa',
  unavailable: 'Monitor indisponível',
  interrupted: 'Entrada interrompida',
};

/** Linear dBFS scale, with no guessed reading for missing or invalid samples. */
export function studioAudioMeterPosition(db: number): number | null {
  return Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 48) / 48)) : null;
}

export function StudioCaptureAudioMonitor({ input, channels, status, message, compact }: StudioCaptureAudioMonitorProps) {
  const name = input?.name.trim() || 'Entrada de áudio';
  const samples = channels.slice(0, 8);
  const live = status === 'live' && samples.some(sample => Number.isFinite(sample.averageDb) && Number.isFinite(sample.peakDb));
  const state = status === 'live' && !live ? states.waiting : states[status];
  const countLabel = `${samples.length} ${samples.length === 1 ? 'canal' : 'canais'}`;
  const detail = message?.trim();
  const accessibleSummary = [name, 'Monitor de áudio', state, live ? countLabel : null, detail && detail !== state ? detail : null]
    .filter(Boolean).join('. ');
  return <View pointerEvents="none" accessible accessibilityLiveRegion="none"
    accessibilityLabel={`${accessibleSummary}.`}
    style={[styles.monitor, compact && styles.compact]}>
    <View style={styles.header}>
      <Mic color="#D6D6D6" size={12} strokeWidth={1.5} />
      <Text numberOfLines={1} style={styles.input}>{name}</Text>
      {live && <Text style={styles.unit}>dBFS</Text>}
    </View>
    {live ? <View style={styles.meters}>
      {!compact && <View style={styles.scaleRow}>
        <View style={styles.channelLabel} />
        <View style={styles.scale}>
          {scale.map((db, index) => <Text key={db} style={[styles.scaleText, {
            left: `${((db + 48) / 48) * 100}%`,
            marginLeft: index === 0 ? 0 : index === scale.length - 1 ? -7 : -9,
          }]}>{db}</Text>)}
        </View>
        <View style={styles.valueSpace} />
      </View>}
      {samples.map((sample, index) => {
        const average = studioAudioMeterPosition(sample.averageDb);
        const peak = studioAudioMeterPosition(sample.peakDb);
        return <View key={index} style={styles.channel}>
          <Text style={[styles.channelLabel, compact && samples.length === 1 && styles.hiddenChannelLabel]}>{compact && samples.length === 1 ? '' : index + 1}</Text>
          {average !== null && peak !== null ? <View style={[styles.track, compact && styles.compactTrack]}>
            {average > 0 && <View style={[styles.fill, { left: 0, width: `${Math.min(average, .75) * 100}%`, backgroundColor: '#36D56B' }]} />}
            {average > .75 && <View style={[styles.fill, { left: '75%', width: `${Math.min(average - .75, .125) * 100}%`, backgroundColor: '#F2CA43' }]} />}
            {average > .875 && <View style={[styles.fill, { left: '87.5%', width: `${(average - .875) * 100}%`, backgroundColor: '#F04A4A' }]} />}
            <View style={[styles.peak, { left: `${peak * 100}%`, backgroundColor: sample.peakDb >= -6 ? '#FF6666' : '#F4F4F4' }]} />
          </View> : <View style={styles.unknownTrack} />}
          <Text style={styles.value}>{average !== null && peak !== null ? Math.round(sample.averageDb) : '—'}</Text>
        </View>;
      })}
    </View> : <Text numberOfLines={compact ? 2 : undefined} style={styles.status}>{detail || state}</Text>}
    {live && !!detail && <Text numberOfLines={compact ? 2 : undefined} style={[styles.status, styles.warning]}>{detail}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  monitor: { width: 264, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 8, gap: 6,
    backgroundColor: 'rgba(0,0,0,0.58)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)' },
  compact: { width: 180, paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  input: { color: '#F2F2F2', fontSize: 10, fontWeight: '500', flex: 1, minWidth: 0 },
  unit: { color: '#A8A8A8', fontSize: 8, letterSpacing: .1 },
  meters: { gap: 3 },
  scaleRow: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  scale: { flex: 1, height: 12, position: 'relative' },
  scaleText: { position: 'absolute', top: 0, color: '#B5B5B5', fontSize: 8, fontVariant: ['tabular-nums'] },
  channel: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 13 },
  channelLabel: { width: 10, color: '#BFBFBF', fontSize: 9, fontVariant: ['tabular-nums'], textAlign: 'center' },
  hiddenChannelLabel: { width: 0 },
  track: { flex: 1, height: 8, position: 'relative', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 2 },
  unknownTrack: { flex: 1, height: 8 },
  compactTrack: { height: 6 },
  fill: { position: 'absolute', top: 0, bottom: 0 },
  peak: { position: 'absolute', top: 0, bottom: 0, width: 2, marginLeft: -1 },
  value: { width: 24, color: '#BFBFBF', fontSize: 9, textAlign: 'right', fontVariant: ['tabular-nums'] },
  valueSpace: { width: 24 },
  status: { color: '#BFBFBF', fontSize: 10, lineHeight: 14 },
  warning: { color: '#E4BB78' },
});
