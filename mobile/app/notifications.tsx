import { LoadingPlaceholder } from '@/components/LoadingPlaceholder';
import { NavigationHeader } from '@/components/NavigationHeader';
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
import { Award, Bell, CheckCheck, Settings, Video } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppScreen } from '@/components/AppScreen';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { DataIcon } from '@/components/data/DataUI';
import { dataTheme as t } from '@/theme/data';
import { spacing } from '@/theme/spacing';

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
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotifications();
          },
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } else {
      setNotifications([]);
      setLoading(false);
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
        prev.map((n) =>
          n.id === notificationId ? { ...n, is_read: true } : n,
        ),
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
      Alert.alert(
        'Sucesso',
        'Todas as notificações foram marcadas como lidas.',
      );
    } catch (e) {
      console.error('Error marking all notifications read:', e);
    } finally {
      setMarkingAll(false);
    }
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'reward': return Award;
      case 'creator': return Video;
      case 'admin': return Settings;
      default: return Bell;
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
        accessibilityRole="button"
        accessibilityLabel={`${item.is_read ? 'Lida' : 'Não lida'}: ${item.title}. ${item.message}`}
        onPress={() => !item.is_read && markAsRead(item.id)}
        style={[
          styles.itemContainer,
          !item.is_read ? styles.itemUnread : styles.itemRead,
        ]}
      >
        <DataIcon icon={getNotificationIcon(item.type)} />

        <View style={styles.contentWrap}>
          <View style={styles.headerRow}>
            <Text
              style={[
                styles.itemTitle,
                !item.is_read && styles.itemTitleUnread,
              ]}
            >
              {item.title}
            </Text>
            {!item.is_read && <View style={styles.unreadDot} />}
          </View>

          <Text style={styles.itemMessage} numberOfLines={3}>
            {item.message}
          </Text>

          <Text style={styles.itemTime}>{formatTimeAgo(item.created_at)}</Text>
        </View>
      </Pressable>
    );
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <AppScreen edgeToEdge={true} scroll={false}>
      <NavigationHeader
        title="Notificações"
        back
        right={
          unreadCount > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Marcar todas como lidas"
              accessibilityState={{ disabled: markingAll, busy: markingAll }}
              onPress={markAllAsRead}
              disabled={markingAll}
              style={styles.markAllBtn}
            >
              {markingAll ? (
                <ActivityIndicator size="small" color={t.secondary} />
              ) : (
                <>
                  <CheckCheck
                    size={18}
                    strokeWidth={t.stroke}
                    color={t.secondary}
                  />
                  <Text style={styles.markAllText}>Ler tudo</Text>
                </>
              )}
            </Pressable>
          )
        }
      />

      {loading ? (
        <LoadingPlaceholder variant="list" />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotificationItem}
          contentContainerStyle={[
            styles.listContainer,
            { paddingBottom: insets.bottom + 20 },
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Bell
                size={32}
                strokeWidth={t.stroke} color={t.subtle}
                style={{ marginBottom: 12 }}
              />
              <Text style={styles.emptyTitle}>Nenhuma notificação</Text>
              <Text style={styles.emptyBody}>
                As novidades da sua conta aparecem aqui.
              </Text>
            </View>
          }
        />
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  markAllBtn: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, gap: spacing.xs },
  markAllText: { color: t.secondary, fontSize: 12, fontWeight: '500' },
  listContainer: { paddingTop: spacing.sm },
  itemContainer: { flexDirection: 'row', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.border, gap: spacing.md, minHeight: 88 },
  itemUnread: { backgroundColor: t.surface },
  itemRead: { backgroundColor: t.canvas },
  contentWrap: { flex: 1, minWidth: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, gap: spacing.md },
  itemTitle: { color: t.secondary, fontSize: 14, lineHeight: 20, fontWeight: '500', flex: 1 },
  itemTitleUnread: { color: t.ink, fontWeight: '600' },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.accent },
  itemMessage: { color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  itemTime: { color: t.subtle, fontSize: 12, lineHeight: 18 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 100, paddingHorizontal: spacing.xl, gap: spacing.xs },
  emptyTitle: { color: t.ink, fontSize: 17, fontWeight: '600', marginBottom: spacing.xs },
  emptyBody: { color: t.muted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
});
