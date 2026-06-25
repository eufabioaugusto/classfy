import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { SectionHeader } from '@/components/SectionHeader';
import { colors, radius, spacing, type } from '@/theme/tokens';

export default function WatchScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <AppScreen>
      <View style={styles.player}>
        <Ionicons name="play" color={colors.background} size={44} />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>Watch Classfy</Text>
        <Text style={styles.meta}>Conteudo: {id ?? 'sem-id'}</Text>
        <Text style={styles.body}>
          Esta tela e a base do player nativo. O proximo passo e buscar `contents` pelo id,
          renderizar video, progresso, comentarios, notas e recompensas.
        </Text>
      </View>

      <SectionHeader eyebrow="Camadas previstas" title="Watch como centro do app" />
      <View style={styles.grid}>
        {['Player', 'Creator', 'Rewards', 'Classy'].map((item) => (
          <View key={item} style={styles.tile}>
            <Text style={styles.tileText}>{item}</Text>
          </View>
        ))}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  player: {
    alignItems: 'center',
    aspectRatio: 16 / 9,
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  copy: {
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  title: {
    color: colors.text,
    fontSize: type.xxl,
    fontWeight: '900',
  },
  meta: {
    color: colors.accent,
    fontSize: type.sm,
    fontWeight: '800',
  },
  body: {
    color: colors.muted,
    fontSize: type.md,
    lineHeight: 22,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minWidth: '47%',
    padding: spacing.md,
  },
  tileText: {
    color: colors.text,
    fontSize: type.md,
    fontWeight: '900',
  },
});
