import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bell, CheckSquare } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  related_content_id: string | null;
}

export default function NotificationsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [markingAll, setMarkingAll] = useState(false);

  useEffect(() => {
    if (user) {
      fetchNotifications();

      const channel = supabase
        .channel(`notifications-center-${user.id}-${Date.now()}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
          () => {
            fetchNotifications();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  const fetchNotifications = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setNotifications(data || []);
    } catch (e) {
      console.error('Error fetching notifications list:', e);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notificationId);

      if (error) throw error;

      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, is_read: true } : n))
      );
    } catch (e) {
      console.error('Error marking notification read:', e);
    }
  };

  const markAllAsRead = async () => {
    if (!user || markingAll) return;
    try {
      setMarkingAll(true);
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      if (error) throw error;
      
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      Alert.alert('Sucesso', 'Todas as notificações foram marcadas como lidas.');
    } catch (e) {
      console.error('Error marking all notifications read:', e);
    } finally {
      setMarkingAll(false);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'reward':
        return '🎁';
      case 'creator':
        return '🎬';
      case 'admin':
        return '⚙️';
      default:
        return '📢';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Agora mesmo';
    if (diffMins < 60) return `${diffMins} min atrás`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h atrás`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d atrás`;
  };

  const renderNotificationItem = ({ item }: { item: Notification }) => {
    return (
      <Pressable
        onPress={() => !item.is_read && markAsRead(item.id)}
        style={[
          styles.itemContainer,
          !item.is_read ? styles.itemUnread : styles.itemRead
        ]}
      >
        <View style={styles.iconWrap}>
          <Text style={styles.iconText}>{getNotificationIcon(item.type)}</Text>
        </View>
        
        <View style={styles.contentWrap}>
          <View style={styles.headerRow}>
            <Text style={[styles.itemTitle, !item.is_read && styles.itemTitleUnread]}>
              {item.title}
            </Text>
            {!item.is_read && <View style={styles.unreadDot} />}
          </View>
          
          <Text style={styles.itemMessage} numberOfLines={3}>
            {item.message}
          </Text>
          
          <Text style={styles.itemTime}>
            {formatTimeAgo(item.created_at)}
          </Text>
        </View>
      </Pressable>
    );
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      {/* Header Bar */}
      <View style={[styles.headerContainer, { paddingTop: insets.top + spacing.xs }]}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Notificações</Text>
        </View>

        {unreadCount > 0 && (
          <Pressable 
            onPress={markAllAsRead} 
            disabled={markingAll}
            style={styles.markAllBtn}
          >
            {markingAll ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <>
                <CheckSquare size={14} color={colors.accent} style={{ marginRight: 4 }} />
                <Text style={styles.markAllText}>Ler tudo</Text>
              </>
            )}
          </Pressable>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingCenter}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotificationItem}
          contentContainerStyle={[styles.listContainer, { paddingBottom: insets.bottom + 20 }]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Bell size={48} color={colors.mutedDim} style={{ marginBottom: 12, opacity: 0.5 }} />
              <Text style={styles.emptyTitle}>Tudo limpo por aqui!</Text>
              <Text style={styles.emptyBody}>Você não tem nenhuma notificação pendente.</Text>
            </View>
          }
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
    backgroundColor: '#000000',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    padding: 4,
    marginLeft: -4,
  },
  headerTitle: {
    color: '#FAFAFA',
    fontSize: 18,
    fontWeight: 'bold',
  },
  markAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(226, 29, 72, 0.1)',
  },
  markAllText: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: 'bold',
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContainer: {
    paddingTop: spacing.xs,
  },
  itemContainer: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.03)',
    gap: 12,
  },
  itemUnread: {
    backgroundColor: 'rgba(255, 255, 255, 0.015)',
  },
  itemRead: {
    opacity: 0.75,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  iconText: {
    fontSize: 18,
  },
  contentWrap: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 12,
  },
  itemTitle: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: 'bold',
    flex: 1,
  },
  itemTitleUnread: {
    color: '#FAFAFA',
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  itemMessage: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 6,
  },
  itemTime: {
    color: colors.mutedDim,
    fontSize: 10,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 100,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    color: '#FAFAFA',
    fontSize: 15,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  emptyBody: {
    color: colors.muted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
