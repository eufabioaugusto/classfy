import { NavigationHeader } from './NavigationHeader';
import { controls } from '@/theme/controls';
import { nextRealtimeTopic } from '@/lib/realtimeTopic';
import { Bell, Search } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSidebar } from '@/contexts/SidebarContext';
import { colors } from '@/theme/colors';

export function HomeHeader() {
  const router = useRouter();
  const { openSidebar } = useSidebar();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let active = true;
    setUnreadCount(0);
    if (!user) return;
    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      if (active && !error) setUnreadCount(count || 0);
    };
    void fetchCount();
    const channel = supabase
      .channel(nextRealtimeTopic(`mobile-header-${user.id}`))
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          void fetchCount();
        },
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [user?.id]);
  return (
    <NavigationHeader right={
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Buscar conteúdos"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => router.push('/search')}
        >
          <Search size={24} strokeWidth={1.65} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Notificações${unreadCount ? `, ${unreadCount} não lidas` : ''}`}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => router.push('/notifications')}
        >
          <Bell size={24} strokeWidth={1.65} color={colors.text} />
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    }>

      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir menu"
          onPress={openSidebar}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Svg width={24} height={24} viewBox="0 0 24 24">
            <Path
              d="M4 8h16M4 16h10"
              fill="none"
              stroke={colors.text}
              strokeWidth={1.65}
              strokeLinecap="round"
            />
          </Svg>
        </Pressable>
        <Text style={styles.brand}>Classfy</Text>
      </View>
    </NavigationHeader>
  );
}
const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brand: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  actions: { flexDirection: 'row', gap: 4 },
  action: {
    width: controls.actionSize,
    height: controls.actionSize,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  pressed: { backgroundColor: colors.surface },
  badge: {
    position: 'absolute',
    top: 3,
    right: 1,
    borderRadius: 8,
    backgroundColor: colors.accent,
    paddingHorizontal: 4,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.text, fontSize: 9, fontWeight: '700' },
});
