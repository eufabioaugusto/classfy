import { Modal, Pressable, StyleSheet, type ModalProps } from 'react-native';
import { X } from 'lucide-react-native';
import { colors } from '@/theme/colors';
import { controls } from '@/theme/controls';
export function SheetModal(props: ModalProps) {
  return <Modal {...props} transparent animationType="slide" presentationStyle="overFullScreen"
    supportedOrientations={['portrait', 'landscape']} />;
}
export function SheetCloseButton({ onPress, label = 'Fechar painel' }: { onPress: () => void; label?: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
    style={({ pressed }) => [sheetStyles.close, pressed && { backgroundColor: colors.surfaceAlt }]}>
    <X size={24} strokeWidth={1.65} color={colors.text} />
  </Pressable>;
}
export const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  surface: { backgroundColor: colors.backgroundElevated, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderColor: colors.border, borderTopWidth: 1, flexShrink: 1 },
  handle: { width: 48, height: 4, borderRadius: 2, backgroundColor: colors.mutedDim,
    alignSelf: 'center', marginTop: 12, marginBottom: 12 },
  header: { minHeight: controls.headerHeight, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 },
  close: { width: controls.actionSize, height: controls.actionSize, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center' },
});
