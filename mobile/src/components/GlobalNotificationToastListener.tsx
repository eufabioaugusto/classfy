import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Pressable, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

export function GlobalNotificationToastListener() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeToast, setActiveToast] = useState<{ title: string; message: string } | null>(null);
  
  const slideAnim = useRef(new Animated.Value(-140)).current;

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`global-notifications-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload: any) => {
          const newNotif = payload.new;
          if (newNotif && newNotif.title) {
            triggerToast(newNotif.title, newNotif.message || '');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const triggerToast = (title: string, message: string) => {
    setActiveToast({ title, message });
    
    // Animate down
    Animated.spring(slideAnim, {
      toValue: insets.top + 8,
      useNativeDriver: true,
      tension: 40,
      friction: 8,
    }).start();

    // Auto dismiss after 4.5 seconds
    setTimeout(() => {
      Animated.timing(slideAnim, {
        toValue: -140,
        duration: 250,
        useNativeDriver: true,
      }).start(() => {
        setActiveToast(null);
      });
    }, 4500);
  };

  if (!activeToast) return null;

  return (
    <Animated.View 
      style={[
        styles.toastContainer, 
        { transform: [{ translateY: slideAnim }] }
      ]}
    >
      <Pressable 
        style={styles.toastContent}
        onPress={() => {
          // Slide up and route to notifications
          Animated.timing(slideAnim, {
            toValue: -140,
            duration: 150,
            useNativeDriver: true,
          }).start(() => {
            setActiveToast(null);
            router.push('/notifications');
          });
        }}
      >
        <View style={styles.iconWrap}>
          <Bell size={18} color="#000" style={{ transform: [{ scale: 0.9 }] }} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.toastTitle} numberOfLines={1}>{activeToast.title}</Text>
          <Text style={styles.toastMessage} numberOfLines={2}>{activeToast.message}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 99999,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.35,
        shadowRadius: 10,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161616',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 12,
    gap: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: '#FAFAFA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
  },
  toastTitle: {
    color: '#FAFAFA',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  toastMessage: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
});
