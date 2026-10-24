import { StyleSheet } from 'react-native';
import { colors } from './colors';
import { spacing } from './spacing';

// Native, opt-in counterpart of Web V2's Economy/Library vocabulary.
// Existing media, Studio and Classy surfaces keep their own presentation.
export const dataTheme = {
  canvas: colors.background,
  surface: '#111317',
  raised: '#181B20',
  strong: '#20242A',
  ink: '#F5F6F7',
  secondary: '#B7BBC2',
  muted: '#969CA6',
  subtle: '#686F79',
  border: 'rgba(255,255,255,0.10)',
  accent: '#EF5066',
  accentSoft: 'rgba(239,80,102,0.13)',
  positive: '#63C79B',
  positiveSoft: 'rgba(99,199,155,0.12)',
  warning: '#E2AE63',
  warningSoft: 'rgba(226,174,99,0.12)',
  danger: '#EF6574',
  dangerSoft: 'rgba(239,101,116,0.12)',
  stroke: 1.7,
  controlRadius: 8,
  cardRadius: 14,
  panelRadius: 20,
} as const;

export const dataStyles = StyleSheet.create({
  screen: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.xxl },
  card: { backgroundColor: dataTheme.surface, borderColor: dataTheme.border, borderWidth: 1, borderRadius: dataTheme.cardRadius, padding: spacing.lg },
  sectionTitle: { color: dataTheme.ink, fontSize: 18, fontWeight: '600', letterSpacing: -0.3 },
  label: { color: dataTheme.muted, fontSize: 12, lineHeight: 18, fontWeight: '500' },
  body: { color: dataTheme.secondary, fontSize: 14, lineHeight: 21 },
  value: { color: dataTheme.ink, fontSize: 24, fontWeight: '600', letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: dataTheme.border },
  input: { minHeight: 48, backgroundColor: dataTheme.raised, borderColor: dataTheme.border, borderWidth: 1, borderRadius: dataTheme.controlRadius, paddingHorizontal: spacing.md, paddingVertical: spacing.md, color: dataTheme.ink, fontSize: 15 },
});
