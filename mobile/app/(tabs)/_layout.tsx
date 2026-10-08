import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { ClassyAvatar } from '@/components/ClassyAvatar';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
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
          tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Início',
            tabBarAccessibilityLabel: 'Início',
            tabBarIcon: icon('home-outline', 'home'),
          }}
        />
        <Tabs.Screen
          name="study"
          options={{
            title: 'Estudar',
            tabBarAccessibilityLabel: 'Estudar',
            tabBarIcon: icon('sparkles-outline', 'sparkles'),
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
                  canPublish && styles.creatorIcon,
                  action && styles.activeIcon,
                ]}
              >
                {roleLoading ? (
                  <ActivityIndicator color={colors.muted} />
                ) : canPublish ? (
                  <Ionicons name="add" size={29} color="#fff" />
                ) : (
                  <ClassyAvatar size={34} />
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
            tabBarIcon: icon('chatbubble-outline', 'chatbubble'),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Você',
            tabBarAccessibilityLabel: 'Você',
            tabBarIcon: icon('person-circle-outline', 'person-circle'),
          }}
        />
        <Tabs.Screen name="rewards" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>
    </TabScrollProvider>
  );
}

const styles = StyleSheet.create({
  primaryIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: -6,
  },
  creatorIcon: { backgroundColor: colors.accent, borderColor: colors.accent },
  activeIcon: { borderColor: colors.accent },
});
