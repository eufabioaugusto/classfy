import { useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { LockKeyhole, Mail, UserRound } from 'lucide-react-native';
import { AuthScene, authColors } from '@/features/auth/AuthScene';
import { AuthButton, AuthDivider, AuthField, AuthNotice, authStyles } from '@/features/auth/AuthControls';
import { useGoogleSignIn } from '@/features/auth/useGoogleSignIn';
import { resolveAuthDestination } from '@/features/auth/oauth';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const params = useLocalSearchParams<{ contentId?: string; liveId?: string }>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const google = useGoogleSignIn(params);
  const busy = loading || google.googleLoading;

  async function handleSignUp() {
    if (busy || sent) return;
    Keyboard.dismiss(); setError(''); google.clearGoogleError();
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || password.length < 6) {
      setError('Informe seu nome, um e-mail válido e uma senha com pelo menos 6 caracteres.'); return;
    }
    if (!isSupabaseConfigured) { setError('Não foi possível conectar. Tente novamente em instantes.'); return; }
    setLoading(true);
    try {
      const { data, error: signupError } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { emailRedirectTo: 'https://classfy.com.br/', data: { display_name: name.trim() } } });
      if (signupError) {
        setError(signupError.code === 'weak_password' ? 'Escolha uma senha mais forte para proteger sua conta.' : 'Não foi possível criar sua conta. Tente novamente ou entre se já tem cadastro.'); return;
      }
      if (data.session) router.replace(resolveAuthDestination(params));
      else { setSent(true); setPassword(''); }
    } catch { setError('Não foi possível conectar. Confira sua conexão e tente novamente.'); }
    finally { setLoading(false); }
  }

  async function handleGoogle() {
    Keyboard.dismiss(); setError('');
    const result = await google.signInWithGoogle();
    if (result?.status === 'success' && result.destination) router.replace(result.destination);
  }

  return <AuthScene dense title={sent ? 'Seu próximo passo chegou.' : 'Comece a ir além.'} subtitle={sent ? 'Confirme seu e-mail pelo link que enviamos. Depois, entre na sua conta.' : 'Seu espaço para aprender e criar.'}>
    {!sent && google.googleAvailable && <><AuthButton google label={google.googleLoading ? 'Conectando com Google...' : 'Continuar com Google'} loading={google.googleLoading} disabled={loading} onPress={() => void handleGoogle()} /><AuthDivider /></>}
    <View style={authStyles.form}>
      <AuthNotice text={error || google.googleError} />
      {sent ? <AuthButton label="Ir para login" onPress={() => router.replace({ pathname: '/auth/sign-in', params })} /> : <>
        <AuthField label="Nome" icon={<UserRound size={19} color={authColors.secondary} strokeWidth={1.6} />} textContentType="name" autoComplete="name" placeholder="Como podemos chamar você?" value={name} onChangeText={setName} editable={!busy} returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
        <AuthField ref={emailRef} label="E-mail" icon={<Mail size={19} color={authColors.secondary} strokeWidth={1.6} />} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" placeholder="seu@email.com" value={email} onChangeText={setEmail} editable={!busy} returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <AuthField ref={passwordRef} label="Senha" password icon={<LockKeyhole size={19} color={authColors.secondary} strokeWidth={1.6} />} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" placeholder="Pelo menos 6 caracteres" value={password} onChangeText={setPassword} editable={!busy} returnKeyType="go" onSubmitEditing={() => void handleSignUp()} />
        <AuthButton label={loading ? 'Criando sua conta...' : 'Criar conta'} loading={loading} disabled={google.googleLoading} onPress={() => void handleSignUp()} />
        <Text style={{ color: authColors.secondary, fontSize: 11, lineHeight: 18, textAlign: 'center' }}>Ao continuar, você concorda com os <Text accessibilityRole="link" style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL('https://classfy.com.br/termos')}>Termos de uso</Text> e a <Text accessibilityRole="link" style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL('https://classfy.com.br/privacidade')}>Política de privacidade</Text>.</Text>
      </>}
    </View>
    {!sent && <Pressable accessibilityRole="button" disabled={busy} onPress={() => router.replace({ pathname: '/auth/sign-in', params })} style={authStyles.footer}><Text style={authStyles.footerText}>Já tem conta? <Text style={authStyles.footerStrong}>Entrar</Text></Text></Pressable>}
  </AuthScene>;
}
