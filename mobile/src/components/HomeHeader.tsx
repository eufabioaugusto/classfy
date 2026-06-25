import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

export function HomeHeader() {
  return (
    <View style={styles.container}>
      <View>
        <Text style={styles.brand}>Classfy</Text>
        <Text style={styles.context}>Explore aulas, creators e recompensas</Text>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.iconButton}>
          <Ionicons name="search-outline" color={colors.text} size={20} />
        </Pressable>
        <Pressable style={styles.iconButton}>
          <Ionicons name="notifications-outline" color={colors.text} size={20} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  brand: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
    letterSpacing: 0,
  },
  context: {
    color: colors.muted,
    fontSize: typography.caption,
    fontWeight: typography.weightMedium,
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
});
