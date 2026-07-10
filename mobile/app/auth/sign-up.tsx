import { Href, Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function SignUpScreen() {
  return (
    <AppScreen>
      <View style={styles.panel}>
        <Text style={styles.title}>Criar conta</Text>
        <Text style={styles.body}>
          Cadastro mobile esta reservado para a proxima iteracao, junto com deep links e redirects do Supabase Auth.
        </Text>
        <Link href={'/auth/sign-in' as Href} asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>Ir para login</Text>
          </Pressable>
        </Link>
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: type.xxxl,
    fontWeight: '700',
  },
  body: {
    color: colors.muted,
    fontSize: type.md,
    lineHeight: 22,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  buttonText: {
    color: colors.background,
    fontSize: type.md,
    fontWeight: '700',
  },
});
