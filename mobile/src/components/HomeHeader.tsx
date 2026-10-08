import { Ionicons } from '@expo/vector-icons';
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
      .channel(`mobile-header-${user.id}`)
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
    <View style={styles.header}>
      <View style={styles.brandRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir menu"
          onPress={openSidebar}
          style={styles.action}
        >
          <Ionicons name="menu-outline" size={25} color={colors.text} />
        </Pressable>
        <Text style={styles.brand}>Classfy</Text>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Buscar conteúdos"
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => router.push('/search')}
        >
          <Ionicons name="search-outline" size={23} color={colors.text} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Notificações${unreadCount ? `, ${unreadCount} não lidas` : ''}`}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          onPress={() => router.push('/notifications')}
        >
          <Ionicons
            name="notifications-outline"
            size={23}
            color={colors.text}
          />
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {unreadCount > 9 ? '9+' : unreadCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    height: 60,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brand: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -1.2,
  },
  actions: { flexDirection: 'row', gap: 4 },
  action: {
    width: 44,
    height: 44,
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
