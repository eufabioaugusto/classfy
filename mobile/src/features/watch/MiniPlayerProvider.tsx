import { PropsWithChildren, useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useVideoPlayer, type VideoSource } from 'expo-video';
import { useAuth } from '@/features/auth/authContext';
import { supabase } from '@/lib/supabase';
import { MiniPlayerContent, MiniPlayerContext } from './miniPlayerContext';
import { notifyConfirmedRewards } from '@/features/rewards/events';
import { PlaybackProgress, createSessionId } from './playbackProgress';

type Session = {
  content: MiniPlayerContent; owner: string | undefined; id: string; tracker: PlaybackProgress;
  position: number; sent: number; accepted: number; ended: boolean;
  saving?: Promise<void>; lastAttempt?: number; pendingFlush?: boolean; rewards: Set<string>;
};
const identity = (content: MiniPlayerContent) => `${content.id}:${content.lessonId || ''}`;
const sourceUrl = (source: VideoSource) => {
  const uri = typeof source === 'string' ? source : source && typeof source === 'object' ? source.uri : null;
  if (!uri) return null;
  try { return new URL(uri).href; } catch { return uri; }
};
type SourceLoad = { revision: number; url: string | null; started: boolean; settled: boolean; confirmed: boolean };

export function MiniPlayerProvider({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const ownerRef = useRef(user?.id); ownerRef.current = user?.id;
  const player = useVideoPlayer(null, player => {
    player.timeUpdateEventInterval = 0.5;
    player.staysActiveInBackground = false;
    player.audioMixingMode = 'doNotMix';
  });
  const [content, setContent] = useState<MiniPlayerContent | null>(null);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string | null>(null);
  const [sourceReady, setSourceReady] = useState(false);
  const [watchPercent, setWatchPercent] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [qualifiedWatchSeconds, setQualifiedWatchSeconds] = useState(0);
  const [realWatchSeconds, setRealWatchSeconds] = useState(0);
  const current = useRef<Session | null>(null);
  const replacements = useRef<Promise<void>>(Promise.resolve());
  const revision = useRef(0);
  const sourceLoad = useRef<SourceLoad | null>(null);
  const requiresPlayAfterBackground = useRef(false);

  const syncSourceState = useCallback(() => {
    const load = sourceLoad.current;
    if (!load?.url || !load.confirmed || !load.settled || load.revision !== revision.current || !current.current || current.current.owner !== ownerRef.current) return;
    // statusChange has no source identity. Read the current native status after
    // sourceChange/sourceLoad proves the URL, instead of replaying an old payload.
    const nativeStatus = player.status;
    setStatus(nativeStatus);
    setSourceReady(nativeStatus === 'readyToPlay');
    setError(nativeStatus === 'error' ? 'Não foi possível reproduzir este vídeo.' : null);
    setDuration(player.duration || 0);
  }, [player]);

  const persist = useCallback(async (session: Session | null) => {
    if (!session?.owner || !session.content.trackingEnabled || session.tracker.watched <= 0) return;
    if (session.saving) {
      session.pendingFlush = true;
      await session.saving;
      return;
    }
    session.lastAttempt = Date.now();
    session.saving = (async () => {
      const watched = Math.floor(session.tracker.watched);
      const c = session.content;
      const course = Boolean(c.courseId && c.lessonId);
      const { data, error } = await supabase.rpc(course ? 'record_course_lesson_progress_v1' : 'record_content_progress_v2', course ? {
        p_lesson_id: c.lessonId, p_watched_seconds: Math.max(0, watched - session.accepted),
        p_last_position_seconds: Math.floor(session.position), p_progress_percent: 0,
      } : {
        p_content_id: c.trackingContentId || c.id, p_session_id: session.id,
        p_session_watched_seconds: watched, p_last_position_seconds: Math.floor(session.position),
        p_is_ended: session.ended,
      });
      if (error) { console.warn('Não foi possível sincronizar o progresso. Nova tentativa no próximo checkpoint.'); return; }
      session.sent = watched;
      session.accepted += Number(data?.accepted_watched_delta || 0);
      if (current.current === session) {
        setQualifiedWatchSeconds(Number(data?.total_watched_seconds || session.accepted));
        setWatchPercent(Number(course ? data?.lesson_progress_percent || 0 : data?.progress_percent || 0));
        setCompleted(Boolean(course ? data?.lesson_completed : data?.completed));
      }
      if (session.owner !== ownerRef.current) return;
      const actions = course ? (data?.course_completed ? ['COMPLETE_COURSE'] : []) : [
        'FIRST_CONTENT_WEEK', ...(Number(data?.total_watched_seconds) >= 15 ? ['VIEW_15S'] : []),
        ...(Number(data?.progress_percent) >= 50 ? ['WATCH_50'] : []),
        ...(Number(data?.progress_percent) >= 100 ? ['WATCH_100'] : []),
      ];
      for (const actionKey of actions) {
        if (session.rewards.has(actionKey)) continue;
        const result = await supabase.functions.invoke('process-reward', { body: {
          actionKey, userId: session.owner, contentId: course ? c.courseId : c.trackingContentId || c.id,
          metadata: { sessionId: session.id, source: course ? 'course_lesson_progress_v1' : 'content_progress_v2' },
        } });
        if (!result.error) { session.rewards.add(actionKey); if (session.owner === ownerRef.current) notifyConfirmedRewards(result.data?.rewards || []); }
      }
    })().finally(() => {
      session.saving = undefined;
      if (session.pendingFlush) { session.pendingFlush = false; void persist(session); }
    });
    await session.saving;
  }, []);

  const flush = useCallback(() => persist(current.current), [persist]);
  const closeMiniPlayer = useCallback(() => {
    player.pause(); current.current?.tracker.discontinuity();
    void flush(); current.current = null; revision.current += 1;
    sourceLoad.current = null; setSourceReady(false); setStatus('idle'); setError(null);
    setVisible(false); setContent(null); setPlaying(false); setPosition(0); setDuration(0);
    replacements.current = replacements.current.catch(() => {}).then(() => player.replaceAsync(null));
  }, [flush, player]);

  const attach = useCallback(async (next: MiniPlayerContent) => {
    setVisible(false);
    if (current.current && current.current.owner === ownerRef.current && identity(current.current.content) === identity(next) && current.current.content.fileUrl === next.fileUrl) { current.current.content = next; setContent(next); return; }
    const wasPlaying = player.playing;
    player.pause();
    const previous = current.current; previous?.tracker.discontinuity(); void persist(previous);
    const continuing = previous && identity(previous.content) === identity(next) && previous.owner === ownerRef.current;
    const resumePosition = continuing ? previous.position : (next.startPositionMillis || 0) / 1000;
    const session: Session = continuing ? previous : { content: next, owner: ownerRef.current, id: createSessionId(), tracker: new PlaybackProgress(), position: 0, sent: 0, accepted: 0, ended: false, rewards: new Set() };
    session.content = next;
    if (!continuing) requiresPlayAfterBackground.current = false;
    current.current = session;
    const request = ++revision.current;
    const load: SourceLoad = { revision: request, url: sourceUrl(next.fileUrl || null), started: false, settled: false, confirmed: false };
    sourceLoad.current = load; setSourceReady(false);
    setContent(next); setPosition(resumePosition); setDuration(0);
    if (!continuing) { setWatchPercent(0); setCompleted(false); setRealWatchSeconds(0); setQualifiedWatchSeconds(0); }
    setError(null); setStatus('loading');
    replacements.current = replacements.current.catch(() => {}).then(async () => {
      if (request !== revision.current) return;
      try {
        load.started = true;
        await player.replaceAsync(next.fileUrl || null);
        if (request !== revision.current) return;
        load.settled = true;
        syncSourceState();
        if (resumePosition) player.currentTime = resumePosition;
        if (continuing && wasPlaying) player.play();
      } catch { if (request === revision.current && session.owner === ownerRef.current) { setSourceReady(false); setStatus('error'); setError('Não foi possível abrir o vídeo. Tente novamente.'); } }
    });
    await replacements.current;
  }, [persist, player, syncSourceState]);

  const startMiniPlayer = useCallback((next: MiniPlayerContent) => {
    if (current.current && current.current.content.id === next.id && (!next.lessonId || current.current.content.lessonId === next.lessonId)) setVisible(true);
  }, []);
  const expand = useCallback(() => setVisible(false), []);
  const togglePlay = useCallback(() => {
    requiresPlayAfterBackground.current = false;
    if (player.playing) { player.pause(); current.current?.tracker.discontinuity(); void flush(); }
    else {
      const previous = current.current;
      if (previous?.ended) {
        void persist(previous);
        current.current = { ...previous, id: createSessionId(), tracker: new PlaybackProgress(), position: 0, sent: 0, accepted: 0, ended: false, saving: undefined, pendingFlush: false, lastAttempt: undefined, rewards: new Set() };
        player.currentTime = 0; setRealWatchSeconds(0);
      }
      player.play();
    }
  }, [flush, persist, player]);
  const seek = useCallback((seconds: number) => {
    current.current?.tracker.discontinuity();
    player.currentTime = Math.max(0, Math.min(player.duration || seconds, seconds));
    if (current.current) current.current.position = player.currentTime;
    setPosition(player.currentTime);
  }, [player]);

  useEffect(() => {
    const confirmSource = (source: VideoSource) => {
      const load = sourceLoad.current;
      if (!load?.started || !load.url || sourceUrl(source) !== load.url || load.revision !== revision.current || !current.current || current.current.owner !== ownerRef.current) return;
      load.confirmed = true;
      syncSourceState();
    };
    const subscriptions = [
      player.addListener('sourceChange', event => confirmSource(event.source)),
      player.addListener('sourceLoad', event => confirmSource(event.videoSource)),
      player.addListener('statusChange', () => syncSourceState()),
      player.addListener('playingChange', event => { if (event.isPlaying && requiresPlayAfterBackground.current) { player.pause(); setPlaying(false); return; } setPlaying(event.isPlaying); if (!event.isPlaying) { current.current?.tracker.discontinuity(); void flush(); } }),
      player.addListener('timeUpdate', event => {
        const session = current.current;
        setPosition(event.currentTime); setDuration(player.duration || 0);
        if (!session) return;
        session.position = event.currentTime;
        const watched = session.tracker.sample(event.currentTime, player.playing && AppState.currentState === 'active', Date.now(), player.playbackRate);
        setRealWatchSeconds(watched);
        if (Math.floor(watched) >= session.sent + 5 && Date.now() - (session.lastAttempt || 0) >= 5000) void persist(session);
      }),
      player.addListener('playToEnd', () => { if (current.current) { current.current.ended = true; current.current.position = player.duration; void flush(); } }),
      AppState.addEventListener('change', state => { if (state !== 'active') { requiresPlayAfterBackground.current = true; player.pause(); current.current?.tracker.discontinuity(); void flush(); } }),
    ];
    return () => { subscriptions.forEach(subscription => subscription.remove()); void flush(); };
  }, [flush, persist, player, syncSourceState]);
  useEffect(() => { if (current.current && current.current.owner !== user?.id) closeMiniPlayer(); }, [user?.id, closeMiniPlayer]);

  return <MiniPlayerContext.Provider value={{ content, visible, player, playing, position, duration, status, error, sourceReady, watchPercent, completed, realWatchSeconds, qualifiedWatchSeconds, attach, startMiniPlayer, closeMiniPlayer, expand, togglePlay, seek, flush }}>{children}</MiniPlayerContext.Provider>;
}
