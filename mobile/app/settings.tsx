import { NavigationHeader } from '@/components/NavigationHeader';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  Wallet,
  Crown,
  Settings as TechIcon,
  MessageSquare,
  ShieldAlert,
  LogOut,
  Image as ImageIcon,
  Check,
  ShieldCheck,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DataAction, DataCard, DataRow, DataSection } from '@/components/data/DataUI';
import { PlanCrown } from '@/components/PlanCrown';
import { dataStyles, dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

type PrivacyMode = 'open' | 'followers' | 'request' | 'closed';

export default function SettingsScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [savingPrivacy, setSavingPrivacy] = useState(false);

  // Settings Sections State
  const [activeSection, setActiveSection] = useState<'menu' | 'channel' | 'privacy' | 'plan'>('menu');

  // Channel Config
  const [channelName, setChannelName] = useState(profile?.creator_channel_name || '');
  const [coverUrl, setCoverUrl] = useState(profile?.cover_image_url || '');

  // Privacy Config
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('open');

  useEffect(() => {
    if (profile) {
      setChannelName(profile.creator_channel_name || '');
      setCoverUrl(profile.cover_image_url || '');
    }
  }, [profile]);

  useEffect(() => {
    if (user) {
      loadPrivacySettings();
    }
  }, [user]);

  const loadPrivacySettings = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('message_settings')
        .select('privacy_mode')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        setPrivacyMode(data.privacy_mode as PrivacyMode);
      }
    } catch (e) {
      console.error('Error loading message privacy settings:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveChannel = async () => {
    if (!channelName.trim() || !user) return;
    try {
      setSavingChannel(true);
      const cleanChannel = channelName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');

      if (cleanChannel.length < 3) {
        Alert.alert('Erro', 'O nome do canal deve conter pelo menos 3 caracteres.');
        return;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          creator_channel_name: cleanChannel,
          cover_image_url: coverUrl.trim() || null,
        })
        .eq('id', user.id);

      if (error) throw error;
      await refreshProfile();
      Alert.alert('Sucesso', 'Canal do Creator atualizado com sucesso!');
      setActiveSection('menu');
    } catch (e: any) {
      console.error('Error saving channel:', e);
      Alert.alert('Erro', 'Nome de canal indisponível ou inválido.');
    } finally {
      setSavingChannel(false);
    }
  };

  const updatePrivacySettings = async (newMode: PrivacyMode) => {
    if (!user || savingPrivacy) return;
    try {
      setSavingPrivacy(true);
      setPrivacyMode(newMode);

      const { error } = await supabase
        .from('message_settings')
        .upsert({
          user_id: user.id,
          privacy_mode: newMode,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'user_id'
        });

      if (error) throw error;
    } catch (e) {
      console.error('Error updating privacy settings:', e);
      Alert.alert('Erro', 'Não foi possível salvar as configurações de privacidade.');
      loadPrivacySettings(); // Revert state
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  const plan = profile?.plan === 'pro' || profile?.plan === 'premium' ? profile.plan : 'free';
  const planLabel = plan === 'premium' ? 'Premium' : plan === 'pro' ? 'Pro' : 'Free';

  const renderContent = () => {
    if (!user) {
      return (
        <DataCard style={styles.authNotice}>
          <ShieldAlert size={28} strokeWidth={t.stroke} color={t.secondary} />
          <Text style={dataStyles.sectionTitle}>Entre na sua conta</Text>
          <Text style={[dataStyles.body, styles.centered]}>Acesse seu perfil, seu canal e suas preferências de privacidade.</Text>
          <DataAction label="Entrar" onPress={() => router.push('/auth/sign-in')} />
        </DataCard>
      );
    }

    switch (activeSection) {
      case 'channel':
        return (
          <DataSection title="Seu canal" subtitle="Informações públicas para quem acompanha seus conteúdos.">
            <DataCard style={styles.formCard}>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Nome do canal</Text>
                <TextInput
                  accessibilityLabel="Nome do canal"
                  style={dataStyles.input}
                  value={channelName}
                  onChangeText={setChannelName}
                  placeholder="Ex.: joao_mentor"
                  placeholderTextColor={t.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!savingChannel}
                />
                <Text style={dataStyles.label}>Use letras minúsculas, números, traços e underscores. Mínimo de 3 caracteres.</Text>
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.label}>Link da capa</Text>
                <TextInput
                  accessibilityLabel="Link da capa do canal"
                  style={dataStyles.input}
                  value={coverUrl}
                  onChangeText={setCoverUrl}
                  placeholder="URL da imagem horizontal"
                  placeholderTextColor={t.subtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  editable={!savingChannel}
                />
              </View>
              {coverUrl ? <Image source={{ uri: coverUrl }} style={styles.bannerPreviewImage} contentFit="cover" accessibilityLabel="Prévia da capa do canal" /> : null}
              <DataAction label="Salvar canal" onPress={handleSaveChannel} busy={savingChannel} disabled={!channelName.trim()} />
            </DataCard>
          </DataSection>
        );
      case 'privacy':
        return (
          <DataSection title="Mensagens" subtitle="Escolha quem pode enviar mensagens diretas para você.">
            {loading ? <ActivityIndicator color={t.secondary} style={styles.loading} /> : (
              <DataCard style={styles.radioGroup}>
                {[
                  { value: 'open', label: 'Qualquer pessoa', desc: 'Receba mensagens de qualquer pessoa na Classfy.' },
                  { value: 'followers', label: 'Pessoas que sigo', desc: 'Receba mensagens apenas de quem você segue.' },
                  { value: 'request', label: 'Aprovar contatos', desc: 'Aceite ou recuse uma solicitação antes da conversa.' },
                  { value: 'closed', label: 'Não receber mensagens', desc: 'Ninguém pode iniciar uma conversa com você.' },
                ].map((opt, index) => (
                  <Pressable
                    key={opt.value}
                    accessibilityRole="radio"
                    accessibilityLabel={opt.label}
                    accessibilityState={{ checked: privacyMode === opt.value, disabled: savingPrivacy }}
                    style={({ pressed }) => [styles.radioItem, index < 3 && styles.radioDivider, pressed && styles.pressed]}
                    onPress={() => updatePrivacySettings(opt.value as PrivacyMode)}
                    disabled={savingPrivacy}
                  >
                    <View style={styles.radioCopy}>
                      <Text style={styles.radioLabel}>{opt.label}</Text>
                      <Text style={dataStyles.label}>{opt.desc}</Text>
                    </View>
                    <View style={[styles.radioCircle, privacyMode === opt.value && styles.radioCircleActive]}>
                      {privacyMode === opt.value ? <Check size={14} strokeWidth={2} color={t.ink} /> : null}
                    </View>
                  </Pressable>
                ))}
              </DataCard>
            )}
          </DataSection>
        );
      case 'plan':
        return (
          <DataSection title="Sua assinatura" subtitle="Consulte o plano vinculado à sua conta.">
            <DataCard style={styles.formCard}>
              <View style={styles.planIdentity}>
                <View style={styles.planIcon}>{plan === 'free' ? <ShieldCheck size={24} strokeWidth={t.stroke} color={t.secondary} /> : <PlanCrown plan={plan} size={24} />}</View>
                <View style={styles.radioCopy}><Text style={dataStyles.label}>Plano atual</Text><Text style={styles.planTitle}>Classfy {planLabel}</Text></View>
              </View>
              <Text style={dataStyles.body}>{plan === 'free' ? 'Você está no plano gratuito. Conheça as opções Pro e Premium para ampliar seus recursos.' : 'Consulte os benefícios e as condições da sua assinatura.'}</Text>
              {plan === 'free' ? <DataAction label="Conhecer os planos" onPress={() => Alert.alert('Upgrade', 'Upgrade disponível na versão Web.')} /> : null}
            </DataCard>
          </DataSection>
        );
      default:
        return (
          <View style={styles.menuList}>
            <DataSection title="Sua conta">
              <DataCard style={styles.menuCard}>
                <DataRow icon={Wallet} title="Carteira e saques" subtitle="Saldo, valores e movimentações" onPress={() => router.push('/carteira')} />
                <DataRow icon={Crown} title="Assinatura" subtitle={`Classfy ${planLabel}`} onPress={() => setActiveSection('plan')} last />
              </DataCard>
            </DataSection>
            <DataSection title="Preferências">
              <DataCard style={styles.menuCard}>
                <DataRow icon={ImageIcon} title="Canal do creator" subtitle="Nome e capa do seu canal" onPress={() => setActiveSection('channel')} />
                <DataRow icon={MessageSquare} title="Privacidade de mensagens" subtitle="Quem pode falar com você" onPress={() => setActiveSection('privacy')} last />
              </DataCard>
            </DataSection>
            <DataCard style={styles.menuCard}><DataRow icon={LogOut} title="Sair da conta" destructive onPress={handleSignOut} last /></DataCard>
          </View>
        );
    }
  };

  return (
    <AppScreen edgeToEdge scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.content}>
        <NavigationHeader title={activeSection === 'menu' ? 'Configurações' : activeSection === 'channel' ? 'Canal' : activeSection === 'privacy' ? 'Privacidade' : 'Assinatura'}
          onBack={() => activeSection !== 'menu' ? setActiveSection('menu') : router.canGoBack() ? router.back() : router.replace('/')} />
        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {renderContent()}
          {__DEV__ && activeSection === 'menu' ? (
            <View style={styles.diagnostics}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDiagnostics }} onPress={() => setShowDiagnostics((value) => !value)} style={styles.diagnosticsToggle}>
                <TechIcon size={16} strokeWidth={t.stroke} color={t.subtle} />
                <Text style={dataStyles.label}>Diagnóstico de desenvolvimento</Text>
              </Pressable>
              {showDiagnostics ? <DataCard><DataRow title="Conexão de dados" value={isSupabaseConfigured ? 'Configurada' : 'Indisponível'} /><DataRow title="Sistema" value={Platform.OS.toUpperCase()} last /></DataCard> : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.section * 2, gap: spacing.xxl },
  menuList: { gap: spacing.xxl },
  menuCard: { paddingVertical: 0 },
  formCard: { gap: spacing.xl },
  formGroup: { gap: spacing.sm },
  label: { color: t.secondary, fontSize: 14, fontWeight: '500' },
  bannerPreviewImage: { width: '100%', aspectRatio: 16 / 9, borderRadius: t.controlRadius },
  loading: { marginVertical: spacing.section },
  radioGroup: { paddingVertical: 0 },
  radioItem: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.lg },
  radioDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border },
  radioCopy: { flex: 1, gap: spacing.xs },
  radioLabel: { color: t.ink, fontSize: 14, fontWeight: '500', lineHeight: 20 },
  radioCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: t.subtle, alignItems: 'center', justifyContent: 'center' },
  radioCircleActive: { borderColor: t.accent, backgroundColor: t.accent },
  pressed: { opacity: 0.72 },
  planIdentity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  planIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: t.controlRadius, backgroundColor: t.raised },
  planTitle: { color: t.ink, fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  authNotice: { gap: spacing.lg, alignItems: 'center', marginTop: spacing.lg },
  centered: { textAlign: 'center' },
  diagnostics: { gap: spacing.sm },
  diagnosticsToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
