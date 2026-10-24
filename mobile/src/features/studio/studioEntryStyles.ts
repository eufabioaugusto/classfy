import { StyleSheet } from 'react-native';
import { colors } from '@/theme/colors';

export const studioEntrySizes = { glyph: 30, chevron: 17 } as const;

/** Keep the Studio shortcuts on the same icon, text and accessory columns. */
export const studioEntryStyles = StyleSheet.create({
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface },
  icon: { width: 36, height: 36, flexShrink: 0, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 3 },
  title: { color: colors.textSecondary, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  accessory: { width: 20, height: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
});
