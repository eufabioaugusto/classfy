import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/features/auth/authContext';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { publicationKinds } from '@/features/navigation/primaryAction';
import { colors } from '@/theme/colors';

export function PublicationMenu() {
  const { action, canPublish, closePublish } = usePrimaryAction();
  const { user } = useAuth();
  const pending = useRef<{ path: string; owner: string } | null>(null);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [opening, setOpening] = useState(false);
  const launch = async () => {
    const request = pending.current;
    pending.current = null;
    if (!request) return;
    if (!canPublish || request.owner !== user?.id) {
      setOpening(false);
      return;
    }
    try {
      await WebBrowser.openBrowserAsync(
        `https://classfy.com.br${request.path}`,
        {
          presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        },
      );
    } catch {
      Alert.alert(
        'Publicação',
        'Não foi possível abrir o Studio. Tente novamente.',
      );
    } finally {
      setOpening(false);
    }
  };
  const open = (path: string) => {
    if (!canPublish || opening || !user) return;
    pending.current = { path, owner: user.id };
    setOpening(true);
    closePublish();
  };
  // iOS must dismiss the native sheet before presenting Safari's Studio window.
  useEffect(() => {
    if (action !== 'publish' && Platform.OS !== 'ios') void launch();
  }, [action]);
  return (
    <Modal
      visible={action === 'publish' && canPublish}
      transparent
      animationType="slide"
      onRequestClose={closePublish}
      onDismiss={() => {
        void launch();
      }}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fechar opções de publicação"
          style={{ flex: 1 }}
          onPress={closePublish}
        />
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: Math.max(240, height - insets.top - 24),
            },
          ]}
        >
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.title}>O que você quer criar?</Text>
              <Text style={styles.description}>
                Escolha o formato da sua publicação.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fechar publicação"
              style={styles.close}
              onPress={closePublish}
            >
              <Ionicons name="close" color={colors.text} size={23} />
            </Pressable>
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20 }}
          >
            {publicationKinds.map((kind) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Criar ${kind.title}`}
                disabled={opening}
                key={kind.key}
                onPress={() => open(kind.path)}
                style={({ pressed }) => [
                  styles.option,
                  pressed && { backgroundColor: colors.surface },
                ]}
              >
                <View style={styles.icon}>
                  <Ionicons name={kind.icon} size={25} color={colors.text} />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.optionTitle}>{kind.title}</Text>
                  <Text style={styles.description}>{kind.description}</Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  color={colors.muted}
                  size={18}
                />
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.hint}>
            Continue no Studio da Classfy. Ele abre em uma janela para você
            concluir a publicação.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
    padding: 24,
    paddingBottom: 18,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.8,
  },
  description: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 78,
    borderRadius: 12,
    paddingHorizontal: 8,
  },
  icon: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
  },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hint: {
    color: colors.mutedDim,
    fontSize: 11,
    lineHeight: 17,
    paddingHorizontal: 28,
    paddingTop: 16,
  },
});
