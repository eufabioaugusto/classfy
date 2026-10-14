import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Monitor, Check, Eye } from 'lucide-react-native';
import { PlanCrown } from '@/components/PlanCrown';
import { StudioButton } from './StudioUI';
import { STUDIO_CAMERA_MONITOR_URL } from './cameraMonitorModel';
import type { StudioMonitorPublisherSnapshot } from './cameraMonitorPublisher';
import { colors } from '@/theme/colors';

export function StudioCameraMonitorPanel({ premium, available, ready, state, onEnable, onDisable, onUpgrade, upgradeDisabled = false }: {
  premium: boolean; available: boolean; ready: boolean; state: StudioMonitorPublisherSnapshot;
  upgradeDisabled?: boolean;
  onEnable: () => void; onDisable: () => void; onUpgrade: () => void;
}) {
  const connected = state.phase === 'connected';
  return <View style={styles.panel}>
    <View style={styles.heading}><View style={styles.symbol}><Monitor size={25} color="#75DCAF" /></View>
      <View style={styles.headingText}><Text style={styles.title}>Seu enquadramento, em outra tela.</Text>
        <Text style={styles.detail}>O monitor abre automaticamente na Classfy do computador. Mantenha o navegador aberto na mesma conta.</Text></View>
      <PlanCrown plan="premium" size={16} />
    </View>
    {!premium ? <StudioButton label="Conhecer o Premium" disabled={upgradeDisabled} icon={<PlanCrown plan="premium" size={16} />} onPress={onUpgrade} />
      : !available ? <Text style={styles.detail}>Atualize o aplicativo no iPhone para visualizar esta câmera no computador.</Text>
      : state.enabled ? <Pressable accessibilityRole="switch" accessibilityLabel="Visualizar no computador" accessibilityState={{ checked: true }}
        onPress={onDisable} style={styles.toggle}><Text style={styles.toggleText}>Visualizar no computador</Text><View style={[styles.switch, styles.switchOn]}><View style={[styles.thumb, { alignSelf: 'flex-end' }]} /></View></Pressable>
      : <Pressable accessibilityRole="switch" accessibilityLabel="Visualizar no computador" accessibilityState={{ checked: false, disabled: !ready }} disabled={!ready}
        onPress={onEnable} style={[styles.toggle, !ready && { opacity: 0.45 }]}><Text style={styles.toggleText}>{ready ? 'Visualizar no computador' : 'Aguarde a câmera preparar a imagem'}</Text><View style={styles.switch}><View style={styles.thumb} /></View></Pressable>}
    <View style={styles.address}><Text style={styles.addressLabel}>Para abrir o monitor manualmente</Text>
      <Text selectable accessibilityLabel={`Endereço do monitor: ${STUDIO_CAMERA_MONITOR_URL}`} style={styles.url}>classfy.com.br/studio/monitor</Text>
      <Text style={styles.detail}>Entre na mesma conta Classfy deste iPhone.</Text>
    </View>
    {state.enabled && <View accessibilityLiveRegion="polite" style={styles.status}>
      {connected ? state.viewerPresent ? <Eye size={16} color="#75DCAF" /> : <Check size={16} color="#75DCAF" /> : <Monitor size={16} color={colors.muted} />}
      <Text style={styles.statusText}>{connected ? state.viewerPresent ? 'Visualizando no computador' : 'Monitor ativo · aguardando seu navegador'
        : state.phase === 'waiting' ? 'Aguardando a câmera deste iPhone…' : 'Conectando a prévia…'}</Text>
    </View>}
    {!!state.error && <Text accessibilityLiveRegion="polite" style={styles.error}>{state.error}</Text>}
    <Text style={styles.footnote}>Seu original fica no iPhone. Encerrar a prévia mantém a gravação.</Text>
  </View>;
}
const styles = StyleSheet.create({
  panel: { gap: 20 }, heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  symbol: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#12352A', alignItems: 'center', justifyContent: 'center' },
  headingText: { flex: 1, gap: 7 }, title: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '600' },
  detail: { color: colors.muted, fontSize: 13, lineHeight: 20 }, address: { padding: 16, borderRadius: 14, backgroundColor: '#171B1A', gap: 7 },
  addressLabel: { color: colors.textSecondary, fontSize: 12 }, url: { color: '#75DCAF', fontSize: 15, lineHeight: 22, fontWeight: '600', flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 9 }, statusText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 19 },
  error: { color: '#FFA1AE', fontSize: 13, lineHeight: 20 }, toggle: { minHeight: 56, borderRadius: 14, padding: 14, backgroundColor: '#171B1A', flexDirection: 'row', alignItems: 'center', gap: 14 },
  toggleText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' }, switch: { width: 44, height: 26, borderRadius: 13, padding: 3, backgroundColor: '#3A3D3C' },
  switchOn: { backgroundColor: '#2F9F76' }, thumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFF' },
  footnote: { color: colors.muted, fontSize: 11, lineHeight: 17 },
});
