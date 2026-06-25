import { Href, Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { SectionHeader } from '@/components/SectionHeader';
import { useAuth } from '@/features/auth/authContext';
import { colors, radius, spacing, type } from '@/theme/tokens';

const items = ['Historico', 'Salvos', 'Favoritos', 'Carteira', 'Mensagens'];

export default function ProfileScreen() {
  const { configured, loading, user, profile, signOut } = useAuth();
  const displayName = profile?.creator_channel_name || profile?.display_name || user?.email || 'Conta Classfy';
  const subtitle = user
    ? `${profile?.plan || 'free'} · ${user.email || 'usuario logado'}`
    : configured
      ? 'Entre para carregar perfil, carteira e biblioteca.'
      : 'Configure o Supabase para entrar.';

  return (
    <AppScreen>
      <View style={styles.profileHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{displayName[0]?.toUpperCase() || 'C'}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.meta}>{subtitle}</Text>
        </View>
      </View>

      <View style={styles.actions}>
        {loading ? (
          <View style={styles.primaryButton}>
            <ActivityIndicator color={colors.background} />
          </View>
        ) : user ? (
          <Pressable style={styles.primaryButton} onPress={signOut}>
            <Text style={styles.primaryButtonText}>Sair</Text>
          </Pressable>
        ) : (
          <Link href={'/auth/sign-in' as Href} asChild>
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Entrar</Text>
            </Pressable>
          </Link>
        )}
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
            <Text style={styles.itemMeta}>{user ? 'Conectado' : 'Login'}</Text>
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
