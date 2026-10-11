import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@/theme/tokens';
import type { BillingMessage } from './storeBilling';

export function BillingMessageDialog({ message, onClose }: { message: BillingMessage | null; onClose: () => void }) {
  return (
    <Modal transparent animationType="fade" visible={Boolean(message)} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Fechar mensagem" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={[styles.icon, { backgroundColor: message?.tone === 'success' ? 'rgba(34,197,94,0.12)' : 'rgba(225,29,72,0.12)' }]}>
            <Ionicons name={message?.tone === 'success' ? 'checkmark-circle-outline' : message?.tone === 'error' ? 'alert-circle-outline' : 'information-circle-outline'} size={30} color={message?.tone === 'success' ? colors.free : colors.accent} />
          </View>
          <Text style={styles.title}>{message?.title}</Text>
          <Text style={styles.description}>{message?.description}</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={onClose}><Text style={styles.buttonText}>Entendi</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  card: { width: '100%', maxWidth: 420, padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  icon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md },
  title: { color: colors.text, textAlign: 'center', fontSize: 21, fontWeight: '700', marginBottom: spacing.sm },
  description: { color: colors.muted, textAlign: 'center', fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },
  button: { width: '100%', backgroundColor: colors.accent, minHeight: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: colors.text, fontWeight: '700', fontSize: 14 },
});
