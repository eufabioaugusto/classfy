import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function SettingsScreen() {
  const { user, profile } = useAuth();

  return (
    <AppScreen>
      <Text style={styles.title}>Settings</Text>
      <View style={styles.row}>
        <Text style={styles.label}>Supabase</Text>
        <Text style={[styles.value, isSupabaseConfigured ? styles.ok : styles.warn]}>
          {isSupabaseConfigured ? 'Configurado' : 'Env pendente'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Deep link scheme</Text>
        <Text style={styles.value}>classfy://</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Sessao</Text>
        <Text style={[styles.value, user ? styles.ok : styles.warn]}>
          {user ? 'Logado' : 'Deslogado'}
        </Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Plano</Text>
        <Text style={styles.value}>{profile?.plan || 'free'}</Text>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: type.xxxl,
    fontWeight: '900',
    marginBottom: spacing.xl,
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  label: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '800',
  },
  value: {
    color: colors.muted,
    fontSize: type.sm,
    fontWeight: '800',
  },
  ok: {
    color: colors.lime,
  },
  warn: {
    color: colors.amber,
  },
});
