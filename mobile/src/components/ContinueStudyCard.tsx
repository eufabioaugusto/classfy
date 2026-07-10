import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { fetchStudyJourneySummary, StudyJourneySummary } from '@/lib/study/getStudyJourneySummary';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';
import { typography } from '@/theme/typography';

interface ContinueStudyCardProps {
  userId: string;
}

export function ContinueStudyCard({ userId }: ContinueStudyCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [studies, setStudies] = useState<StudyJourneySummary[]>([]);

  useEffect(() => {
    if (!userId) return;
    fetchStudiesWithMetrics();
  }, [userId]);

  const fetchStudiesWithMetrics = async () => {
    try {
      setLoading(true);
      // Fetch active studies
      const { data: studiesData, error: studiesError } = await supabase
        .from('studies')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false });

      if (studiesError) throw studiesError;
      if (!studiesData || studiesData.length === 0) {
        setStudies([]);
        return;
      }

      // Fetch metrics for each study
      const studiesWithMetrics = await Promise.all(
        studiesData.map(async (study) => {
          try {
            const summary = await fetchStudyJourneySummary({
              studyId: study.id,
              userId,
              title: study.title || 'Novo estudo',
            });

            // Fetch background image/thumbnail from first recommended content
            let primaryThumbnailUrl: string | null = null;
            if (summary.primaryContentId) {
              const { data: content } = await supabase
                .from('contents')
                .select('thumbnail_url')
                .eq('id', summary.primaryContentId)
                .maybeSingle();
              if (content) {
                primaryThumbnailUrl = content.thumbnail_url;
              }
            }

            return {
              ...summary,
              primaryThumbnailUrl,
            } as StudyJourneySummary & { primaryThumbnailUrl: string | null };
          } catch (e) {
            console.error('Error fetching summary for study:', study.id, e);
            return null;
          }
        })
      );

      setStudies(studiesWithMetrics.filter(Boolean) as any);
    } catch (error) {
      console.error('Error fetching studies with metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleContinueStudy = (studyId: string) => {
    // Navigate to study tab workspace and load this study chat
    router.push({
      pathname: '/study',
      params: { studyId },
    } as any);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={styles.loadingText}>Carregando jornadas de estudo...</Text>
      </View>
    );
  }

  if (studies.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="book-outline" size={32} color={colors.muted} />
        <Text style={styles.emptyText}>Nenhum estudo ativo no momento.</Text>
        <Text style={styles.emptySubtext}>Crie um novo foco acima para iniciar!</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {studies.map((study, index) => (
        <Pressable
          key={study.studyId}
          style={styles.card}
          onPress={() => handleContinueStudy(study.studyId)}
        >
          {/* Card Cover Background */}
          {study.primaryContentId ? (
            <Image
              source={{ uri: (study as any).primaryThumbnailUrl || 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=400' }}
              style={styles.backgroundImage}
            />
          ) : (
            <View style={styles.colorBackground} />
          )}

          {/* Gradient Overlay for Cinematic Reading */}
          <View style={styles.gradientOverlay} />

          {/* Text & Metadata Container */}
          <View style={styles.cardContent}>
            <Text style={styles.journeyHeader}>
              {index === 0 ? 'Você já começou essa jornada. Vamos continuar?' : 'Continue de onde parou'}
            </Text>
            <Text style={styles.journeyTitle} numberOfLines={2}>
              {study.shortTitle}
            </Text>

            {/* Red accent Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${study.progressPercent}%` }]} />
              </View>
              <Text style={styles.progressText}>{study.progressPercent}% concluído</Text>
            </View>

            {/* Metrics List Grid */}
            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Ionicons name="play-circle-outline" size={14} color="#fff" />
                <Text style={styles.metricLabel}>{study.playlistsCount} Playlists</Text>
              </View>
              <View style={styles.metricItem}>
                <Ionicons name="book-outline" size={14} color="#fff" />
                <Text style={styles.metricLabel}>{study.videosCount} Vídeos</Text>
              </View>
              <View style={styles.metricItem}>
                <Ionicons name="document-text-outline" size={14} color="#fff" />
                <Text style={styles.metricLabel}>{study.notesCount} Anotações</Text>
              </View>
              <View style={styles.metricItem}>
                <Ionicons name="time-outline" size={14} color="#fff" />
                <Text style={styles.metricLabel}>{study.estimatedMinutes} min</Text>
              </View>
              <View style={styles.metricItem}>
                <Ionicons name="cash-outline" size={14} color="#fff" />
                <Text style={styles.metricLabel}>R$ {study.rewardValue.toFixed(2)}</Text>
              </View>
            </View>

            {/* Buttons Row */}
            <View style={styles.buttonsRow}>
              <Pressable
                onPress={() => handleContinueStudy(study.studyId)}
                style={styles.primaryBtn}
              >
                <Text style={styles.primaryBtnText}>Continuar estudo</Text>
              </Pressable>
              <Pressable
                onPress={() => handleContinueStudy(study.studyId)}
                style={styles.secondaryBtn}
              >
                <Text style={styles.secondaryBtnText}>Ver detalhes</Text>
              </Pressable>
            </View>

            {/* AI Classy tip banner */}
            <View style={styles.aiBanner}>
              <Text style={styles.aiText} numberOfLines={2}>
                <Text style={styles.aiAccent}>Classy:</Text> {study.summaryLine.replace(/^Classy:\s*/, '')}
              </Text>
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    paddingHorizontal: 0, // Align exactly at 0 margin inside AppScreen
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  loadingText: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.sm,
  },
  emptyContainer: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weightBold,
    marginTop: spacing.sm,
  },
  emptySubtext: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  card: {
    backgroundColor: '#18181b',
    borderRadius: radius.lg,
    height: 380,
    overflow: 'hidden',
    position: 'relative',
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    height: '100%',
    width: '100%',
    opacity: 0.6,
  },
  colorBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    // Simulated bottom gradient fade
    borderBottomWidth: 380,
    borderBottomColor: 'rgba(0, 0, 0, 0.75)',
  },
  cardContent: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
    padding: spacing.lg,
  },
  journeyHeader: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 12,
    fontWeight: typography.weightSemibold,
    marginBottom: spacing.xs,
  },
  journeyTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: typography.weightBlack,
    lineHeight: 28,
    marginBottom: spacing.md,
  },
  progressContainer: {
    marginBottom: spacing.md,
  },
  progressBarBg: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: radius.pill,
    height: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    backgroundColor: colors.accent, // Red accent
    height: '100%',
  },
  progressText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    marginTop: 4,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  metricItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  metricLabel: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 11,
    fontWeight: typography.weightBold,
  },
  buttonsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  primaryBtn: {
    backgroundColor: colors.text,
    borderRadius: radius.sm,
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: colors.background,
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  secondaryBtn: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: radius.sm,
    borderWidth: 1,
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weightBold,
  },
  aiBanner: {
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    borderTopWidth: 1,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  aiText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 15,
  },
  aiAccent: {
    color: colors.accent,
    fontWeight: typography.weightBold,
    fontStyle: 'normal',
  },
});
