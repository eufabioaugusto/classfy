import { useEffect, useState, type PropsWithChildren } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableWithoutFeedback, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { colors } from '@/theme/colors';

export function StudioCaptureSheet({ visible, title, onClose, showKeyboardAction = false, children }: PropsWithChildren<{
  visible: boolean; title: string; onClose: () => void; showKeyboardAction?: boolean;
}>) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const close = () => { Keyboard.dismiss(); onClose(); };
  return <SheetModal visible={visible} onRequestClose={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={sheetStyles.backdrop}>
      <Pressable accessibilityRole="button" accessibilityLabel={keyboardOpen ? 'Recolher teclado do roteiro' : 'Fechar ajustes de captura'} onPress={() => keyboardOpen ? Keyboard.dismiss() : close()} style={StyleSheet.absoluteFill} />
      <TouchableWithoutFeedback accessible={false} onPress={Keyboard.dismiss}>
        <View style={[sheetStyles.surface, {
          alignSelf: 'center',
          width: width > height ? Math.min(width - Math.max(insets.left, 18) - Math.max(insets.right, 18), height * 16 / 9) : '100%',
          maxHeight: Math.max(180, Math.min(460, height - Math.max(insets.top, 14) - 16)),
        }]}>
          <View onStartShouldSetResponder={() => true}><View style={sheetStyles.handle} />
            <View style={sheetStyles.header}><Text style={styles.title}>{title}</Text>
              <View style={styles.actions}>
                {showKeyboardAction && keyboardOpen && <Pressable accessibilityRole="button" accessibilityLabel="Concluir digitação do roteiro"
                  onPress={Keyboard.dismiss} style={styles.done}><Text style={styles.doneLabel}>Concluir</Text></Pressable>}
                <SheetCloseButton onPress={close} />
              </View>
            </View>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: Math.max(insets.bottom, 20) + 12, gap: 18 }}>
            {children}
          </ScrollView>
        </View>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  </SheetModal>;
}
const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 19, fontWeight: '600', letterSpacing: -0.4, flexShrink: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  done: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  doneLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
});
