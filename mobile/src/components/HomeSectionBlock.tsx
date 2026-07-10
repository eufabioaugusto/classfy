import { StyleSheet, View } from 'react-native';

import { HomeSection } from '@/features/home/homeData';
import { spacing } from '@/theme/spacing';
import { ContentRail } from './ContentRail';
import { MobileVideoCard } from './MobileVideoCard';
import { SectionHeader } from './SectionHeader';
import { ShortsRail } from './ShortsRail';

type HomeSectionBlockProps = {
  section: HomeSection;
};

export function HomeSectionBlock({ section }: HomeSectionBlockProps) {
  if (section.layout === 'shorts') {
    return (
      <View style={styles.block}>
        <SectionHeader title={section.title} actionLabel="Ver todos" />
        <ShortsRail
          shorts={section.contents.map((content) => ({
            id: content.id,
            title: content.title,
            creator: content.creator,
            tone: content.tone,
            thumbnailUrl: content.thumbnailUrl,
            fileUrl: content.fileUrl,
            videoUrl: content.videoUrl,
          }))}
        />
      </View>
    );
  }

  if (section.layout === 'horizontal') {
    return (
      <View style={styles.block}>
        <SectionHeader title={section.title} actionLabel="Ver todos" />
        <ContentRail
          contents={section.contents}
          layout={section.key === 'podcasts' ? 'square' : 'horizontal'}
        />
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <SectionHeader title={section.title} />
      {section.contents.map((content) => (
        <MobileVideoCard key={content.id} content={content} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginBottom: spacing.sm,
  },
});
