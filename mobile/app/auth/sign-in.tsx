import { NavigationHeader } from '@/components/NavigationHeader';
import { controls } from '@/theme/controls';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AppScreen } from '@/components/AppScreen';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function SignInScreen() {
  const { contentId } = useLocalSearchParams<{ contentId?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    if (!isSupabaseConfigured) {
      Alert.alert('Não foi possível conectar', 'Tente novamente mais tarde.');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      Alert.alert('Erro ao entrar', error.message);
      return;
    }

    if (typeof contentId === 'string' && /^[0-9a-f-]{36}$/i.test(contentId)) {
      router.replace({ pathname: '/watch/[id]', params: { id: contentId } });
    } else {
      router.replace('/(tabs)');
    }
  }

  return (
    <AppScreen header={<NavigationHeader title="Entrar" back />}>

      <View style={styles.header}>
        <Text style={styles.title}>Entrar</Text>
        <Text style={styles.subtitle}>Seus conteúdos, estudos e conquistas, sempre com você.</Text>
      </View>

      <View style={styles.form}>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Seu e-mail"
          autoComplete="email"
          textContentType="emailAddress"
          placeholderTextColor={colors.muted}
          style={styles.input}
          value={email}
        />
        <TextInput
          onChangeText={setPassword}
          placeholder="Sua senha"
          autoComplete="current-password"
          textContentType="password"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          value={password}
        />
        <Pressable disabled={loading} onPress={handleSignIn} style={styles.button}>
          <Text style={styles.buttonText}>{loading ? 'Entrando...' : 'Entrar'}</Text>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push('/auth/sign-up')} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 16 }}><Text style={{ color: colors.textSecondary }}>Ainda não tem conta? Criar conta</Text></Pressable>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: type.xxxl,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.muted,
    fontSize: type.md,
  },
  form: {
    gap: spacing.md,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: type.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: controls.buttonRadius,
    paddingVertical: spacing.md,
  },
  buttonText: {
    color: colors.background,
    fontSize: type.md,
    fontWeight: '700',
  },
});
