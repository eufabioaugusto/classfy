import { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabScroll } from '@/contexts/TabScrollContext';
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

  let setIsScrolled: ((val: boolean) => void) | undefined;
  try {
    const context = useTabScroll();
    setIsScrolled = context.setIsScrolled;
  } catch (e) {
    // Safely ignore if rendered outside TabScrollProvider
  }

  const handleScroll = (event: any) => {
    if (setIsScrolled) {
      const offsetY = event.nativeEvent.contentOffset.y;
      setIsScrolled(offsetY > 5);
    }
  };

  if (!scroll) {
    const nonScrollStyle = edgeToEdge ? styles.edgeContent : styles.nonScrollContent;
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={safeStyle}>
        <View style={nonScrollStyle}>{children}</View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={safeStyle}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={contentStyle}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >
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
    paddingBottom: 110,
  },
  nonScrollContent: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  edgeContent: {
    flexGrow: 1,
    paddingTop: 0,
  },
});
