import { useEffect, useRef, useState, useCallback } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { fetchStudyJourneySummary, toShortTitle, type StudyJourneySummary } from '@/lib/study/getStudyJourneySummary';
import { colors } from '@/theme/colors';
import { radius } from '@/theme/radius';
import { spacing } from '@/theme/spacing';

// ---- Types ----

interface LiveStates {
  isLiked: boolean;
  isSaved: boolean;
  isFavorited: boolean;
}

interface WatchMilestones {
  start: boolean;
  view15s: boolean;
  half: boolean;
  complete: boolean;
}

interface Props {
  contentId: string;
  studyId?: string | null;
  studyTitle?: string | null;
  liveStates?: LiveStates;
  milestones?: WatchMilestones;
  watchPercent?: number;
}

// ---- Nudge messages ----

interface NudgeMessage {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  iconColor: string;
}

function buildNudges(
  milestones: WatchMilestones | undefined,
  liveStates: LiveStates | undefined,
  actionPoints: Record<string, number>,
  earnedPP: number,
): NudgeMessage[] {
  const nudges: NudgeMessage[] = [];
  const fmt = (pts: number) => pts > 0 ? `+${pts} pts` : '';

  // Watch milestones (priority order)
  if (!milestones?.view15s) {
    const pts = actionPoints['VIEW_15S'] || 0;
    nudges.push({
      icon: 'play-outline',
      text: pts > 0 ? `Assista 15s e ganhe ${fmt(pts)}` : 'Assista 15 segundos para pontuar',
      iconColor: '#60A5FA',
    });
  }
  if (!milestones?.half) {
    const pts = actionPoints['WATCH_50'] || 0;
    nudges.push({
      icon: 'trending-up-outline',
      text: pts > 0 ? `Chegue em 50% e ganhe ${fmt(pts)}` : 'Continue assistindo — 50% vale pontos!',
      iconColor: '#FBBF24',
    });
  }
  if (!milestones?.complete) {
    const pts = actionPoints['WATCH_100'] || 0;
    nudges.push({
      icon: 'checkmark-circle-outline',
      text: pts > 0 ? `Complete o vídeo e ganhe ${fmt(pts)}` : 'Assista até o final para pontuar!',
      iconColor: '#34D399',
    });
  }

  // Social actions
  if (!liveStates?.isLiked) {
    const pts = actionPoints['LIKE_CONTENT'] || 0;
    nudges.push({
      icon: 'heart-outline',
      text: pts > 0 ? `Curtiu? Deixe o like e ganhe ${fmt(pts)}` : 'Curta e ganhe pontos!',
      iconColor: '#F87171',
    });
  }
  if (!liveStates?.isSaved) {
    const pts = actionPoints['SAVE_CONTENT'] || 0;
    nudges.push({
      icon: 'bookmark-outline',
      text: pts > 0 ? `Salve para depois e ganhe ${fmt(pts)}` : 'Salve este conteúdo!',
      iconColor: '#A78BFA',
    });
  }

  // Comment
  const commentPts = actionPoints['COMMENT_CONTENT'] || 0;
  if (commentPts > 0) {
    nudges.push({
      icon: 'chatbubble-outline',
      text: `Comente e ganhe ${fmt(commentPts)}`,
      iconColor: '#38BDF8',
    });
  }

  // All done
  if (nudges.length === 0 && earnedPP > 0) {
    nudges.push({
      icon: 'trophy-outline',
      text: 'Parabéns! Você desbloqueou todos os pontos 🎉',
      iconColor: '#FBBF24',
    });
  }

  return nudges;
}

// ---- Component ----

export function WatchRewardBar({ contentId, studyId, studyTitle, liveStates, milestones, watchPercent = 0 }: Props) {
  const { user } = useAuth();

  if (studyId) {
    return (
      <StudyModeBar
        studyId={studyId}
        studyTitle={studyTitle || null}
        userId={user?.id || null}
        contentTitle={studyTitle || null}
      />
    );
  }

  return (
    <PointsModeBar
      contentId={contentId}
      userId={user?.id || null}
      liveStates={liveStates}
      milestones={milestones}
      watchPercent={watchPercent}
    />
  );
}

// ---- Study Mode ----

function StudyModeBar({
  studyId,
  studyTitle,
  userId,
  contentTitle,
}: {
  studyId: string;
  studyTitle: string | null;
  userId: string | null;
  contentTitle: string | null;
}) {
  const [summary, setSummary] = useState<StudyJourneySummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!userId || !studyId) { setLoading(false); return; }
      setLoading(true);
      try {
        let title = studyTitle?.trim() || contentTitle?.trim() || '';

        if (!title) {
          const { data } = await supabase
            .from('studies')
            .select('title')
            .eq('id', studyId)
            .eq('user_id', userId)
            .maybeSingle();
          title = data?.title?.trim() || 'Estudo';
        }

        const result = await fetchStudyJourneySummary({ studyId, userId, title });
        if (!cancelled) setSummary(result);
      } catch (e) {
        console.error('WatchRewardBar study load error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [studyId, userId, studyTitle, contentTitle]);

  const displayTitle = summary?.shortTitle || toShortTitle(studyTitle || contentTitle || 'Estudo');
  const progressPercent = summary?.progressPercent ?? 0;
  const stageLabel = summary?.stageLabel || 'Em andamento';
  const rewardValue = summary?.rewardValue ?? 0;

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/study', params: { studyId } } as any)}
      style={styles.container}
    >
      {/* Row 1: Title + stats */}
      <View style={styles.studyRow1}>
        <Ionicons name="sparkles" size={15} color={colors.accent} style={{ marginRight: 6 }} />
        <Text numberOfLines={1} style={styles.studyTitle}>{displayTitle}</Text>

        {loading && !summary ? (
          <Text style={styles.studyLoading}>Carregando...</Text>
        ) : (
          <>
            <Text style={styles.studyPercent}>{progressPercent}%</Text>
            <View style={styles.studyDot} />
            <Ionicons name="bulb-outline" size={13} color="rgba(255,255,255,0.7)" style={{ marginRight: 3 }} />
            <Text style={styles.studyStage}>{stageLabel}</Text>
            {rewardValue > 0 && (
              <>
                <View style={styles.studyDot} />
                <Ionicons name="cash-outline" size={13} color="rgba(255,255,255,0.6)" style={{ marginRight: 3 }} />
                <Text style={styles.studyReward}>R$ {rewardValue.toFixed(2)}</Text>
              </>
            )}
          </>
        )}
      </View>

      {/* Row 2: Progress bar + link */}
      <View style={styles.studyRow2}>
        <View style={styles.studyProgressBg}>
          <View style={[styles.studyProgressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={styles.studyLink}>
          Plano de estudo <Ionicons name="chevron-forward" size={12} color={colors.accent} />
        </Text>
      </View>
    </Pressable>
  );
}

// ---- Points Mode with Animated Nudges ----

function PointsModeBar({
  contentId,
  userId,
  liveStates,
  milestones,
}: {
  contentId: string;
  userId: string | null;
  liveStates?: LiveStates;
  milestones?: WatchMilestones;
  watchPercent?: number;
}) {
  const [earnedPP, setEarnedPP] = useState(0);
  const [actionPoints, setActionPoints] = useState<Record<string, number>>({});
  const [earned, setEarned] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);

  // Nudge rotation
  const [nudgeIndex, setNudgeIndex] = useState(0);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Earned PP pulse
  const ppPulse = useRef(new Animated.Value(1)).current;
  const prevEarnedRef = useRef(0);

  // Load reward data
  useEffect(() => {
    if (!userId || !contentId) return;
    loadRewards(true);
  }, [userId, contentId]);

  // React to milestone changes
  useEffect(() => {
    if (!milestones || !userId || !contentId || !loaded) return;
    const t = setTimeout(() => loadRewards(false), 500);
    return () => clearTimeout(t);
  }, [milestones?.start, milestones?.view15s, milestones?.half, milestones?.complete]);

  // React to live like/save changes
  useEffect(() => {
    if (!liveStates || !loaded) return;
    setEarned(prev => ({
      ...prev,
      LIKE_CONTENT: liveStates.isLiked,
      SAVE_CONTENT: liveStates.isSaved,
    }));
    // Reload to get updated points
    if (userId && contentId) {
      const t = setTimeout(() => loadRewards(false), 400);
      return () => clearTimeout(t);
    }
  }, [liveStates?.isLiked, liveStates?.isSaved]);

  // Animate PP pulse when points change
  useEffect(() => {
    if (earnedPP > prevEarnedRef.current && prevEarnedRef.current > 0) {
      Animated.sequence([
        Animated.timing(ppPulse, { toValue: 1.25, duration: 200, useNativeDriver: true }),
        Animated.timing(ppPulse, { toValue: 1, duration: 300, easing: Easing.bounce, useNativeDriver: true }),
      ]).start();
    }
    prevEarnedRef.current = earnedPP;
  }, [earnedPP]);

  // Build nudges
  const nudges = buildNudges(milestones, liveStates, actionPoints, earnedPP);

  // Rotate nudges every 4s
  useEffect(() => {
    if (nudges.length <= 1) return;

    const interval = setInterval(() => {
      // Fade out + slide up
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: -8, duration: 250, useNativeDriver: true }),
      ]).start(() => {
        setNudgeIndex(prev => (prev + 1) % nudges.length);
        slideAnim.setValue(8);
        // Fade in + slide down
        Animated.parallel([
          Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(slideAnim, { toValue: 0, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]).start();
      });
    }, 4000);

    return () => clearInterval(interval);
  }, [nudges.length]);

  // Reset nudge index when nudges change
  useEffect(() => {
    setNudgeIndex(0);
    fadeAnim.setValue(1);
    slideAnim.setValue(0);
  }, [nudges.length]);

  async function loadRewards(isInitial: boolean) {
    if (!userId || !contentId) return;
    try {
      const [configResult, eventsResult, likeResult, saveResult, commentResult, trackingResult] = await Promise.all([
        supabase
          .from('reward_actions_config')
          .select('action_key, points_user')
          .in('action_key', ['VIEW_15S', 'WATCH_50', 'WATCH_100', 'LIKE_CONTENT', 'SAVE_CONTENT', 'COMMENT_CONTENT'])
          .eq('active', true),
        supabase
          .from('reward_events')
          .select('action_key, points')
          .eq('user_id', userId)
          .eq('content_id', contentId),
        supabase.from('actions').select('id').eq('user_id', userId).eq('content_id', contentId).eq('type', 'LIKE').maybeSingle(),
        supabase.from('saved_contents').select('id').eq('user_id', userId).eq('content_id', contentId).maybeSingle(),
        supabase.from('comments').select('id').eq('user_id', userId).eq('content_id', contentId).limit(1),
        supabase
          .from('reward_action_tracking')
          .select('action_key')
          .eq('user_id', userId)
          .like('action_key', `%${contentId}%`),
      ]);

      // Build points config map
      const configMap: Record<string, number> = {};
      (configResult.data || []).forEach((r: any) => { configMap[r.action_key] = r.points_user; });
      setActionPoints(configMap);

      const permanentKeys = new Set(
        (trackingResult.data || []).map((r: any) => r.action_key.split(`_${contentId}`)[0])
      );

      const earnedMap: Record<string, boolean> = {
        VIEW_15S:        permanentKeys.has('VIEW_15S'),
        WATCH_50:        permanentKeys.has('WATCH_50'),
        WATCH_100:       permanentKeys.has('WATCH_100'),
        LIKE_CONTENT:    !!likeResult.data,
        SAVE_CONTENT:    !!saveResult.data,
        COMMENT_CONTENT: (commentResult.data?.length ?? 0) > 0,
      };
      setEarned(earnedMap);

      const activeEvents = (eventsResult.data || []).filter((e: any) => {
        if (e.action_key === 'LIKE_CONTENT') return earnedMap.LIKE_CONTENT;
        if (e.action_key === 'SAVE_CONTENT') return earnedMap.SAVE_CONTENT;
        return true;
      });
      const totalPP = activeEvents.reduce((sum: number, e: any) => sum + (e.points || 0), 0);
      setEarnedPP(Math.round(totalPP * 10) / 10);
    } catch (e) {
      console.error('WatchRewardBar load error:', e);
    } finally {
      if (isInitial) setLoaded(true);
    }
  }

  if (!loaded) return null;

  const currentNudge = nudges[nudgeIndex % nudges.length] || nudges[0];
  if (!currentNudge) return null;

  return (
    <View style={styles.container}>
      <View style={styles.pointsRow}>
        {/* Earned PP badge */}
        <Animated.View style={[styles.ppBadge, { transform: [{ scale: ppPulse }] }]}>
          <Ionicons
            name="flash"
            size={13}
            color={earnedPP > 0 ? '#FFF' : 'rgba(255,255,255,0.6)'}
          />
          <Text style={[styles.ppText, earnedPP > 0 && styles.ppTextActive]}>
            +{earnedPP}
          </Text>
        </Animated.View>

        {/* Animated nudge message */}
        <Animated.View
          style={[
            styles.nudgeContainer,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <Ionicons
            name={currentNudge.icon}
            size={14}
            color={currentNudge.iconColor}
            style={{ marginRight: 6 }}
          />
          <Text numberOfLines={1} style={styles.nudgeText}>
            {currentNudge.text}
          </Text>
        </Animated.View>

        {/* Nudge count indicator */}
        {nudges.length > 1 && (
          <View style={styles.nudgeIndicator}>
            {nudges.map((_, i) => (
              <View
                key={i}
                style={[
                  styles.nudgeDot,
                  i === (nudgeIndex % nudges.length) && styles.nudgeDotActive,
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderRadius: radius.pill,
    marginBottom: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },

  // ---- Study Mode ----
  studyRow1: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  studyTitle: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600' as any,
    flex: 1,
    marginRight: 8,
  },
  studyPercent: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '700' as any,
  },
  studyDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255,255,255,0.35)',
    marginHorizontal: 6,
  },
  studyStage: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
  },
  studyReward: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600' as any,
  },
  studyLoading: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
  },
  studyRow2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  studyProgressBg: {
    flex: 1,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  studyProgressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.full,
  },
  studyLink: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '600' as any,
  },

  // ---- Points Mode ----
  pointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ppBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 3,
    flexShrink: 0,
  },
  ppText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '700' as any,
  },
  ppTextActive: {
    color: '#FFF',
  },
  nudgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    overflow: 'hidden',
  },
  nudgeText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    flex: 1,
  },
  nudgeIndicator: {
    flexDirection: 'row',
    gap: 3,
    flexShrink: 0,
  },
  nudgeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  nudgeDotActive: {
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});
