import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { ColorValue } from 'react-native';

import { colors } from '@/theme/tokens';

type TabIconName = keyof typeof Ionicons.glyphMap;

function tabIcon(name: TabIconName) {
  return ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={String(color)} size={size} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 76,
          paddingBottom: 14,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('home-outline'),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explore',
          tabBarIcon: tabIcon('search-outline'),
        }}
      />
      <Tabs.Screen
        name="rewards"
        options={{
          title: 'Rewards',
          tabBarIcon: tabIcon('sparkles-outline'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: tabIcon('person-circle-outline'),
        }}
      />
    </Tabs>
  );
}
