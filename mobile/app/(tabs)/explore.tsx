import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppScreen } from '@/components/AppScreen';
import { EmptyState } from '@/components/EmptyState';
import { SectionHeader } from '@/components/SectionHeader';
import { colors, radius, spacing, type } from '@/theme/tokens';

const chips = ['Aulas', 'Shorts', 'Podcasts', 'Cursos', 'Creators'];

export default function ExploreScreen() {
  return (
    <AppScreen>
      <View style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <Text style={styles.subtitle}>Busca e descoberta ficam aqui, separadas do feed principal.</Text>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search-outline" color={colors.muted} size={20} />
        <TextInput
          placeholder="Buscar conteudos, creators e temas"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
      </View>

      <View style={styles.chips}>
        {chips.map((chip) => (
          <View key={chip} style={styles.chip}>
            <Text style={styles.chipText}>{chip}</Text>
          </View>
        ))}
      </View>

      <SectionHeader eyebrow="Proxima camada" title="Descoberta guiada" />
      <EmptyState
        title="Pronto para ligar na busca real"
        body="A estrutura ja separa categorias, busca e recomendacoes para evoluir sem mexer no feed."
      />
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: type.xxxl,
    fontWeight: '900',
  },
  subtitle: {
    color: colors.muted,
    fontSize: type.md,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: type.md,
    minHeight: 40,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: {
    color: colors.text,
    fontSize: type.sm,
    fontWeight: '800',
  },
});
