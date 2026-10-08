import { Stack, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { GlobalNotificationToastListener } from '@/components/GlobalNotificationToastListener';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { SidebarProvider } from '@/contexts/SidebarContext';
import { AppSidebar } from '@/components/AppSidebar';
import { GlobalClassy } from '@/components/GlobalClassy';
import { MobileMiniPlayer } from '@/components/MobileMiniPlayer';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { useAuth } from '@/features/auth/authContext';
import { RewardFeedback } from '@/components/RewardFeedback';
import { MiniPlayerProvider } from '@/features/watch/MiniPlayerProvider';
import { colors } from '@/theme/tokens';
import { initMobileMediaMonitor } from '@/lib/mediaMonitor';

// Initialize dev-only media monitor
initMobileMediaMonitor();

function AppSplashWrapper({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();
  if (!loading) return <>{children}</>;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
      }}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: 32,
          fontWeight: '800',
          letterSpacing: -1,
        }}
      >
        Classfy
      </Text>
      <ActivityIndicator
        color={colors.accent}
        accessibilityLabel="Abrindo sua sessão"
      />
    </View>
  );
}

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const router = useRouter();

  useEffect(() => {
    // Listener for when a notification is tapped/interacted with by the user
    const responseSubscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        console.log('Push notification tapped by user:', response);
        // Route user directly to the notifications screen
        router.push('/notifications');
      });

    return () => {
      responseSubscription.remove();
    };
  }, [router]);

  return (
    <AuthProvider>
      <AppSplashWrapper>
        <SidebarProvider>
          <MiniPlayerProvider>
            <View style={{ flex: 1, backgroundColor: colors.background }}>
              <StatusBar style="light" />
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: colors.background },
                }}
              >
                <Stack.Screen name="(tabs)" />
                <Stack.Screen
                  name="watch/[id]"
                  options={{
                    animation: 'fade',
                    contentStyle: { backgroundColor: 'transparent' },
                    presentation: 'transparentModal',
                  }}
                />
              </Stack>
              <MobileMiniPlayer />
              <GlobalClassy />
              <AppSidebar />
              <RewardFeedback />
              <GlobalNotificationToastListener />
            </View>
          </MiniPlayerProvider>
        </SidebarProvider>
      </AppSplashWrapper>
    </AuthProvider>
  );
}
