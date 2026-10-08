import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import type { HomeContent } from '@/features/home/homeData';
import type { HeroSettings } from '@/features/home/useHomeEditorial';
import type { FeaturedCreator } from './FeaturedCreators';

export function HomeHero({
  content,
  creator,
  settings,
  onPlay,
  onStudy,
}: {
  content?: HomeContent;
  creator?: FeaturedCreator;
  settings: HeroSettings | null;
  onPlay: () => void;
  onStudy: () => void;
}) {
  if (!content && !creator) return null;
  const title =
    settings?.title?.trim() ||
    content?.title ||
    creator?.description ||
    creator?.creator_name;
  const description = settings?.description?.trim() || content?.description;
  const align =
    settings?.alignment === 'center'
      ? 'center'
      : settings?.alignment === 'right'
        ? 'right'
        : 'left';
  const alignment =
    align === 'center'
      ? 'center'
      : align === 'right'
        ? 'flex-end'
        : 'flex-start';
  return (
    <View style={styles.hero}>
      <Image
        source={
          settings?.thumbnail_url ||
          content?.thumbnailUrl ||
          creator?.background_image_url
            ? {
                uri:
                  settings?.thumbnail_url ||
                  content?.thumbnailUrl ||
                  creator?.background_image_url,
              }
            : require('../../assets/images/home-hero-fallback.jpg')
        }
        contentFit="cover"
        contentPosition={
          settings?.image_position === 'left'
            ? 'left'
            : settings?.image_position === 'right'
              ? 'right'
              : 'center'
        }
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.72)', '#09090b']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.copy, { alignItems: alignment }]}>
        <View style={styles.eyebrow}>
          <Text style={styles.small}>
            {settings?.eyebrow_label || 'Em destaque'}
          </Text>
          {settings?.show_chip !== false && (
            <Text style={styles.chip}>
              {settings?.chip_label ||
                (creator
                  ? 'Seleção Classfy'
                  : content?.access === 'free'
                    ? 'Acesso Free'
                    : `Seleção ${content?.access?.toUpperCase()}`)}
            </Text>
          )}
        </View>
        {creator?.featured_image_url ? (
          <Image
            source={{ uri: creator.featured_image_url }}
            contentFit="contain"
            style={{ width: 180, height: 62 }}
          />
        ) : null}
        <Text style={[styles.title, { textAlign: align }]}>{title}</Text>
        {description ? (
          <Text
            numberOfLines={3}
            style={[styles.description, { textAlign: align }]}
          >
            {description}
          </Text>
        ) : null}
        {content ? (
          <Text style={styles.small}>
            {content.creator}
            {content.durationSeconds
              ? ` · ${Math.max(1, Math.round(content.durationSeconds / 60))} min`
              : ''}{' '}
            · {content.contentType}
          </Text>
        ) : null}
        <View style={[styles.actions, { justifyContent: alignment }]}>
          <Pressable
            accessibilityRole="button"
            style={styles.primary}
            onPress={onPlay}
          >
            <Ionicons
              name={creator ? 'arrow-forward' : 'play'}
              size={16}
              color="#fff"
            />
            <Text style={styles.button}>
              {settings?.primary_label ||
                (creator ? 'Conhecer creator' : 'Assistir agora')}
            </Text>
          </Pressable>
          {settings?.show_secondary !== false && (
            <Pressable
              accessibilityRole="button"
              style={styles.secondary}
              onPress={onStudy}
            >
              <Text style={styles.button}>
                {settings?.secondary_label || 'Estudar com a Classy'}
              </Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  hero: {
    minHeight: 480,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    marginBottom: 32,
    backgroundColor: colors.surface,
  },
  copy: { padding: 24, gap: 16 },
  eyebrow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  small: { color: '#ffffffb8', fontSize: 11 },
  chip: {
    color: '#fff',
    fontSize: 10,
    borderWidth: 1,
    borderColor: '#ffffff30',
    borderRadius: 4,
    padding: 5,
    backgroundColor: '#00000055',
  },
  title: {
    color: '#fff',
    fontSize: 38,
    lineHeight: 40,
    letterSpacing: -2,
    fontWeight: '600',
  },
  description: { color: '#ffffffb8', fontSize: 14, lineHeight: 22 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  primary: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  secondary: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: 9,
    backgroundColor: '#09090b88',
    borderWidth: 1,
    borderColor: '#ffffff40',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  button: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
