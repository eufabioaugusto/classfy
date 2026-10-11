import { useRef, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LockKeyhole, Mail } from 'lucide-react-native';

import { AuthScene, authColors } from '@/features/auth/AuthScene';
import { AuthButton, AuthDivider, AuthField, AuthNotice, authStyles } from '@/features/auth/AuthControls';
import { useGoogleSignIn } from '@/features/auth/useGoogleSignIn';
import { resolveAuthDestination } from '@/features/auth/oauth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const params = useLocalSearchParams<{ contentId?: string; liveId?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const google = useGoogleSignIn(params);
  const busy = loading || google.googleLoading;

  async function handleSignIn() {
    if (busy) return;
    Keyboard.dismiss();
    setError('');
    google.clearGoogleError();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || (!recovery && !password)) {
      setError(recovery ? 'Informe seu e-mail para recuperar o acesso.' : 'Preencha seu e-mail e senha para continuar.');
      return;
    }
    if (!isSupabaseConfigured) { setError('Não foi possível conectar. Tente novamente em instantes.'); return; }
    setLoading(true);
    try {
      if (recovery) {
        const { error: requestError } = await supabase.functions.invoke('request-password-reset', { body: { email: email.trim().toLowerCase() } });
        if (requestError) throw requestError;
        setRecoverySent(true);
      } else {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
        if (loginError) {
          setError(loginError.code === 'invalid_credentials' ? 'E-mail ou senha incorretos. Confira e tente novamente.' : loginError.code === 'email_not_confirmed' ? 'Confirme seu e-mail antes de entrar. Confira sua caixa de entrada.' : 'Não foi possível entrar. Tente novamente em instantes.');
          return;
        }
        router.replace(resolveAuthDestination(params));
      }
    } catch { setError('Não foi possível conectar. Confira sua conexão e tente novamente.'); }
    finally { setLoading(false); }
  }

  async function handleGoogle() {
    Keyboard.dismiss();
    setError('');
    const result = await google.signInWithGoogle();
    if (result?.status === 'success' && result.destination) router.replace(result.destination);
  }

  function closeRecovery() { setRecovery(false); setRecoverySent(false); setError(''); }

  return <AuthScene title={recovery ? 'Recupere seu acesso.' : 'Bom ter você aqui.'} subtitle={recovery ? 'Enviaremos um link para você criar uma nova senha.' : 'Seus conteúdos, estudos e conquistas.\nTudo no seu ritmo.'} onBack={recovery ? closeRecovery : undefined}>
    {!recovery && google.googleAvailable && <>
      <AuthButton google label={google.googleLoading ? 'Conectando com Google...' : 'Continuar com Google'} loading={google.googleLoading} disabled={loading} onPress={() => void handleGoogle()} />
      <AuthDivider />
    </>}
    <View style={authStyles.form}>
      <AuthNotice text={error || google.googleError} />
      <AuthNotice success text={recoverySent ? 'Link enviado. Confira sua caixa de entrada e o spam para recuperar o acesso.' : ''} />
      <AuthField label="E-mail" icon={<Mail size={19} color={authColors.secondary} strokeWidth={1.6} />} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="seu@email.com" value={email} onChangeText={setEmail} editable={!busy} returnKeyType={recovery ? 'go' : 'next'} onSubmitEditing={() => recovery ? void handleSignIn() : passwordRef.current?.focus()} />
      {!recovery && <>
        <AuthField ref={passwordRef} label="Senha" password icon={<LockKeyhole size={19} color={authColors.secondary} strokeWidth={1.6} />} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" placeholder="Sua senha" value={password} onChangeText={setPassword} editable={!busy} returnKeyType="go" onSubmitEditing={() => void handleSignIn()} />
        <Pressable accessibilityRole="button" disabled={busy} style={authStyles.forgot} onPress={() => { setRecovery(true); setError(''); google.clearGoogleError(); }}><Text style={authStyles.link}>Esqueci minha senha</Text></Pressable>
      </>}
      <AuthButton label={loading ? recovery ? 'Enviando link...' : 'Entrando...' : recovery ? recoverySent ? 'Enviar novamente' : 'Enviar link' : 'Entrar'} loading={loading} disabled={google.googleLoading} onPress={() => void handleSignIn()} />
    </View>
    <Pressable accessibilityRole="button" disabled={busy} onPress={recovery ? closeRecovery : () => router.push({ pathname: '/auth/sign-up', params })} style={authStyles.footer}>
      <Text style={authStyles.footerText}>{recovery ? 'Lembrou sua senha? ' : 'Ainda não tem conta? '}<Text style={authStyles.footerStrong}>{recovery ? 'Entrar' : 'Criar conta'}</Text></Text>
    </Pressable>
  </AuthScene>;
}
