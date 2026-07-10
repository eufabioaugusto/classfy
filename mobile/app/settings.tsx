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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  ArrowLeft,
  User,
  Wallet,
  Crown,
  Settings as TechIcon,
  MessageSquare,
  ChevronRight,
  ShieldAlert,
  LogOut,
  Image as ImageIcon,
  Check,
} from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

type PrivacyMode = 'open' | 'followers' | 'request' | 'closed';

export default function SettingsScreen() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
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

  const renderContent = () => {
    if (!user) {
      return (
        <View style={styles.authNotice}>
          <ShieldAlert size={32} color={colors.accent} style={{ marginBottom: spacing.sm }} />
          <Text style={styles.authNoticeTitle}>Acesso Restrito</Text>
          <Text style={styles.authNoticeBody}>
            Faça login para poder configurar seu perfil, gerenciar seu canal de criador e alterar níveis de privacidade.
          </Text>
          <Pressable style={styles.authBtn} onPress={() => router.push('/auth/sign-in')}>
            <Text style={styles.authBtnText}>Entrar na Conta</Text>
          </Pressable>
        </View>
      );
    }

    switch (activeSection) {
      case 'channel':
        return (
          <View style={styles.settingsForm}>
            <Text style={styles.sectionTitle}>Canal do Creator</Text>
            <Text style={styles.sectionSubtitle}>Configure as informações públicas do seu canal de conteúdos</Text>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Nome do Canal (Handle)</Text>
              <TextInput
                style={styles.input}
                value={channelName}
                onChangeText={setChannelName}
                placeholder="Ex: joao_mentor"
                placeholderTextColor="rgba(255, 255, 255, 0.4)"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!savingChannel}
              />
              <Text style={styles.inputHelp}>Apenas letras minúsculas, números, traços e underscores. Mínimo 3 caracteres.</Text>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Link da Capa do Canal</Text>
              <TextInput
                style={styles.input}
                value={coverUrl}
                onChangeText={setCoverUrl}
                placeholder="Cole a URL da capa (formato horizontal)"
                placeholderTextColor="rgba(255, 255, 255, 0.4)"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!savingChannel}
              />
            </View>

            {coverUrl ? (
              <View style={styles.bannerPreviewContainer}>
                <Text style={styles.label}>Prévia da Capa</Text>
                <Image source={{ uri: coverUrl }} style={styles.bannerPreviewImage} />
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryActionBtn, (!channelName.trim() || savingChannel) && styles.btnDisabled]}
              onPress={handleSaveChannel}
              disabled={!channelName.trim() || savingChannel}
            >
              {savingChannel ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.primaryActionText}>Salvar Canal</Text>}
            </Pressable>
          </View>
        );

      case 'privacy':
        return (
          <View style={styles.settingsForm}>
            <Text style={styles.sectionTitle}>Privacidade de Mensagens</Text>
            <Text style={styles.sectionSubtitle}>Defina quem pode enviar mensagens diretas (DMs) para você</Text>

            {loading ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
            ) : (
              <View style={styles.radioGroup}>
                {[
                  { value: 'open', label: 'Mensagens Abertas', desc: 'Qualquer pessoa pode enviar mensagens diretas' },
                  { value: 'followers', label: 'Apenas Seguidores', desc: 'Somente pessoas que você segue podem te enviar DMs' },
                  { value: 'request', label: 'Aprovar Contato', desc: 'Contatos precisam enviar solicitação para você aceitar/recusar' },
                  { value: 'closed', label: 'Não Permitir Envio', desc: 'Ninguém pode enviar mensagens para você' },
                ].map((opt) => (
                  <Pressable
                    key={opt.value}
                    style={[styles.radioItem, privacyMode === opt.value && styles.radioItemActive]}
                    onPress={() => updatePrivacySettings(opt.value as PrivacyMode)}
                    disabled={savingPrivacy}
                  >
                    <View style={styles.radioLeft}>
                      <View style={[styles.radioCircle, privacyMode === opt.value && styles.radioCircleActive]}>
                        {privacyMode === opt.value ? <View style={styles.radioDot} /> : null}
                      </View>
                      <View style={styles.radioTextContainer}>
                        <Text style={styles.radioLabel}>{opt.label}</Text>
                        <Text style={styles.radioDesc}>{opt.desc}</Text>
                      </View>
                    </View>
                    {privacyMode === opt.value ? <Check size={16} color={colors.accent} /> : null}
                  </Pressable>
                ))}
              </View>
            )}
          </View>
        );

      case 'plan':
        return (
          <View style={styles.settingsForm}>
            <Text style={styles.sectionTitle}>Assinatura & Plano</Text>
            <Text style={styles.sectionSubtitle}>Gerencie sua assinatura ativa na plataforma Classfy</Text>

            <View style={styles.planCard}>
              <Crown size={22} color={colors.accent} style={{ marginBottom: spacing.sm }} />
              <Text style={styles.planTitle}>Plano {(profile?.plan || 'free').toUpperCase()}</Text>
              <Text style={styles.planDescription}>
                {(profile?.plan || 'free') === 'free'
                  ? 'Você está no plano gratuito. Faça upgrade para o Pro ou Premium para obter acesso a estudos e mensagens ilimitados.'
                  : 'Sua assinatura está ativa e você possui acesso ilimitado a todas as ferramentas e conteúdos.'}
              </Text>
            </View>

            {(profile?.plan || 'free') === 'free' ? (
              <Pressable style={styles.primaryActionBtn} onPress={() => Alert.alert('Upgrade', 'Upgrade disponível na versão Web.')}>
                <Text style={styles.primaryActionText}>Fazer Upgrade do Plano</Text>
              </Pressable>
            ) : null}
          </View>
        );

      default:
        return (
          <View style={styles.menuList}>
            {/* Wallet Direct */}
            <Pressable style={styles.menuItem} onPress={() => router.push('/carteira')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.iconBox}>
                  <Wallet size={18} color={colors.accent} />
                </View>
                <Text style={styles.menuItemText}>Minha Carteira & Saques</Text>
              </View>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>

            {/* Creator settings */}
            <Pressable style={styles.menuItem} onPress={() => setActiveSection('channel')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.iconBox}>
                  <ImageIcon size={18} color={colors.accent} />
                </View>
                <Text style={styles.menuItemText}>Canal do Creator</Text>
              </View>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>

            {/* Privacy settings */}
            <Pressable style={styles.menuItem} onPress={() => setActiveSection('privacy')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.iconBox}>
                  <MessageSquare size={18} color={colors.accent} />
                </View>
                <Text style={styles.menuItemText}>Privacidade de Mensagens</Text>
              </View>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>

            {/* Plan Info */}
            <Pressable style={styles.menuItem} onPress={() => setActiveSection('plan')}>
              <View style={styles.menuItemLeft}>
                <View style={styles.iconBox}>
                  <Crown size={18} color={colors.accent} />
                </View>
                <Text style={styles.menuItemText}>Gerenciar Plano</Text>
              </View>
              <ChevronRight size={16} color={colors.muted} />
            </Pressable>

            {/* Log Out */}
            <Pressable style={[styles.menuItem, styles.logoutItem]} onPress={handleSignOut}>
              <View style={styles.menuItemLeft}>
                <View style={[styles.iconBox, { backgroundColor: 'rgba(239, 68, 68, 0.08)' }]}>
                  <LogOut size={18} color="#ef4444" />
                </View>
                <Text style={[styles.menuItemText, { color: '#ef4444' }]}>Sair da Conta</Text>
              </View>
              <ChevronRight size={16} color="rgba(239, 68, 68, 0.4)" />
            </Pressable>
          </View>
        );
    }
  };

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        
        {/* Dynamic Header based on active section */}
        <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
          <Pressable
            onPress={() => {
              if (activeSection !== 'menu') {
                setActiveSection('menu');
              } else {
                router.back();
              }
            }}
            style={styles.backBtn}
          >
            <ArrowLeft size={20} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>
            {activeSection === 'menu'
              ? 'Configurações'
              : activeSection === 'channel'
                ? 'Canal'
                : activeSection === 'privacy'
                  ? 'Privacidade'
                  : 'Assinatura'}
          </Text>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {renderContent()}

          {/* Dev Debug Section at bottom of main menu */}
          {activeSection === 'menu' && (
            <View style={styles.devCard}>
              <View style={styles.cardHeader}>
                <TechIcon size={14} color={colors.muted} style={{ marginRight: 6 }} />
                <Text style={styles.cardTitle}>Especificações Técnicas</Text>
              </View>
              <View style={styles.techRow}>
                <Text style={styles.techLabel}>Supabase Link</Text>
                <Text style={[styles.techVal, isSupabaseConfigured ? styles.techOk : styles.techErr]}>
                  {isSupabaseConfigured ? 'Conectado' : 'Desconectado'}
                </Text>
              </View>
              <View style={styles.techRow}>
                <Text style={styles.techLabel}>Mobile Build OS</Text>
                <Text style={styles.techVal}>{Platform.OS.toUpperCase()}</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  backBtn: {
    marginRight: spacing.sm,
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  headerTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: typography.weightBold,
  },
  content: {
    flex: 1,
  },
  menuList: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  menuItem: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderRadius: radius.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    marginBottom: spacing.md,
  },
  logoutItem: {
    borderColor: 'rgba(239, 68, 68, 0.1)',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
  },
  settingsForm: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: typography.weightBold,
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: spacing.xl,
  },
  formGroup: {
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: typography.weightBold,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    paddingHorizontal: spacing.md,
    height: 44,
  },
  inputHelp: {
    color: colors.mutedDim,
    fontSize: 10,
    marginTop: 4,
    lineHeight: 14,
  },
  bannerPreviewContainer: {
    marginBottom: spacing.lg,
  },
  bannerPreviewImage: {
    width: '100%',
    height: 90,
    borderRadius: radius.md,
    marginTop: 4,
  },
  primaryActionBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  primaryActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  radioGroup: {
    gap: spacing.md,
  },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: radius.lg,
    borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  radioItemActive: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(225, 29, 72, 0.03)',
  },
  radioLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleActive: {
    borderColor: colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  radioTextContainer: {
    flex: 1,
  },
  radioLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  radioDesc: {
    color: colors.muted,
    fontSize: 11,
    marginTop: 2,
  },
  planCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  planTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: 4,
  },
  planDescription: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  devCard: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    paddingBottom: 6,
  },
  cardTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: typography.weightBold,
    textTransform: 'uppercase',
  },
  techRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  techLabel: {
    color: colors.mutedDim,
    fontSize: 11,
  },
  techVal: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  techOk: {
    color: colors.free,
  },
  techErr: {
    color: colors.amber,
  },
  authNotice: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.01)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  authNoticeTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weightBold,
    marginBottom: spacing.xs,
  },
  authNoticeBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  authBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  authBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
});
