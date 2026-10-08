import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabScrollProvider } from '@/contexts/TabScrollContext';
import { colors } from '@/theme/colors';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
function icon(outline: IconName, filled: IconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} size={23} color={color} />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const unread = useUnreadMessages();
  return (
    <TabScrollProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.mutedDim,
          tabBarHideOnKeyboard: true,
          tabBarStyle: {
            backgroundColor: colors.backgroundElevated,
            borderTopColor: colors.borderSubtle,
            height: 58 + insets.bottom,
            paddingBottom: Math.max(insets.bottom, 6),
            paddingTop: 6,
          },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Início',
            tabBarIcon: icon('home-outline', 'home'),
          }}
        />
        <Tabs.Screen
          name="study"
          options={{
            title: 'Estudar',
            tabBarIcon: icon('sparkles-outline', 'sparkles'),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Mensagens',
            tabBarBadge:
              unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
            tabBarIcon: icon('chatbubble-outline', 'chatbubble'),
          }}
        />
        <Tabs.Screen
          name="rewards"
          options={{
            title: 'Conquistas',
            tabBarIcon: icon('trophy-outline', 'trophy'),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Você',
            tabBarIcon: icon('person-circle-outline', 'person-circle'),
          }}
        />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>
    </TabScrollProvider>
  );
}
