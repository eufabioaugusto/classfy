import { supabase } from '@/lib/supabase';

export type StudyJourneyStatusTone =
  | 'empty'
  | 'starting'
  | 'active'
  | 'advancing'
  | 'completed';

export interface StudyJourneySummary {
  studyId: string;
  title: string;
  shortTitle: string;
  progressPercent: number;
  stageLabel: string;
  completionLabel: string;
  playlistsCount: number;
  videosCount: number;
  notesCount: number;
  completedContentsCount: number;
  engagedContentsCount: number;
  totalRecommendedContents: number;
  estimatedMinutes: number;
  rewardValue: number;
  performancePoints: number;
  hasRealProgress: boolean;
  statusTone: StudyJourneyStatusTone;
  summaryLine: string;
  nextBestAction: string | null;
  currentFocus: string | null;
  activeMode: string;
  primaryContentId: string | null;
  recommendedContentIds: string[];
  backgroundVideoUrl: string | null;
  thumbnailUrl: string | null;
}

const modeLabels: Record<string, string> = {
  onboard: 'Diagnóstico',
  explain: 'Explicando',
  recommend: 'Trilha',
  practice: 'Praticando',
  review: 'Revisando',
  plan: 'Plano',
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const stripStudyLeadIn = (value: string) => {
  const patterns = [
    /^(ol[aá]|oi|opa|e ai|e aí|hey)\s*[!,.:\-–—]?\s*/i,
    /^quero aprender sobre\s+/i,
    /^quero aprender\s+/i,
    /^aprender sobre\s+/i,
    /^aprender\s+/i,
    /^estudo sobre\s+/i,
    /^estudo de\s+/i,
    /^como\s+/i,
  ];

  let cleaned = value.trim();
  let previous = '';

  while (cleaned && cleaned !== previous) {
    previous = cleaned;

    patterns.forEach((pattern) => {
      cleaned = cleaned.replace(pattern, '');
    });

    cleaned = cleaned
      .replace(/\s+/g, ' ')
      .replace(/\s+[!?.:,;]+$/g, '')
      .trim();
  }

  return cleaned;
};

export const toShortTitle = (title: string) => {
  const cleaned = stripStudyLeadIn(title);

  if (!cleaned) return title.trim();

  return cleaned
    .split(/[:|-]/)[0]
    .trim()
    .replace(/\s+/g, ' ');
};

export const normalizeStudyTitle = (title: string) => {
  const shortTitle = toShortTitle(title);

  if (!shortTitle) return title.trim();

  const normalizedShort = shortTitle
    .replace(/^(de|do|da|dos|das)\s+/i, '')
    .trim();

  return normalizedShort ? `Aprender ${normalizedShort}` : `Aprender ${shortTitle}`;
};

const extractContentIds = (messages: any[]) => {
  const ids = new Set<string>();
  let primaryContentId: string | null = null;

  for (const message of messages) {
    if (!Array.isArray(message.related_contents)) continue;

    for (const content of message.related_contents) {
      const contentId =
        typeof content === 'string'
          ? content
          : content && typeof content === 'object' && 'id' in content
          ? String(content.id)
          : null;

      if (!contentId) continue;

      ids.add(contentId);
      if (!primaryContentId) primaryContentId = contentId;
    }
  }

  return {
    recommendedContentIds: Array.from(ids),
    primaryContentId,
  };
};

const inferStatusTone = (
  progressPercent: number,
  hasRealProgress: boolean
): StudyJourneyStatusTone => {
  if (progressPercent >= 100) return 'completed';
  if (progressPercent >= 70) return 'advancing';
  if (progressPercent > 0) return 'active';
  if (hasRealProgress) return 'starting';
  return 'empty';
};

const buildSummaryLine = (input: {
  progressPercent: number;
  hasRealProgress: boolean;
  shortTitle: string;
  statusTone: StudyJourneyStatusTone;
}) => {
  const { progressPercent, hasRealProgress, shortTitle, statusTone } = input;

  if (!hasRealProgress || statusTone === 'empty') {
    return `Classy: Seu estudo de ${shortTitle} já está pronto para ganhar ritmo. Vamos começar?`;
  }

  if (statusTone === 'starting') {
    return `Classy: Você já começou ${shortTitle}. Vamos consolidar essa base?`;
  }

  if (statusTone === 'active') {
    return `Classy: Você já avançou ${progressPercent}% no estudo de ${shortTitle}. Continue assim!`;
  }

  if (statusTone === 'advancing') {
    return `Classy: Seu estudo de ${shortTitle} já ganhou tração (${progressPercent}% concluído). Falta pouco para avançar mais.`;
  }

  return `Classy: Você concluiu a maior parte deste estudo (${progressPercent}% concluído). Hora de fechar com profundidade.`;
};

export async function fetchStudyJourneySummary(input: {
  studyId: string;
  userId: string;
  title: string;
}): Promise<StudyJourneySummary> {
  const { studyId, userId, title } = input;

  const [
    messagesResult,
    playlistsResult,
    notesResult,
    aiStateResult,
    quizAttemptsResult,
  ] = await Promise.all([
    supabase
      .from('study_messages')
      .select('id, related_contents')
      .eq('study_id', studyId)
      .eq('role', 'assistant')
      .order('created_at', { ascending: true }),
    supabase
      .from('study_playlists')
      .select('message_id')
      .eq('study_id', studyId)
      .eq('user_id', userId),
    supabase
      .from('study_notes')
      .select('content_id')
      .eq('study_id', studyId)
      .eq('user_id', userId),
    supabase
      .from('study_ai_state')
      .select('active_mode, current_focus, next_best_action')
      .eq('study_id', studyId)
      .maybeSingle(),
    supabase
      .from('quiz_attempts')
      .select('completed_at, quiz_id')
      .eq('user_id', userId),
  ]);

  if (messagesResult.error) throw messagesResult.error;
  if (playlistsResult.error) throw playlistsResult.error;
  if (notesResult.error) throw notesResult.error;
  if (aiStateResult.error) throw aiStateResult.error;
  if (quizAttemptsResult.error) throw quizAttemptsResult.error;

  const messages = (messagesResult.data || []) as any[];
  const playlists = (playlistsResult.data || []) as any[];
  const notes = (notesResult.data || []) as any[];
  const aiState = (aiStateResult.data || null) as any | null;
  const quizAttempts = (quizAttemptsResult.data || []) as any[];

  const { recommendedContentIds, primaryContentId } = extractContentIds(messages);
  const totalRecommendedContents = recommendedContentIds.length;

  // Simple filtering for quizzes belonging to this study
  const hasCompletedQuiz = quizAttempts.length > 0;

  let progressRows: any[] = [];
  let rewardRows: any[] = [];
  let contentDurations: any[] = [];

  if (recommendedContentIds.length > 0) {
    const [progressResult, rewardsResult, contentsResult] = await Promise.all([
      supabase
        .from('user_progress')
        .select('content_id, progress_percent, completed')
        .eq('user_id', userId)
        .in('content_id', recommendedContentIds),
      supabase
        .from('reward_events')
        .select('content_id, value, performance_points')
        .eq('user_id', userId)
        .in('content_id', recommendedContentIds),
      supabase
        .from('contents')
        .select('id, duration_seconds, video_url, file_url, thumbnail_url')
        .in('id', recommendedContentIds),
    ]);

    if (progressResult.error) throw progressResult.error;
    if (rewardsResult.error) throw rewardsResult.error;
    if (contentsResult.error) throw contentsResult.error;

    progressRows = (progressResult.data || []) as any[];
    rewardRows = (rewardsResult.data || []) as any[];
    contentDurations = (contentsResult.data || []) as any[];
  }

  const notesCount = notes.length;
  const playlistsCount = playlists.length;

  const noteContentIds = new Set(
    notes.map((note) => note.content_id).filter(Boolean) as string[]
  );
  const engagedContentIds = new Set<string>();
  const completedContentIds = new Set<string>();

  for (const row of progressRows) {
    if (row.progress_percent > 0) {
      engagedContentIds.add(row.content_id);
    }

    if (row.completed || row.progress_percent >= 90) {
      completedContentIds.add(row.content_id);
    }
  }

  for (const contentId of noteContentIds) {
    engagedContentIds.add(contentId);
  }

  const rewardValue = rewardRows.reduce(
    (sum, row) => sum + Number(row.value || 0),
    0
  );
  const performancePoints = rewardRows.reduce(
    (sum, row) => sum + Number(row.performance_points || 0),
    0
  );

  const durationById = new Map(
    contentDurations.map((content) => [content.id, Number(content.duration_seconds || 0)])
  );

  const estimatedMinutesFromDurations = recommendedContentIds.reduce(
    (sum, contentId) => sum + (durationById.get(contentId) || 0),
    0
  );

  const estimatedMinutes =
    estimatedMinutesFromDurations > 0
      ? Math.max(1, Math.round(estimatedMinutesFromDurations / 60))
      : totalRecommendedContents * 10 + Math.min(notesCount, 5) * 2;

  const completedRatio =
    totalRecommendedContents > 0
      ? completedContentIds.size / totalRecommendedContents
      : 0;
  const engagedRatio =
    totalRecommendedContents > 0
      ? engagedContentIds.size / totalRecommendedContents
      : 0;

  const progressPercent =
    totalRecommendedContents === 0
      ? 0
      : clamp(
          Math.round(
            completedRatio * 50 +
              engagedRatio * 20 +
              (Math.min(playlistsCount, 3) / 3) * 15 +
              (Math.min(notesCount, 5) / 5) * 10 +
              (hasCompletedQuiz ? 5 : 0)
          ),
          0,
          100
        );

  const hasRealProgress =
    engagedContentIds.size > 0 ||
    completedContentIds.size > 0 ||
    playlistsCount > 0 ||
    notesCount > 0 ||
    hasCompletedQuiz;

  const activeMode = aiState?.active_mode || 'onboard';
  const currentFocus = aiState?.current_focus ?? null;
  const nextBestAction = aiState?.next_best_action ?? null;
  const shortTitle = toShortTitle(title);
  const statusTone = inferStatusTone(progressPercent, hasRealProgress);
  const summaryLine = buildSummaryLine({
    progressPercent,
    hasRealProgress,
    shortTitle,
    statusTone,
  });

  return {
    studyId,
    title,
    shortTitle,
    progressPercent,
    stageLabel: modeLabels[activeMode] || 'Diagnóstico',
    completionLabel: `${progressPercent}%`,
    playlistsCount,
    videosCount: totalRecommendedContents,
    notesCount,
    completedContentsCount: completedContentIds.size,
    engagedContentsCount: engagedContentIds.size,
    totalRecommendedContents,
    estimatedMinutes,
    rewardValue,
    performancePoints,
    hasRealProgress,
    statusTone,
    summaryLine,
    nextBestAction,
    currentFocus,
    activeMode,
    primaryContentId,
    recommendedContentIds,
    backgroundVideoUrl: (() => {
      const primary = contentDurations.find(c => c.id === primaryContentId);
      if (primary) return primary.file_url || primary.video_url || null;
      const firstWithVideo = contentDurations.find(c => c.file_url || c.video_url);
      return firstWithVideo?.file_url || firstWithVideo?.video_url || null;
    })(),
    thumbnailUrl: (() => {
      const primary = contentDurations.find(c => c.id === primaryContentId);
      if (primary) return primary.thumbnail_url || null;
      return contentDurations[0]?.thumbnail_url || null;
    })(),
  };
}
