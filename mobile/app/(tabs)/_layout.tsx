import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { ClassyAvatar } from '@/components/ClassyAvatar';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { Tabs } from 'expo-router';
import {
  House,
  MessageCircle,
  UserRound,
  Plus,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabScrollProvider } from '@/contexts/TabScrollContext';
import { colors } from '@/theme/colors';
import { useUnreadMessages } from '@/hooks/useUnreadMessages';

function icon(Icon: LucideIcon) {
  return ({ color }: { color: string }) => (
    <Icon size={24} strokeWidth={1.65} color={color} />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const unread = useUnreadMessages();
  const { canPublish, roleLoading, openClassy, openPublish, action } =
    usePrimaryAction();
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
          tabBarIconStyle: { height: 32, width: 40 },
          tabBarLabelStyle: { fontSize: 10, fontWeight: '500', marginTop: 2 },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Início',
            tabBarAccessibilityLabel: 'Início',
            tabBarIcon: icon(House),
          }}
        />
        <Tabs.Screen
          name="primary"
          listeners={{
            tabPress: (event) => {
              event.preventDefault();
              if (roleLoading) return;
              canPublish ? openPublish() : openClassy();
            },
          }}
          options={{
            title: roleLoading ? '…' : canPublish ? 'Criar' : 'Classy',
            tabBarAccessibilityLabel: roleLoading
              ? 'Carregando ação principal'
              : canPublish
                ? 'Criar publicação'
                : 'Abrir Classy para estudar',
            tabBarIcon: () => (
              <View
                style={[
                  styles.primaryIcon,
                  action && styles.activeIcon,
                ]}
              >
                {roleLoading ? (
                  <ActivityIndicator color={colors.muted} />
                ) : canPublish ? (
                  <Plus size={25} strokeWidth={1.65} color={colors.text} />
                ) : (
                  <ClassyAvatar size={30} />
                )}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="messages"
          options={{
            title: 'Mensagens',
            tabBarAccessibilityLabel:
              unread > 0 ? `Mensagens, ${unread} não lidas` : 'Mensagens',
            tabBarBadge:
              unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
            tabBarIcon: icon(MessageCircle),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Você',
            tabBarAccessibilityLabel: 'Você',
            tabBarIcon: icon(UserRound),
          }}
        />
        <Tabs.Screen name="study" options={{ href: null }} />
        <Tabs.Screen name="rewards" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>
    </TabScrollProvider>
  );
}

const styles = StyleSheet.create({
  primaryIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
  activeIcon: { backgroundColor: colors.surface },
});
