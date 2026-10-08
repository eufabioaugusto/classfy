import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { controls } from '@/theme/controls';
import { colors } from '@/theme/colors';
// AppScreen owns safe-area spacing. This row never adds another top inset.
export function NavigationHeader({
  title,
  children,
  right,
  onBack,
  back = false,
}: {
  title?: string;
  children?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  back?: boolean;
}) {
  const router = useRouter();
  const goBack = onBack || (() => router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <View style={styles.header}>
      {(back || onBack) && (
        <NavigationBackButton onPress={goBack} />
      )}
      <View style={styles.content}>
        {children || <Text style={styles.title}>{title}</Text>}
      </View>
      {right}
    </View>
  );
}
export function NavigationBackButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  return <Pressable accessibilityRole="button" accessibilityLabel="Voltar"
    onPress={onPress || (() => router.canGoBack() ? router.back() : router.replace('/'))}
    style={({ pressed }) => [styles.action, pressed && { backgroundColor: colors.surface }]}>
    <ArrowLeft size={24} strokeWidth={1.65} color={colors.text} />
  </Pressable>;
}
const styles = StyleSheet.create({
  header: {
    height: controls.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 8,
  },
  action: {
    width: controls.actionSize,
    height: controls.actionSize,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '600' },
});
