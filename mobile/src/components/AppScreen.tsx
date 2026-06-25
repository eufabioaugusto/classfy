import { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/tokens';

type AppScreenProps = PropsWithChildren<{
  backgroundColor?: string;
  scroll?: boolean;
  edgeToEdge?: boolean;
}>;

export function AppScreen({
  backgroundColor = colors.background,
  children,
  scroll = true,
  edgeToEdge = false,
}: AppScreenProps) {
  const contentStyle = edgeToEdge ? styles.edgeContent : styles.content;
  const safeStyle: ViewStyle = { ...styles.safe, backgroundColor };

  if (!scroll) {
    return (
      <SafeAreaView style={safeStyle}>
        <View style={contentStyle}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={safeStyle}>
      <ScrollView contentContainerStyle={contentStyle} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  edgeContent: {
    flexGrow: 1,
    paddingTop: 0,
  },
});
