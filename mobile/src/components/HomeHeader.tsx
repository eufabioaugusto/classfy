import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Compass, Target } from 'lucide-react-native';

import { useSidebar } from '@/contexts/SidebarContext';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface HomeHeaderProps {
  mode?: 'explorar' | 'foco';
  onModeChange?: (mode: 'explorar' | 'foco') => void;
}

export function HomeHeader({ mode, onModeChange }: HomeHeaderProps) {
  const { toggleSidebar } = useSidebar();
  const router = useRouter();
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    fetchUnreadCount();

    const channel = supabase
      .channel(`header-notifications-${user.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => {
          fetchUnreadCount();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchUnreadCount = async () => {
    if (!user) return;
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (!error && count !== null) {
        setUnreadCount(count);
      }
    } catch (e) {
      console.log('Error fetching notification count:', e);
    }
  };

  const showToggle = mode && onModeChange;

  return (
    <View style={styles.container}>
      <View style={styles.brandContainer}>
        <Pressable onPress={toggleSidebar} style={styles.hamburgerButton}>
          <Ionicons name="menu-outline" color={colors.text} size={26} />
        </Pressable>
        <View style={styles.brandRow}>
          <Text style={styles.brand}>Classfy</Text>
          
          {/* Mini-Toggle next to brand name (only rendered if parameters are supplied) */}
          {showToggle ? (
            <View style={styles.miniToggleContainer}>
              <Pressable
                onPress={() => onModeChange('explorar')}
                style={[
                  styles.miniToggleBtn,
                  mode === 'explorar' && styles.miniToggleBtnActiveExplore
                ]}
              >
                <Compass
                  size={14}
                  color={mode === 'explorar' ? '#ffffff' : '#71717a'}
                  strokeWidth={2.2}
                />
              </Pressable>
              <Pressable
                onPress={() => onModeChange('foco')}
                style={[
                  styles.miniToggleBtn,
                  mode === 'foco' && styles.miniToggleBtnActiveFoco
                ]}
              >
                <Target
                  size={14}
                  color={mode === 'foco' ? '#ef4444' : '#71717a'}
                  strokeWidth={2.2}
                />
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable onPress={() => router.push('/explore')} style={styles.iconButton}>
          <Ionicons name="search-outline" color={colors.text} size={20} />
        </Pressable>
        <Pressable onPress={() => router.push('/notifications')} style={styles.iconButton}>
          <Ionicons name="notifications-outline" color={colors.text} size={20} />
          {unreadCount > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
    paddingTop: spacing.sm,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  hamburgerButton: {
    padding: spacing.xs,
    marginLeft: -spacing.xs,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  brand: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBold, // 700 bold weight matching web
    letterSpacing: -0.5,
  },
  miniToggleContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    padding: 2,
  },
  miniToggleBtn: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  miniToggleBtnActiveExplore: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  miniToggleBtnActiveFoco: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSubtle,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#ef4444',
    borderRadius: radius.full,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: 'bold',
  },
});
