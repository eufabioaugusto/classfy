import { NavigationHeader } from '@/components/NavigationHeader';
import React, { useEffect, useState } from 'react';
import {
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
import { Check, User } from 'lucide-react-native';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { DataAction, DataCard } from '@/components/data/DataUI';
import { dataStyles, dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

export default function EditProfileScreen() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(profile?.display_name || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name || '');
      setBio(profile.bio || '');
      setAvatarUrl(profile.avatar_url || '');
    }
  }, [profile]);

  const handleSave = async () => {
    if (!displayName.trim() || !user) {
      Alert.alert('Erro', 'Nome de exibição não pode estar em branco.');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          bio: bio.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        })
        .eq('id', user.id);

      if (error) throw error;

      await refreshProfile();
      Alert.alert('Sucesso', 'Perfil atualizado com sucesso!', [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } catch (e: any) {
      console.error('Error saving profile:', e);
      Alert.alert('Erro', e.message || 'Não foi possível atualizar o perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        {/* Custom Header */}
        <NavigationHeader title="Editar perfil" back />

        <ScrollView style={styles.content} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* Avatar Edit Section */}
          <View style={styles.avatarSection}>
            <View style={styles.avatarWrapper}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <User size={32} strokeWidth={t.stroke} color={t.muted} />
                </View>
              )}
            </View>
            <Text style={styles.avatarSectionTitle}>Sua identidade na Classfy</Text>
          </View>

          {/* Form Fields */}
          <DataCard style={styles.formCard}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Link da foto</Text>
              <TextInput
                style={dataStyles.input}
                accessibilityLabel="Link da foto"
                keyboardType="url"
                value={avatarUrl}
                onChangeText={setAvatarUrl}
                placeholder="URL da imagem do perfil"
                placeholderTextColor={t.subtle}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!saving}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Nome de exibição</Text>
              <TextInput
                style={dataStyles.input}
                accessibilityLabel="Nome de exibição"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Seu nome completo"
                placeholderTextColor={t.subtle}
                editable={!saving}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Sobre você</Text>
              <TextInput
                style={[dataStyles.input, styles.textArea]}
                accessibilityLabel="Sobre você"
                value={bio}
                onChangeText={setBio}
                placeholder="Fale um pouco sobre você..."
                placeholderTextColor={t.subtle}
                multiline
                numberOfLines={3}
                editable={!saving}
              />
            </View>

            <DataAction label="Salvar alterações" icon={Check} onPress={handleSave} busy={saving} disabled={!displayName.trim()} />
          </DataCard>

        </ScrollView>
      </KeyboardAvoidingView>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xl, paddingBottom: spacing.section * 2, paddingTop: spacing.lg, gap: spacing.xxl },
  avatarSection: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  avatarWrapper: { width: 88, height: 88, borderRadius: 44, borderWidth: 1, borderColor: t.border, padding: 3 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 44 },
  avatarPlaceholder: { width: '100%', height: '100%', borderRadius: 44, backgroundColor: t.raised, alignItems: 'center', justifyContent: 'center' },
  avatarSectionTitle: { color: t.muted, fontSize: 13, lineHeight: 19 },
  formCard: { gap: spacing.xl },
  formGroup: { gap: spacing.sm },
  label: { color: t.secondary, fontSize: 14, fontWeight: '500' },
  textArea: { minHeight: 112, textAlignVertical: 'top' },
});
