import { StyleSheet, Text, View } from 'react-native';
import { HardDrive } from 'lucide-react-native';
import { studioCaptureStorage } from './captureStorage';

type Props = { availableBytes?: number; totalBytes?: number };

/** Read-only companion to the microphone meter; touches pass through to focus. */
export function StudioCaptureStorageMonitor({ availableBytes, totalBytes }: Props) {
  const storage = studioCaptureStorage(availableBytes, totalBytes);
  const color = storage.low ? '#FF7078' : storage.availableBytes === null ? '#A8A8AE' : '#C6D8D0';
  return <View testID="studio-capture-storage" pointerEvents="none" accessible accessibilityLiveRegion="none"
    accessibilityLabel={storage.accessibilityLabel} style={[styles.monitor, storage.low && styles.low]}>
    <View style={styles.header}>
      <HardDrive size={11} strokeWidth={1.6} color={color} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.label, { color }]}>{storage.label}</Text>
    </View>
    <View testID="studio-capture-storage-track" style={styles.track}>
      {storage.freeFraction !== null && <View testID="studio-capture-storage-fill"
        style={[styles.fill, { width: `${storage.freeFraction * 100}%`, backgroundColor: color }]} />}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  monitor: { width: '100%', maxWidth: 180, paddingHorizontal: 8, paddingVertical: 6, gap: 5,
    borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', backgroundColor: 'rgba(0,0,0,0.58)' },
  low: { borderColor: 'rgba(255,112,120,0.32)' },
  header: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  label: { flex: 1, minWidth: 0, fontSize: 10, fontWeight: '500', fontVariant: ['tabular-nums'] },
  track: { height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.13)' },
  fill: { height: '100%', borderRadius: 2 },
});
