import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { ClassyAvatar } from '@/components/ClassyAvatar';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { Tabs } from 'expo-router';
import {
  House,
  TrendingUp,
  Search,
  UserRound,
  Plus,
  type LucideIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabScrollProvider } from '@/contexts/TabScrollContext';
import { colors } from '@/theme/colors';

function icon(Icon: LucideIcon) {
  return ({ color }: { color: string }) => (
    <Icon size={24} strokeWidth={1.65} color={color} />
  );
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
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
          name="rewards"
          options={{
            title: 'Progresso',
            tabBarAccessibilityLabel: 'Progresso e recompensas',
            tabBarIcon: icon(TrendingUp),
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
            tabBarLabel: roleLoading
              ? '…'
              : canPublish
                ? 'Criar'
                : () => <View style={styles.labelSpacer} accessible={false} />,
            tabBarInactiveTintColor: action ? colors.text : colors.mutedDim,
            tabBarAccessibilityLabel: roleLoading
              ? 'Carregando ação principal'
              : canPublish
                ? 'Criar publicação'
                : 'Abrir Classy para estudar',
            tabBarIcon: ({ color }) => (
              <View style={styles.primaryIcon}>
                {roleLoading ? (
                  <ActivityIndicator color={colors.muted} />
                ) : canPublish ? (
                  <Plus
                    size={25}
                    strokeWidth={1.65}
                    color={action ? colors.text : color}
                  />
                ) : (
                  <ClassyAvatar size={32} />
                )}
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="explore"
          options={{
            title: 'Pesquisar',
            tabBarAccessibilityLabel: 'Pesquisar conteúdos',
            tabBarIcon: icon(Search),
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
        <Tabs.Screen name="messages" options={{ href: null }} />
      </Tabs>
    </TabScrollProvider>
  );
}

const styles = StyleSheet.create({
  labelSpacer: { height: 12, marginTop: 2 },
  primaryIcon: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
  },
});
