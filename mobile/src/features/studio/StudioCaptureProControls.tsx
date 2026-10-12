import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StudioCameraProSettings, StudioCameraProState } from '../../../modules/classfy-studio-media';
import { colors } from '@/theme/colors';
import { StudioCaptureZoom } from './StudioCaptureZoom';

export function StudioCaptureProControls({ state, disabled, pending, confirmation, onChange }: {
  state: StudioCameraProState; disabled: boolean; pending: boolean; confirmation: number; onChange: (patch: StudioCameraProSettings) => void;
}) {
  const [advancedWhiteBalance, setAdvancedWhiteBalance] = useState(false);
  const temperatureAvailable = state.supportsTemperatureAndTint === true && Number.isFinite(state.temperatureKelvin) && Number.isFinite(state.whiteBalanceTint);
  const modes = (name: string, automatic: boolean, patch: (auto: boolean) => StudioCameraProSettings) => <View style={s.modeRow}>
    <Text style={s.title}>{name}</Text><View style={s.buttons}>{[true, false].map(auto => <Pressable key={String(auto)} accessibilityRole="button"
      accessibilityLabel={`${name} ${auto ? 'automático' : 'manual'}`} accessibilityState={{ selected: automatic === auto, disabled }} disabled={disabled}
      onPress={() => onChange(patch(auto))} style={[s.mode, automatic === auto && s.selected]}><Text style={s.modeText}>{auto ? 'Auto' : 'Manual'}</Text></Pressable>)}</View>
  </View>;
  const wheel = (name: string, value: number, minimum: number, maximum: number, label: string, change: (value: number) => void, logarithmic = false) => {
    if (![value, minimum, maximum].every(Number.isFinite) || minimum >= maximum || logarithmic && minimum <= 0) return null;
    const normalized = logarithmic ? Math.log(Math.max(minimum, value) / minimum) / Math.log(maximum / minimum) : (value - minimum) / (maximum - minimum);
    return <View style={s.wheel}><View style={s.modeRow}><Text style={s.label}>{name}</Text><Text style={s.value}>{label}</Text></View>
      <StudioCaptureZoom controlName={name.toLocaleLowerCase('pt-BR')} value={Math.max(0, Math.min(1, normalized))}
        confirmedValue={Math.max(0, Math.min(1, normalized))} pending={pending} confirmation={confirmation}
        onChange={fraction => change(logarithmic ? minimum * Math.pow(maximum / minimum, fraction) : minimum + (maximum - minimum) * fraction)}
        label={label} disabled={disabled} style={{ position: 'relative', alignSelf: 'center', width: '100%' }} />
    </View>;
  };
  return <View style={s.section}>
    <Text style={s.heading}>Câmera PRO</Text>
    <Text style={s.hint}>Ajustes físicos da câmera. O valor aparece depois da confirmação do aparelho. Mudar resolução ou FPS retorna os ajustes para automático.</Text>
    {state.supportsExposure && <>
      {modes('Exposição PRO', state.autoExposure, autoExposure => ({ autoExposure }))}
      {!state.autoExposure && <>
        {wheel('ISO', state.iso, state.minISO, state.maxISO, Math.round(state.iso).toString(), iso => onChange({ autoExposure: false, iso }), true)}
        {wheel('Obturador', state.shutterSeconds, state.minShutterSeconds, state.maxShutterSeconds,
          state.shutterSeconds > 0 ? `1/${Math.round(1 / state.shutterSeconds)} s` : '—', shutterSeconds => onChange({ autoExposure: false, shutterSeconds }), true)}
        <Text style={s.hint}>O tempo de exposição respeita os FPS escolhidos. ISO maior pode aumentar o ruído.</Text>
      </>}
    </>}
    {state.supportsWhiteBalance && <>
      {modes('Balanço de branco', state.autoWhiteBalance, autoWhiteBalance => ({ autoWhiteBalance }))}
      {!state.autoWhiteBalance && <>
        {temperatureAvailable && <>
          {wheel('Temperatura', state.temperatureKelvin!, 2000, 10000, `${Math.round(state.temperatureKelvin!)} K`, temperatureKelvin => onChange({ autoWhiteBalance: false, temperatureKelvin }))}
          {wheel('Matiz', state.whiteBalanceTint!, -150, 150, `${state.whiteBalanceTint! >= 0 ? '+' : ''}${Math.round(state.whiteBalanceTint!)}`, whiteBalanceTint => onChange({ autoWhiteBalance: false, whiteBalanceTint }))}
          <Text style={s.hint}>A faixa de ajuste vai de 2000 a 10000 K. A câmera pode limitar a combinação; o valor exibido é o aplicado.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={advancedWhiteBalance ? 'Ocultar ganhos RGB' : 'Mostrar ganhos RGB avançados'}
            disabled={disabled} onPress={() => setAdvancedWhiteBalance(value => !value)} style={s.advanced}><Text style={s.modeText}>{advancedWhiteBalance ? 'Ocultar ganhos RGB' : 'Ganhos RGB avançados'}</Text></Pressable>
        </>}
        {(!temperatureAvailable || advancedWhiteBalance) && (['redGain', 'greenGain', 'blueGain'] as const).map((key, index) => <View key={key}>{wheel(['Vermelho', 'Verde', 'Azul'][index], state[key], state.minWhiteBalanceGain, state.maxWhiteBalanceGain,
          `${state[key].toFixed(2)}×`, value => onChange({ autoWhiteBalance: false, [key]: value }))}</View>)}
        {(!temperatureAvailable || advancedWhiteBalance) && <Text style={s.hint}>Ganhos RGB reais do balanço de branco. O iOS normaliza os canais; os valores confirmados podem diferir do alvo.</Text>}
      </>}
    </>}
    {state.supportsFocus && <>
      {modes('Foco', state.autoFocus, autoFocus => ({ autoFocus }))}
      {!state.autoFocus && <>{wheel('Posição da lente', state.lensPosition, 0, 1, `${Math.round(state.lensPosition * 100)}%`, lensPosition => onChange({ autoFocus: false, lensPosition }))}
        <Text style={s.hint}>Posição relativa da lente, do foco próximo ao distante. Não representa metros nem foco no infinito.</Text></>}
    </>}
    {!state.supportsExposure && !state.supportsWhiteBalance && !state.supportsFocus && <Text style={s.hint}>Esta câmera não disponibiliza controles manuais neste formato.</Text>}
  </View>;
}
const s = StyleSheet.create({
  section: { gap: 14, paddingTop: 12 }, heading: { color: colors.text, fontSize: 17, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 }, modeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', flexShrink: 1 }, label: { color: colors.textSecondary, fontSize: 13 },
  value: { color: colors.text, fontSize: 13, fontVariant: ['tabular-nums'] }, buttons: { flexDirection: 'row', gap: 6 },
  mode: { minHeight: 44, minWidth: 62, justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  selected: { backgroundColor: '#3A1523', borderColor: '#EF5066' }, modeText: { color: colors.text, fontSize: 12 }, wheel: { gap: 7 },
  advanced: { minHeight: 44, alignSelf: 'flex-start', paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, backgroundColor: '#252525' },
});
