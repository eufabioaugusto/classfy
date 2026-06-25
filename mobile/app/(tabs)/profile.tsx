import { Href, Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { SectionHeader } from '@/components/SectionHeader';
import { colors, radius, spacing, type } from '@/theme/tokens';

const items = ['Historico', 'Salvos', 'Favoritos', 'Carteira', 'Mensagens'];

export default function ProfileScreen() {
  return (
    <AppScreen>
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>C</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.name}>Conta Classfy</Text>
          <Text style={styles.meta}>Auth Supabase preparado para conectar.</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Link href={'/auth/sign-in' as Href} asChild>
          <Pressable style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Entrar</Text>
          </Pressable>
        </Link>
        <Link href={'/settings' as Href} asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Settings</Text>
          </Pressable>
        </Link>
      </View>

      <SectionHeader eyebrow="Biblioteca futura" title="Atalhos da conta" />
      <View style={styles.list}>
        {items.map((item) => (
          <View key={item} style={styles.item}>
            <Text style={styles.itemText}>{item}</Text>
            <Text style={styles.itemMeta}>Planejado</Text>
          </View>
        ))}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  profileHeader: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.lg,
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  avatarText: {
    color: colors.background,
    fontSize: 28,
    fontWeight: '900',
  },
  profileCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    color: colors.text,
    fontSize: type.xl,
    fontWeight: '900',
  },
  meta: {
    color: colors.muted,
    fontSize: type.sm,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.md,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: type.md,
    fontWeight: '900',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    paddingVertical: spacing.md,
  },
  secondaryButtonText: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '800',
  },
  list: {
    gap: spacing.sm,
  },
  item: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  itemText: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '800',
  },
  itemMeta: {
    color: colors.muted,
    fontSize: type.sm,
  },
});
