import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CourseLesson, CourseModule } from '@/features/watch/useCourseLessons';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';

type WatchCoursePlaylistProps = {
  modules: CourseModule[];
  currentLesson: CourseLesson | null;
  loading: boolean;
  error?: string | null;
  disabled?: boolean;
  onPress(): void;
};

/** This entry opens the existing course sheet without replacing playback. */
export function WatchCoursePlaylist({ modules, currentLesson, loading, error, disabled = false, onPress }: WatchCoursePlaylistProps) {
  const lessons = modules.flatMap(module => module.lessons);
  const index = currentLesson ? lessons.findIndex(lesson => lesson.id === currentLesson.id) : -1;
  const total = lessons.length;
  const position = !loading && !error && total ? index >= 0 ? `Aula ${index + 1} de ${total}` : `${total} ${total === 1 ? 'aula' : 'aulas'}` : '';
  const title = loading ? 'Ver lista de aulas' : error ? 'Não foi possível carregar as aulas.' : !total ? 'Nenhuma aula disponível.' : index >= 0 ? lessons[index].title.trim() || 'Aula sem título' : 'Escolha uma aula para começar';
  return <Pressable accessibilityRole="button" accessibilityLabel={['Aulas do curso', position, title].filter(Boolean).join('. ')}
    accessibilityHint="Abrir a lista de aulas deste curso."
    accessibilityState={{ disabled, busy: loading }} disabled={disabled} onPress={() => { if (!disabled) onPress(); }}
    style={({ pressed }) => [styles.card, disabled && styles.disabled, pressed && styles.pressed]}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icon}><Ionicons name="list-outline" size={23} color={colors.textSecondary} /></View>
    <View style={styles.copy}>
      <View style={styles.heading}><Text style={styles.label}>Aulas do curso</Text>{position ? <Text style={styles.position}>{position}</Text> : null}</View>
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
    </View>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.accessory}>
      <Ionicons name="chevron-forward" size={17} color={colors.muted} />
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  card: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.surface },
  icon: { width: 24, alignItems: 'center', flexShrink: 0 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  label: { color: colors.muted, fontSize: 12, lineHeight: 16, fontWeight: '500' },
  position: { color: colors.muted, fontSize: 11, lineHeight: 16, fontVariant: ['tabular-nums'] },
  title: { color: colors.textSecondary, fontSize: 14, lineHeight: 18, fontWeight: '500' },
  accessory: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
});
