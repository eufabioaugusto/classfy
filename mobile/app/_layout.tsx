import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import { MobileMiniPlayer } from '@/components/MobileMiniPlayer';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { MiniPlayerProvider } from '@/features/watch/MiniPlayerProvider';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  return (
    <AuthProvider>
      <MiniPlayerProvider>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
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
        </View>
      </MiniPlayerProvider>
    </AuthProvider>
  );
}
