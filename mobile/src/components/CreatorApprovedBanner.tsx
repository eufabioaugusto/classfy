import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
export function CreatorApprovedBanner() {
  const { user } = useAuth();
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let active = true;
    setVisible(false);
    if (user)
      void (async () => {
        if (await AsyncStorage.getItem(`creator_banner_dismissed_${user.id}`))
          return;
        const [notification, profile] = await Promise.all([
          supabase
            .from('notifications')
            .select('id')
            .eq('user_id', user.id)
            .eq('type', 'creator_approved')
            .limit(1),
          supabase
            .from('profiles')
            .select('creator_status')
            .eq('id', user.id)
            .maybeSingle(),
        ]);
        if (active)
          setVisible(
            !notification.error &&
              !!notification.data?.length &&
              profile.data?.creator_status === 'approved',
          );
      })();
    return () => {
      active = false;
    };
  }, [user?.id]);
  if (!visible) return null;
  const dismiss = () => {
    setVisible(false);
    if (user)
      void AsyncStorage.setItem(`creator_banner_dismissed_${user.id}`, 'true');
  };
  return (
    <View
      style={{
        padding: 18,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 12,
        gap: 12,
      }}
    >
      <Text style={{ color: colors.text, fontSize: 16 }}>
        Você agora é um creator Classfy!
      </Text>
      <Pressable
        onPress={() => {
          dismiss();
          router.push('/studio');
        }}
      >
        <Text style={{ color: colors.accent }}>Acessar meu Studio →</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Dispensar aviso de creator"
        onPress={dismiss}
      >
        <Text style={{ color: colors.muted }}>Fechar</Text>
      </Pressable>
    </View>
  );
}
