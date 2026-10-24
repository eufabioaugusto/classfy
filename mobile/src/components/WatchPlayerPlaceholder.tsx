import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type WatchPlayerPlaceholderProps = {
  poster?: string | null;
  format: string;
  locked: boolean;
  loading: boolean;
  error?: string | null;
  visible?: boolean;
};

/** The cover stays in place until the existing player has a playable source. */
export function WatchPlayerPlaceholder({ poster, format, locked, loading, error, visible = true }: WatchPlayerPlaceholderProps) {
  if (!visible) return null;
  return <>
    {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFillObject} /> : null}
    <View pointerEvents="none" style={styles.shade} />
    {locked ? <View accessibilityLabel="Conteúdo bloqueado" style={styles.center}>
      <View style={styles.lock}><Ionicons name="lock-closed" color={colors.background} size={36} /></View>
    </View> : loading || error ? <View pointerEvents="none" style={styles.center}>
      <View accessibilityRole={error ? 'alert' : 'progressbar'} accessibilityLabel={error || 'Carregando conteúdo'} style={styles.status}>
        {!error && <ActivityIndicator color={colors.text} size="small" />}
        <Text style={styles.statusText}>{error || 'Carregando…'}</Text>
      </View>
    </View> : null}
    <Text style={styles.formatBadge}>{format}</Text>
  </>;
}

const styles = StyleSheet.create({
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlaySoft },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  status: { maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.overlay, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  statusText: { color: colors.text, fontSize: typography.caption, lineHeight: 18, flexShrink: 1 },
  lock: { alignItems: 'center', justifyContent: 'center', width: 76, height: 76, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.9)' },
  formatBadge: { backgroundColor: colors.overlay, borderRadius: radius.pill, bottom: spacing.md, color: colors.text, fontSize: typography.caption, fontWeight: typography.weightBlack, left: spacing.md, overflow: 'hidden', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, position: 'absolute', textTransform: 'uppercase' },
});
