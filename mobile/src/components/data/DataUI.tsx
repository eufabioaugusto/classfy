import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { dataStyles, dataTheme as t } from '@/theme/data';

type Tone = 'neutral' | 'positive' | 'warning' | 'danger';
const ink = (tone: Tone) => tone === 'neutral' ? t.ink : t[tone];

export function DataCard({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[dataStyles.card, style]}>{children}</View>;
}

export function DataIcon({ icon: Icon, tone = 'neutral', size = 20 }: { icon: LucideIcon; tone?: Tone; size?: number }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}>
    <Icon size={size} strokeWidth={t.stroke} color={tone === 'neutral' ? t.secondary : ink(tone)} />
  </View>;
}

export function DataSection({ title, subtitle, action, children, style }: PropsWithChildren<{ title: string; subtitle?: string; action?: ReactNode; style?: StyleProp<ViewStyle> }>) {
  return <View style={[styles.section, style]}>
    <View style={styles.sectionHeading}><View style={styles.copy}><Text accessibilityRole="header" style={dataStyles.sectionTitle}>{title}</Text>{subtitle ? <Text style={dataStyles.label}>{subtitle}</Text> : null}</View>{action}</View>
    {children}
  </View>;
}

export function DataMetric({ label, value, hint, tone = 'neutral', large = false, style }: { label: string; value: string; hint?: string; tone?: Tone; large?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.metric, style]}>
    <Text style={dataStyles.label}>{label}</Text>
    <Text style={[dataStyles.value, large && styles.largeValue, { color: ink(tone) }]}>{value}</Text>
    {hint ? <Text style={dataStyles.label}>{hint}</Text> : null}
  </View>;
}

export function DataRow({ icon, title, subtitle, value, onPress, destructive = false, last = false }: { icon?: LucideIcon; title: string; subtitle?: string; value?: ReactNode; onPress?: () => void; destructive?: boolean; last?: boolean }) {
  const content = <>
    {icon ? <DataIcon icon={icon} tone={destructive ? 'danger' : 'neutral'} /> : null}
    <View style={styles.copy}><Text style={[styles.rowTitle, destructive && { color: t.danger }]}>{title}</Text>{subtitle ? <Text style={dataStyles.label}>{subtitle}</Text> : null}</View>
    {typeof value === 'string' ? <Text style={styles.rowValue}>{value}</Text> : value}
    {onPress ? <ChevronRight size={18} strokeWidth={t.stroke} color={t.subtle} /> : null}
  </>;
  const style = [styles.row, !last && styles.rowDivider];
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>{content}</Pressable> : <View style={style}>{content}</View>;
}

export function DataAction({ label, onPress, variant = 'primary', disabled = false, busy = false, icon: Icon }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'quiet'; disabled?: boolean; busy?: boolean; icon?: LucideIcon }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.action, variant === 'primary' ? styles.primary : variant === 'secondary' ? styles.secondary : null, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
    {busy ? <ActivityIndicator size="small" color={t.ink} /> : Icon ? <Icon size={18} color={t.ink} strokeWidth={t.stroke} /> : null}
    <Text style={styles.actionText}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  icon: { width: 36, height: 36, borderRadius: t.controlRadius, backgroundColor: t.raised, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  metric: { minWidth: 0, gap: 6 },
  largeValue: { fontSize: 36, letterSpacing: -1.2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 12 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  rowTitle: { color: t.ink, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  rowValue: { color: t.secondary, fontSize: 13, fontVariant: ['tabular-nums'], flexShrink: 1, textAlign: 'right' },
  action: { minHeight: 48, borderRadius: t.controlRadius, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 16, gap: 8 },
  primary: { backgroundColor: t.accent },
  secondary: { backgroundColor: t.raised, borderWidth: 1, borderColor: t.border },
  actionText: { color: t.ink, fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
