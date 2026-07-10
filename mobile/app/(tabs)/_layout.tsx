import React, { useEffect, useRef, useState } from 'react';
import { ColorValue, StyleSheet, View, Pressable, Text, LayoutAnimation } from 'react-native';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import {
  House,
  BookOpenCheck,
  SendHorizontal,
  BadgeDollarSign,
} from 'lucide-react-native';

import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider } from '@/contexts/SidebarContext';
import { TabScrollProvider, useTabScroll } from '@/contexts/TabScrollContext';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { colors } from '@/theme/tokens';

function tabIcon(IconComponent: any) {
  return ({ color, size, focused }: { focused: boolean; color: ColorValue; size: number }) => (
    <IconComponent
      color={String(color)}
      size={size}
      strokeWidth={focused ? 2.2 : 1.8}
      fill="none"
    />
  );
}

function CustomTabBar({ state, descriptors, navigation }: any) {
  const { user } = useAuth();
  const [containerWidth, setContainerWidth] = useState(0);
  const [totalUnread, setTotalUnread] = useState(0);

  // Spacing constants
  const PADDING = 6;
  const BAR_HEIGHT = 66;
  const OUTER_RADIUS = 33;
  const INNER_RADIUS = OUTER_RADIUS - PADDING; // 27

  const allowedRoutes = ['index', 'study', 'messages', 'rewards'];

  // Safe tab scroll reading
  let isScrolled = false;
  try {
    const scrollContext = useTabScroll();
    isScrolled = scrollContext.isScrolled;
  } catch (e) {
    // Fallback if rendered outside TabScrollProvider
  }

  const visibleRoutes = state.routes.filter((route: any) => allowedRoutes.includes(route.name));
  const activeRouteName = state.routes[state.index]?.name;
  const activeIndex = visibleRoutes.findIndex((r: any) => r.name === activeRouteName);

  const usableWidth = containerWidth ? containerWidth - 2 * PADDING : 0;
  const itemWidth = usableWidth / 4;

  const prevActiveIndexRef = useRef(activeIndex);
  useEffect(() => {
    if (prevActiveIndexRef.current !== activeIndex) {
      try {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      } catch (e) {
        // Safely catch LayoutAnimation failures
      }
      prevActiveIndexRef.current = activeIndex;
    }
  }, [activeIndex]);

  // Real-time unread messages calculator
  useEffect(() => {
    if (!user) {
      setTotalUnread(0);
      return;
    }

    fetchTotalUnread();

    const channel = supabase
      .channel(`tab-bar-messages-inbox-channel-${user.id}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
        fetchTotalUnread();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, () => {
        fetchTotalUnread();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchTotalUnread = async () => {
    if (!user) return;
    try {
      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id);

      if (!participants || participants.length === 0) {
        setTotalUnread(0);
        return;
      }

      const conversationIds = participants.map((p) => p.conversation_id);

      const { data: messages } = await supabase
        .from('messages')
        .select('conversation_id, created_at')
        .in('conversation_id', conversationIds)
        .neq('sender_id', user.id);

      if (!messages) {
        setTotalUnread(0);
        return;
      }

      let count = 0;
      participants.forEach((p) => {
        const convMsgs = messages.filter((m) => m.conversation_id === p.conversation_id);
        const lastRead = new Date(p.last_read_at || 0);
        const unread = convMsgs.filter((m) => new Date(m.created_at) > lastRead);
        count += unread.length;
      });

      setTotalUnread(count);
    } catch (e) {
      console.error('Error fetching tab bar total unread:', e);
    }
  };

  const onLayout = (event: any) => {
    setContainerWidth(event.nativeEvent.layout.width);
  };

  if (activeRouteName === 'study') {
    return null;
  }

  return (
    <View
      onLayout={onLayout}
      style={{
        position: 'absolute',
        bottom: isScrolled ? 22 : 16,
        left: isScrolled ? 22 : 10,
        right: isScrolled ? 22 : 10,
        height: BAR_HEIGHT,
        borderRadius: OUTER_RADIUS,
        borderWidth: 1,
        borderColor: isScrolled ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.12)',
        flexDirection: 'row',
        padding: PADDING,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 0,
      }}
    >
      <BlurView
        intensity={isScrolled ? 70 : 90}
        tint="dark"
        style={{
          ...StyleSheet.absoluteFillObject,
          borderRadius: OUTER_RADIUS,
          overflow: 'hidden',
          backgroundColor: isScrolled ? 'rgba(15, 15, 15, 0.55)' : 'rgba(30, 30, 30, 0.75)',
        }}
      />

      {containerWidth > 0 && activeIndex !== -1 && (
        <View
          style={{
            position: 'absolute',
            top: PADDING,
            bottom: PADDING,
            left: PADDING + activeIndex * itemWidth,
            width: itemWidth,
            borderRadius: INNER_RADIUS,
            backgroundColor: 'rgba(255, 255, 255, 0.14)',
          }}
        />
      )}

      {visibleRoutes.map((route: any, index: number) => {
        const { options } = descriptors[route.key];
        const isFocused = state.routes[state.index]?.name === route.name;

        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: 'tabLongPress',
            target: route.key,
          });
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onLongPress={onLongPress}
            style={{
              flex: 1,
              borderRadius: INNER_RADIUS,
              justifyContent: 'center',
              alignItems: 'center',
              height: '100%',
              backgroundColor: 'transparent',
            }}
          >
            <View style={{ position: 'relative' }}>
              {options.tabBarIcon ? (
                options.tabBarIcon({
                  focused: isFocused,
                  color: isFocused ? '#FFF' : colors.muted,
                  size: 22,
                })
              ) : null}
              {route.name === 'messages' && totalUnread > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -8,
                    backgroundColor: '#ef4444', // Classic high contrast warning red
                    borderRadius: 8,
                    minWidth: 16,
                    height: 16,
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 4,
                  }}
                >
                  <Text style={{ color: '#FFF', fontSize: 9, fontWeight: '950' }}>
                    {totalUnread}
                  </Text>
                </View>
              )}
            </View>
            <Text
              style={{
                color: isFocused ? '#FFF' : colors.muted,
                fontSize: 10,
                fontWeight: isFocused ? '900' : '700',
                marginTop: 3,
              }}
            >
              {options.title || route.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TabsLayoutContent() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{
          headerShown: false,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Explorar',
            tabBarIcon: tabIcon(House),
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            href: null,
          }}
        />
        <Tabs.Screen
          name="study"
          options={{
            title: 'Estudo',
            tabBarIcon: tabIcon(BookOpenCheck),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Mensagens',
            tabBarIcon: tabIcon(SendHorizontal),
          }}
        />
        <Tabs.Screen
          name="rewards"
          options={{
            title: 'Recompensas',
            tabBarIcon: tabIcon(BadgeDollarSign),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            href: null,
          }}
        />
      </Tabs>
      <AppSidebar />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <SidebarProvider>
      <TabScrollProvider>
        <TabsLayoutContent />
      </TabScrollProvider>
    </SidebarProvider>
  );
}
