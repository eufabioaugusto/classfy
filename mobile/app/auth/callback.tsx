import { router, useLocalSearchParams } from 'expo-router';
import { useLinkingURL } from 'expo-linking';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AuthButton, AuthNotice, authStyles } from '@/features/auth/AuthControls';
import { AuthScene, authColors } from '@/features/auth/AuthScene';
import { completeGoogleOAuth } from '@/features/auth/googleOAuth';
import { GOOGLE_OAUTH_REDIRECT, MobileOAuthError } from '@/features/auth/oauth';

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string; attempt?: string; error?: string; error_code?: string;
  }>();
  const linkingURL = useLinkingURL();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const callback = new URL(GOOGLE_OAUTH_REDIRECT);
    for (const key of ['code', 'attempt', 'error', 'error_code'] as const) {
      if (typeof params[key] === 'string') callback.searchParams.set(key, params[key]);
    }
    void (async () => {
      try {
        // The native URL also preserves provider errors delivered in a fragment.
        const result = await completeGoogleOAuth(linkingURL?.startsWith(`${GOOGLE_OAUTH_REDIRECT}?`)
          ? linkingURL : callback.href);
        if (!mounted) return;
        router.replace(result.status === 'success' ? result.destination : '/auth/sign-in');
      } catch (caught) {
        if (mounted) setError(caught instanceof MobileOAuthError
          ? caught.message : 'Não foi possível concluir seu acesso. Tente novamente.');
      }
    })();
    return () => { mounted = false; };
  }, [linkingURL, params.code, params.attempt, params.error, params.error_code]);

  return (
    <AuthScene title="Quase lá." subtitle="Estamos confirmando seu acesso." onBack={() => router.replace('/auth/sign-in')}>
      <View style={authStyles.form}>
      {error ? (
        <>
          <AuthNotice text={error} />
          <AuthButton label="Voltar para entrar" onPress={() => router.replace('/auth/sign-in')} />
        </>
      ) : (
        <>
          <ActivityIndicator color={authColors.brand} accessibilityLabel="Confirmando seu acesso" />
        </>
      )}
      </View>
    </AuthScene>
  );
}
