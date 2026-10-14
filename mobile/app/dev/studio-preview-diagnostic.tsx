import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import * as FileSystem from 'expo-file-system/legacy';
import { randomUUID } from 'expo-crypto';
import { useAuth } from '@/features/auth/authContext';
import { usePrimaryAction } from '@/contexts/PrimaryActionContext';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { compileStudioRecipe, type StudioProject } from '@/features/studio/model';
import { StudioCompositionPreview, type StudioPreviewDiagnosticEvent } from '@/features/studio/StudioCompositionPreview';
import type { StudioPlaybackState, StudioPreviewHandle } from '@/features/studio/StudioPreview';
import type { StudioTimelinePlaybackChannel } from '@/features/studio/timelinePlaybackChannel';
import { initialStudioCanvasTransformChannel } from '@/features/studio/canvasTransformChannel';
import { createStudioPreviewDiagnosticReport, createStudioPreviewPlaybackProbe, mayRunStudioPreviewDiagnostic,
  studioPreviewDiagnosticEvent, studioPreviewDiagnosticRecipe } from '@/features/studio/previewDiagnostic';
import { isStudioCompositionAvailable, isStudioEditorToolsAvailable, isStudioInteractiveCompositionAvailable } from '../../modules/classfy-studio-media';

/** Read-only playback diagnostic of an owned project. Never creates/records/saves media. */
export default function StudioPreviewDiagnostic() {
  if (!__DEV__) return <Redirect href="/" />;
  return <DevelopmentPreviewDiagnostic />;
}
function DevelopmentPreviewDiagnostic() {
  const params = useLocalSearchParams<{ projectId?: string; run?: string }>(), router = useRouter();
  const projectId = (Array.isArray(params.projectId) ? params.projectId[0] : params.projectId) || '';
  const automatic = (Array.isArray(params.run) ? params.run[0] : params.run) === 'auto';
  const { user, loading: authLoading } = useAuth(), { canPublish, roleLoading } = usePrimaryAction();
  const { project, loading, error } = useStudioProject(projectId);
  const focused = useIsFocused(), [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [reload, setReload] = useState(0);
  useEffect(() => { const listener = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => listener.remove(); }, []);
  const allowed = !authLoading && !loading && !roleLoading && canPublish
    && mayRunStudioPreviewDiagnostic(__DEV__, user?.id, project, focused, foreground);
  if (!allowed || !project) return <View style={styles.blocked}>
    {(authLoading || loading || roleLoading) && <ActivityIndicator color="#FFF" />}
    <Text style={styles.title}>Diagnóstico da prévia</Text>
    <Text style={styles.message}>{authLoading || loading || roleLoading ? 'Abrindo a conta e o projeto local…'
      : !user ? 'Entre na conta que possui este projeto.' : !focused || !foreground ? 'Diagnóstico pausado fora do primeiro plano.'
        : error || 'Informe um projeto desta conta com pelo menos um take salvo e acesso ao Studio.'}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Fechar diagnóstico" onPress={() => router.back()} style={styles.button}><Text style={styles.label}>Fechar</Text></Pressable>
  </View>;
  return <ProjectPreviewDiagnostic key={`${project.id}:${reload}`} project={project} ownerId={user!.id}
    automatic={automatic} onClose={() => router.back()} onReload={() => setReload(value => value + 1)} />;
}
function ProjectPreviewDiagnostic({ project, ownerId, automatic, onClose, onReload }: {
  project: StudioProject; ownerId: string; automatic: boolean; onClose: () => void; onReload: () => void;
}) {
  const insets = useSafeAreaInsets(), { orientationReady, orientationError } = useStudioOrientation(project.kind, true, 'editor');
  const preview = useRef<StudioPreviewHandle>(null), alive = useRef(true), pausedIntent = useRef(true);
  const latest = useRef({ ownerId, project }); latest.current = { ownerId, project };
  const [paused, setPaused] = useState(true), [playSequence, setPlaySequence] = useState(0);
  const [stage, setStage] = useState('created'), [failure, setFailure] = useState<string | null>(null);
  const recipe = useMemo(() => compileStudioRecipe(project), [project.editing, project.kind, project.takes]);
  const playbackChannel = useSharedValue<StudioTimelinePlaybackChannel>({ active: false, sequence: 0, position: 0, playing: false, loading: false });
  const canvasTransformChannel = useSharedValue(initialStudioCanvasTransformChannel());
  const report = useMemo(() => createStudioPreviewDiagnosticReport({ runId: randomUUID(), metadata: {
    projectId: project.id, kind: project.kind, projectRevision: project.revision, startedAt: new Date().toISOString(), automatic,
    environment: { platform: Platform.OS, development: __DEV__ }, recipe: studioPreviewDiagnosticRecipe(recipe),
    capabilities: { composition: isStudioCompositionAvailable(), editorTools: isStudioEditorToolsAvailable(), interactive: isStudioInteractiveCompositionAvailable() },
  }, write: async data => {
    if (!FileSystem.cacheDirectory) return;
    await FileSystem.writeAsStringAsync(`${FileSystem.cacheDirectory}classfy-studio-preview-diagnostic.json`, data);
  } }), []);
  const probe = useRef<ReturnType<typeof createStudioPreviewPlaybackProbe> | null>(null);
  const log = useCallback((nextStage: string, value: Record<string, unknown> = {}) => {
    if (alive.current) setStage(nextStage);
    void report.event(nextStage, value);
  }, [report]);
  const pause = useCallback(() => { pausedIntent.current = true; preview.current?.pause(); if (alive.current) setPaused(true); }, []);
  const play = useCallback(() => {
    if (!alive.current || !pausedIntent.current || latest.current.project.ownerId !== latest.current.ownerId) return;
    pausedIntent.current = false;
    setPaused(false); setPlaySequence(value => value + 1);
  }, []);
  useEffect(() => {
    if (paused || !playSequence || !alive.current) return;
    preview.current?.togglePlayback();
  }, [playSequence, paused]);
  useEffect(() => {
    alive.current = true; log('mounted');
    return () => { alive.current = false; probe.current?.dispose(); probe.current = null; void report.event('unmounted'); };
  }, [log, report]);
  useEffect(() => {
    log('orientation', { ready: orientationReady, error: orientationError || null });
    if (!orientationReady) return;
    const current = createStudioPreviewPlaybackProbe({ automatic,
      current: () => alive.current && latest.current.ownerId === ownerId && latest.current.project.id === project.id,
      play, pause, report: log });
    probe.current = current;
    return () => { current.dispose(); if (probe.current === current) probe.current = null; };
  }, [orientationReady, automatic, ownerId, project.id, play, pause, log, orientationError]);
  const diagnostic = useCallback((event: StudioPreviewDiagnosticEvent) => {
    if (!alive.current || latest.current.project.ownerId !== latest.current.ownerId) return;
    const metadata = studioPreviewDiagnosticEvent(event);
    log(event.type === 'error' ? 'native-error' : event.type, metadata);
    if (event.type === 'error') { setFailure(String(metadata.message)); probe.current?.nativeError(); }
  }, [log]);
  const nativeDiagnostics = useCallback((value: Record<string, unknown>) => {
    if (alive.current && latest.current.project.ownerId === latest.current.ownerId) log('native-diagnostics', value);
  }, [log]);
  const playback = useCallback((value: StudioPlaybackState) => {
    if (!alive.current) return;
    probe.current?.playback(value);
  }, []);
  const nativeReady = orientationReady && isStudioCompositionAvailable();
  return <View style={[styles.screen, { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 12) }]}>
    <Text style={styles.title}>Diagnóstico da prévia · {project.kind === 'short' ? 'Short' : project.kind === 'aula' ? 'Aula' : 'Podcast'}</Text>
    <Text style={styles.subtitle}>Projeto existente · reprodução apenas · sem gravação ou edição</Text>
    <View style={styles.preview}>{nativeReady ? <StudioCompositionPreview ref={preview} project={project} recipe={recipe} paused={paused}
      playbackChannel={playbackChannel} canvasTransformChannel={canvasTransformChannel} onPlaybackState={playback}
      onPreviewDiagnostic={diagnostic} onNativeDiagnostics={nativeDiagnostics} /> : <ActivityIndicator color="#FFF" />}</View>
    <Text selectable style={styles.message}>{failure || orientationError || stage}</Text>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="Reproduzir diagnóstico" disabled={!nativeReady} onPress={() => { log('manual-play-requested'); play(); }} style={styles.button}><Text style={styles.label}>Play</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Pausar diagnóstico" onPress={() => { pause(); log('manual-pause'); }} style={styles.button}><Text style={styles.label}>Pausar</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Reabrir a mesma prévia" onPress={() => { pause(); log('reload-requested'); onReload(); }} style={styles.button}><Text style={styles.label}>Reabrir</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Fechar diagnóstico" onPress={() => { pause(); log('close-requested'); onClose(); }} style={styles.button}><Text style={styles.label}>Fechar</Text></Pressable>
    </View>
    <Text style={styles.subtitle}>Relatório local: classfy-studio-preview-diagnostic.json</Text>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0E11', paddingHorizontal: 16, gap: 12 },
  blocked: { flex: 1, justifyContent: 'center', backgroundColor: '#0B0E11', padding: 24, gap: 18 },
  title: { color: '#FFF', fontSize: 17, fontWeight: '600' }, subtitle: { color: '#9AA0A8', fontSize: 11, lineHeight: 16 },
  preview: { flex: 1, minHeight: 160, backgroundColor: '#000' }, message: { color: '#DFE2E7', fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 44, borderRadius: 10, backgroundColor: '#292F36', paddingHorizontal: 15, justifyContent: 'center' },
  label: { color: '#FFF', fontSize: 13, fontWeight: '600' },
});
