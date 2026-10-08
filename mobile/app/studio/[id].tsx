import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, FileText, Film, Maximize2, Mic, Minimize2, Pause, Pencil, Play, Scissors, Redo2, Split, Trash2, Undo2, Upload, Video, X } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { importStudioMedia, recoverPendingStudioTakes } from '@/features/studio/media';
import { discardTransientStudioProject, getStudioProject, isTransientStudioProject, mutateStudioProject } from '@/features/studio/store';
import { duplicateStudioTake, locateStudioTime, moveStudioTake, removeStudioTake, splitStudioTake } from '@/features/studio/timeline';
import { formatStudioEditorTime, timelineDuration, type StudioProject, type StudioTake } from '@/features/studio/model';
import { StudioPreview, type StudioPlaybackState, type StudioPreviewHandle } from '@/features/studio/StudioPreview';
import { StudioTimeline } from '@/features/studio/StudioTimeline';
import { createStudioEditingHistory } from '@/features/studio/editingHistory';
import { canContinueStudioTrim, freezeStudioTrim } from '@/features/studio/timelineLayout';
import { StudioAccess, StudioButton, StudioField, StudioLoading, StudioSaveStatus, studioStyles, useStudioFields } from '@/features/studio/StudioUI';

export default function StudioProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, update } = useStudioProject(Array.isArray(id) ? id[0] : id || '');
  return <StudioAccess>{loading ? <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Seu projeto" back />}><StudioLoading /></AppScreen> : !project ?
    <AppScreen header={<NavigationHeader title="Seu projeto" back />}><View style={studioStyles.empty}><Text style={studioStyles.sectionTitle}>Projeto indisponível</Text><Text style={studioStyles.body}>{error || 'Este projeto não foi encontrado nesta conta e neste aparelho.'}</Text></View></AppScreen> : <ProjectEditor key={project.id} project={project} update={update} />}
  </StudioAccess>;
}

type Panel = 'preparation' | 'recovery' | null;
type TrimRange = { takeId: string; start: number; end: number; previewSourceSeconds?: number };
function ProjectEditor({ project, update }: { project: StudioProject; update: (id: string, patch: Partial<StudioProject>) => Promise<StudioProject> }) {
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const landscape = width > height;
  const [fullscreen, setFullscreen] = useState(false);
  const { orientationReady, orientationError } = useStudioOrientation(project.kind, true, fullscreen ? 'preview' : 'editor');
  const { user } = useAuth();
  const current = useRef({ project, owner: user?.id }); current.current = { project, owner: user?.id };
  const { fields, setField, flush, saving, saveError } = useStudioFields(project, update, { preventNavigation: false });
  const [panel, setPanel] = useState<Panel>(null);
  const [selectedTakeId, setSelectedTakeId] = useState<string>();
  const [organizing, setOrganizing] = useState(false);
  const [trimDraft, setTrimDraft] = useState<TrimRange | null>(null);
  const trimPreviewSource = useRef<{ takeId: string; seconds: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: width - 24, height: Math.max(180, height - 410) });
  const [history] = useState(() => createStudioEditingHistory());
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [activeTakeId, setActiveTakeId] = useState(project.takes[0]?.id);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const allowRemoval = useRef(false);
  const leaving = useRef(false);
  const mounted = useRef(true);
  const preview = useRef<StudioPreviewHandle>(null);
  const [playback, setPlayback] = useState<StudioPlaybackState>({ position: 0, sourcePosition: 0, playing: false, loading: false });
  const playbackRef = useRef(playback); playbackRef.current = playback;
  const receivePlayback = useCallback((state: StudioPlaybackState) => {
    setPlayback(previous => previous.position === state.position && previous.sourcePosition === state.sourcePosition && previous.playing === state.playing && previous.loading === state.loading && previous.takeId === state.takeId ? previous : state);
  }, []);
  const activeTake = project.takes.find(take => take.id === (selectedTakeId || activeTakeId)) || project.takes[0];
  const previewTakes = useMemo(() => trimDraft ? project.takes.map(take => take.id === trimDraft.takeId ? { ...take, start: trimDraft.start, end: trimDraft.end } : take) : project.takes, [project.takes, trimDraft]);
  const activeIndex = project.takes.findIndex(take => take.id === activeTake?.id);
  const duration = timelineDuration(previewTakes);
  const previewAspect = project.kind === 'short' ? 9 / 16 : project.kind === 'aula' ? 16 / 9 : 1;
  const previewWidth = Math.max(1, Math.min(stageSize.width - 24, (stageSize.height - 42) * previewAspect));
  const previewHeight = previewWidth / previewAspect;
  const locked = ['preparing', 'uploading', 'processing', 'submitted'].includes(project.state);
  const transient = isTransientStudioProject(project.ownerId, project.id);
  const maxSheetHeight = Math.max(1, height - insets.top - 12);
  const sheetContentWidth = landscape ? Math.min(width - insets.left - insets.right, maxSheetHeight * 16 / 9) : undefined;
  const sheetContentStyle = { width: '100%' as const, maxWidth: sheetContentWidth, alignSelf: 'center' as const };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!project.takes.some(take => take.id === activeTakeId)) setActiveTakeId(project.takes[0]?.id); }, [project.takes, activeTakeId]);
  useEffect(() => {
    if (selectedTakeId && !project.takes.some(take => take.id === selectedTakeId)) { setSelectedTakeId(undefined); setOrganizing(false); }
  }, [project.takes, selectedTakeId]);
  useEffect(() => {
    const owner = current.current.owner || '';
    setHistoryState(history.sync(owner === project.ownerId ? getStudioProject(owner, project.id) || null : null, owner));
  }, [history, project, user?.id]);
  useEffect(() => { if (focused) allowRemoval.current = false; }, [focused]);
  useEffect(() => { navigation.setOptions({ gestureEnabled: !busy && !trimDraft && !saving }); }, [navigation, busy, trimDraft, saving]);
  usePreventRemove(busy || !!trimDraft || saving || !!saveError, ({ data }) => {
    if (allowRemoval.current) { navigation.dispatch(data.action); return; }
    // A take write must settle before leaving; an unfinished drag is discarded.
    if (working.current || leaving.current) return;
    if (trimDraft) { trimPreviewSource.current = null; setTrimDraft(null); return; }
    leaving.current = true;
    if (!startWork()) { leaving.current = false; return; }
    void flush().then(async () => {
      assertOwner();
      if (!mounted.current) return;
      await discardTransientStudioProject(project.ownerId, project.id);
      // Discarding an empty session can unmount this editor by design.
      allowRemoval.current = true; navigation.dispatch(data.action);
    }).catch(() => {
      // Metadata retains its pending patch and exposes the existing retry.
    }).finally(() => { leaving.current = false; finishWork(); });
  });
  useEffect(() => {
    const pending = trimPreviewSource.current;
    if (!trimDraft || !pending) return;
    const index = previewTakes.findIndex(take => take.id === pending.takeId);
    const take = previewTakes[index];
    if (!take) return;
    trimPreviewSource.current = null;
    const source = Math.max(take.start, Math.min(take.end - 0.005, pending.seconds));
    preview.current?.seek(timelineDuration(previewTakes.slice(0, index)) + source - take.start);
  }, [trimDraft, previewTakes]);
  const assertOwner = () => { if (current.current.owner !== project.ownerId) throw new Error('Abra este projeto na conta que o criou.'); };
  const startWork = () => {
    if (working.current) return false;
    allowRemoval.current = false;
    working.current = true; setBusy(true); preview.current?.pause(); return true;
  };
  const finishWork = () => { working.current = false; if (mounted.current) setBusy(false); };
  const editTakes = async (change: ((takes: readonly StudioTake[]) => StudioTake[]) | 'undo' | 'redo') => {
    if (locked || !startWork()) return;
    let operation: ReturnType<typeof history.beginEdit> = null;
    try {
      await flush(); assertOwner();
      const saved = await mutateStudioProject(project.ownerId, project.id, latest => {
        assertOwner();
        operation = change === 'undo' ? history.beginUndo(latest) : change === 'redo' ? history.beginRedo(latest) : history.beginEdit(latest, change(latest.takes));
        return { takes: operation ? operation.takes : [...latest.takes] };
      });
      if (operation) history.commit(operation, saved);
      if (mounted.current) setHistoryState(history.state());
      return saved;
    } catch (error) {
      if (operation) history.abort(operation);
      if (mounted.current) setHistoryState(history.state());
      Alert.alert('Editar montagem', error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.');
    } finally { finishWork(); }
  };
  const addMedia = async () => {
    if (locked || !startWork()) return;
    try {
      const latest = await flush(); assertOwner();
      const takes = await importStudioMedia(latest); assertOwner();
      if (mounted.current && takes.length) { setActiveTakeId(takes[0].id); setSelectedTakeId(takes[0].id); }
    } catch (error) { Alert.alert('Importar conteúdo', error instanceof Error ? error.message : 'Não foi possível importar. Tente novamente.'); }
    finally { finishWork(); }
  };
  const recoverTakes = async () => {
    if (locked || !startWork()) return;
    try {
      const latest = await flush(); assertOwner();
      const result = await recoverPendingStudioTakes(latest);
      if (result.errors.length) Alert.alert('Recuperação de arquivos', result.errors.join('\n'));
      else if (!result.recovered) Alert.alert('Recuperação de arquivos', 'Nenhum arquivo foi recuperado. Seus arquivos continuam preservados.');
      else if (mounted.current) setPanel(null);
    } catch (error) { Alert.alert('Recuperação de arquivos', error instanceof Error ? error.message : 'Não foi possível recuperar seus arquivos.'); }
    finally { finishWork(); }
  };
  const discardPending = () => Alert.alert('Retirar arquivos pendentes do projeto?', 'Os takes prontos continuam preservados.', [
    { text: 'Cancelar', style: 'cancel' }, { text: 'Retirar pendentes', style: 'destructive', onPress: () => {
      if (locked || !startWork()) return;
      void flush().then(() => { assertOwner(); return mutateStudioProject(project.ownerId, project.id, () => { assertOwner(); return { pendingTakes: [] }; }); })
        .then(() => { if (mounted.current) setPanel(null); }).catch(() => Alert.alert('Arquivos preservados', 'Não foi possível atualizar o projeto. Tente novamente.')).finally(finishWork);
    } },
  ]);
  const navigate = async (destination: 'record' | 'review' | 'back') => {
    if (working.current || trimDraft || (destination === 'record' && locked)) return;
    if (!startWork()) return;
    try {
      await flush(); assertOwner();
      if (!mounted.current) return;
      if (destination === 'back') { await discardTransientStudioProject(project.ownerId, project.id); allowRemoval.current = true; if (router.canGoBack()) router.back(); else router.replace('/studio'); }
      else router.push({ pathname: destination === 'record' ? '/studio/capture' : '/studio/review', params: { id: project.id } });
    } catch (error) { Alert.alert('Seu projeto está aqui', error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { finishWork(); }
  };
  const selectTake = (take: StudioTake) => {
    if (working.current || trimDraft) return;
    preview.current?.pause(); setSelectedTakeId(take.id); setActiveTakeId(take.id);
    const index = current.current.project.takes.findIndex(item => item.id === take.id);
    preview.current?.seek(timelineDuration(current.current.project.takes.slice(0, index)));
  };
  const openPanel = (next: Panel) => {
    if (working.current || trimDraft) return;
    preview.current?.pause(); setPanel(next);
  };
  const previewTrim = (range: TrimRange) => {
    if (working.current || locked) return;
    preview.current?.pause(); setSelectedTakeId(range.takeId); setActiveTakeId(range.takeId);
    trimPreviewSource.current = { takeId: range.takeId, seconds: range.previewSourceSeconds ?? range.start };
    setTrimDraft(range);
  };
  const commitTrim = async (range: TrimRange) => {
    try {
      const baseline = freezeStudioTrim(current.current.project.takes, range.takeId);
      await editTakes(takes => {
        if (!canContinueStudioTrim(baseline, takes, range.takeId)) throw new Error('A montagem mudou durante o corte. Selecione o take e tente novamente.');
        return takes.map(take => {
          if (take.id !== range.takeId) return take;
          if (![range.start, range.end].every(Number.isFinite) || range.start < 0 || range.end > take.duration + 0.05 || range.end - range.start < 0.1 - 1e-6) throw new Error('Revise os limites do corte. Cada trecho precisa ter pelo menos 0,1 segundo.');
          return { ...take, start: range.start, end: range.end };
        });
      });
    } catch (error) { Alert.alert('Editar montagem', error instanceof Error ? error.message : 'Não foi possível cortar este take.');
    } finally { trimPreviewSource.current = null; if (mounted.current) setTrimDraft(null); }
  };
  const split = async () => {
    if (!activeTake) return;
    const location = locateStudioTime(project.takes, playbackRef.current.position);
    if (!location) return;
    const leftId = Crypto.randomUUID(); const rightId = Crypto.randomUUID();
    const saved = await editTakes(takes => splitStudioTake(takes, location.takeId, location.sourceSeconds, leftId, rightId));
    if (saved && mounted.current) { setActiveTakeId(rightId); setSelectedTakeId(rightId); }
  };
  const move = async (id: string, direction: -1 | 1) => editTakes(takes => {
    const index = takes.findIndex(take => take.id === id);
    if (index < 0 || index + direction < 0 || index + direction >= takes.length) return [...takes];
    return moveStudioTake(takes, id, direction < 0 ? takes[index - 1].id : takes[index + 2]?.id || null);
  });
  const duplicate = async () => {
    if (!activeTake) return;
    const id = Crypto.randomUUID(); const sourceId = activeTake.id;
    const saved = await editTakes(takes => duplicateStudioTake(takes, sourceId, id));
    if (saved && mounted.current) { setActiveTakeId(id); setSelectedTakeId(id); }
  };
  const deleteTake = () => {
    if (!activeTake || busy || locked) return;
    const id = activeTake.id;
    Alert.alert('Remover este take?', 'Ele sairá da montagem. O arquivo original continua preservado.', [
      { text: 'Cancelar', style: 'cancel' }, { text: 'Remover', style: 'destructive', onPress: () => { void editTakes(takes => removeStudioTake(takes, id)); } },
    ]);
  };
  const canSplit = !locked && !!activeTake && playback.takeId === activeTake.id && playback.sourcePosition > activeTake.start + 0.1 - 1e-6 && playback.sourcePosition < activeTake.end - 0.1 + 1e-6;
  const closePanel = () => { if (!busy) setPanel(null); };
  return <View style={[styles.screen, !fullscreen && { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }]}>
    <StatusBar hidden={focused && fullscreen} style="light" />
    {!fullscreen && <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar aos projetos" disabled={busy || !!trimDraft} onPress={() => { void navigate('back'); }} style={styles.iconButton}><X size={24} color={colors.text} strokeWidth={1.7} /></Pressable>
      <View style={{ flex: 1, gap: 2 }}><Pressable accessibilityRole="button" accessibilityLabel="Editar título e roteiro do projeto" onPress={() => openPanel('preparation')} style={styles.projectTitle}><Text numberOfLines={1} style={styles.title}>{fields.title || (project.kind === 'aula' ? 'Nova aula' : project.kind === 'short' ? 'Novo short' : 'Novo podcast')}</Text><Pencil size={12} color={colors.muted} strokeWidth={1.5} /></Pressable>
        <StudioSaveStatus saving={saving || busy} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} />
      </View>
      {!!project.pendingTakes?.length && <Pressable accessibilityRole="button" accessibilityLabel="Recuperar arquivos pendentes" onPress={() => openPanel('recovery')} style={styles.iconButton}><Text style={{ color: colors.accent }}>{project.pendingTakes.length}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={locked ? 'Acompanhar publicação' : 'Revisar publicação'} disabled={busy || transient || !!trimDraft} onPress={() => { void navigate('review'); }} style={[styles.review, (busy || transient || !!trimDraft) && { opacity: 0.5 }]}><Text style={styles.reviewText}>{locked ? 'Publicação' : 'Revisar'}</Text><ChevronRight size={16} color={colors.text} /></Pressable>
    </View>}
    <View style={fullscreen ? StyleSheet.absoluteFillObject : styles.previewStage} onLayout={event => { setStageSize(event.nativeEvent.layout); }}>
      <View style={fullscreen ? StyleSheet.absoluteFillObject : [styles.previewFrame, { width: previewWidth, height: previewHeight }, selectedTakeId && styles.selectedFrame]}>
        <StudioPreview ref={preview} takes={previewTakes} kind={project.kind} activeTakeId={activeTakeId} onActiveTakeChange={setActiveTakeId} onPlaybackState={receivePlayback}
          paused={!!panel || busy || !!trimDraft} onCanvasPress={() => preview.current?.togglePlayback()} canvasLabel={playback.playing ? 'Pausar prévia' : 'Reproduzir prévia'} />
      </View>
      {!fullscreen && <View style={styles.previewCaption}><Text style={styles.formatLabel}>{project.kind === 'aula' ? 'AULA · 16:9' : project.kind === 'short' ? 'SHORT · 9:16' : 'PODCAST'}{activeTake?.width && activeTake.height && Math.min(activeTake.width, activeTake.height) >= 2160 ? ' · 4K' : ''}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Prévia em tela inteira" disabled={busy || !!trimDraft} onPress={() => { preview.current?.pause(); setFullscreen(true); }} style={styles.smallIconButton}><Maximize2 size={17} color={colors.muted} strokeWidth={1.5} /></Pressable>
      </View>}
    </View>
    {!fullscreen ? <View style={styles.workspace}>
      <View style={styles.transport}>
        <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} disabled={!project.takes.length || !!panel || busy || playback.loading || !!trimDraft} onPress={() => preview.current?.togglePlayback()} style={styles.playButton}>
          {playback.loading ? <ActivityIndicator size="small" color={colors.muted} /> : playback.playing ? <Pause size={22} color={colors.text} fill={colors.text} strokeWidth={1.2} /> : <Play size={22} color={colors.text} fill={colors.text} strokeWidth={1.2} />}
        </Pressable>
        <View pointerEvents="none" style={styles.timeBlock}><Text style={styles.time}>{formatStudioEditorTime(playback.position)}</Text><Text style={styles.totalTime}>{formatStudioEditorTime(duration)}</Text></View>
        <View style={styles.historyButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Desfazer edição" disabled={!historyState.canUndo || busy || locked || !!trimDraft} onPress={() => { void editTakes('undo'); }} style={[styles.iconButton, (!historyState.canUndo || busy || locked || !!trimDraft) && styles.disabled]}><Undo2 size={23} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Refazer edição" disabled={!historyState.canRedo || busy || locked || !!trimDraft} onPress={() => { void editTakes('redo'); }} style={[styles.iconButton, (!historyState.canRedo || busy || locked || !!trimDraft) && styles.disabled]}><Redo2 size={23} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
        </View>
      </View>
      <StudioTimeline takes={project.takes} position={playback.position} activeTakeId={selectedTakeId} audio={project.kind === 'podcast'}
        locked={locked} busy={busy} onSelect={selectTake} onScrubStart={() => preview.current?.pause()} onSeek={seconds => preview.current?.seek(seconds)} onAppend={() => { void addMedia(); }}
        onTrimChange={previewTrim} onTrimCommit={commitTrim} onTrimCancel={() => { trimPreviewSource.current = null; setTrimDraft(null); }} />
      <View style={styles.selectionRow}><Text numberOfLines={1} style={styles.selectionLabel}>{selectedTakeId && activeTake ? `${activeTake.name || `Take ${activeIndex + 1}`} · ${formatStudioEditorTime(activeTake.end - activeTake.start)}` : `${project.takes.length} ${project.takes.length === 1 ? 'take' : 'takes'} · arraste para navegar`}</Text>
        <Text style={styles.editHint}>{selectedTakeId ? 'Arraste as bordas para cortar' : 'Toque em um take para editar'}</Text>
      </View>
      {orientationError ? <Text style={styles.warning}>{orientationError}</Text> : project.kind === 'short' && duration > 180 ? <Text style={styles.warning}>Ajuste a montagem para até 3 minutos.</Text> : locked ? <Text style={styles.locked}>{project.state === 'submitted' ? 'Enviado para curadoria' : 'Montagem em preparação · acompanhe na publicação'}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
        {selectedTakeId && activeTake ? <>
          <EditorTool label="Concluir" icon={<Check size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || !!trimDraft} onPress={() => { setSelectedTakeId(undefined); setOrganizing(false); }} />
          {organizing ? <>
            <EditorTool label="Para antes" icon={<ArrowUp size={22} color={colors.text} strokeWidth={1.5} style={{ transform: [{ rotate: '-90deg' }] }} />} disabled={busy || locked || !!trimDraft || activeIndex === 0} onPress={() => { void move(activeTake.id, -1); }} />
            <EditorTool label="Para depois" icon={<ArrowDown size={22} color={colors.text} strokeWidth={1.5} style={{ transform: [{ rotate: '-90deg' }] }} />} disabled={busy || locked || !!trimDraft || activeIndex === project.takes.length - 1} onPress={() => { void move(activeTake.id, 1); }} />
          </> : <>
            <EditorTool label="Dividir" icon={<Split size={22} color={colors.text} strokeWidth={1.5} />} disabled={!canSplit || busy || !!trimDraft} onPress={() => { void split(); }} />
            <EditorTool label="Duplicar" icon={<Copy size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || locked || !!trimDraft} onPress={() => { void duplicate(); }} />
          </>}
          <EditorTool label="Excluir" icon={<Trash2 size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || locked || !!trimDraft} onPress={deleteTake} />
          <EditorTool label={organizing ? 'Ferramentas' : 'Organizar'} icon={<Film size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || !!trimDraft} onPress={() => setOrganizing(value => !value)} />
        </> : <>
          <EditorTool label="Gravar" icon={project.kind === 'podcast' ? <Mic size={22} color={colors.text} strokeWidth={1.5} /> : <Video size={22} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !orientationReady} onPress={() => { void navigate('record'); }} />
          <EditorTool label="Importar" icon={<Upload size={22} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy} onPress={() => { void addMedia(); }} />
          <EditorTool label="Editar take" icon={<Scissors size={22} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !activeTake} onPress={() => { if (activeTake) selectTake(activeTake); }} />
          <EditorTool label="Organizar" icon={<Film size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || !activeTake} onPress={() => { if (activeTake) { selectTake(activeTake); setOrganizing(true); } }} />
          <EditorTool label="Roteiro" icon={<FileText size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy} onPress={() => openPanel('preparation')} />
        </>}
      </ScrollView>
    </View> : <View pointerEvents="box-none" style={[styles.fullscreenTools, { top: Math.max(insets.top, 12), right: Math.max(insets.right, 12) }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} onPress={() => preview.current?.togglePlayback()} style={styles.overlayButton}>{playback.playing ? <Pause size={20} color={colors.text} /> : <Play size={20} color={colors.text} />}</Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar às ferramentas do editor" onPress={() => { preview.current?.pause(); setFullscreen(false); }} style={styles.overlayButton}><Minimize2 size={20} color={colors.text} strokeWidth={1.5} /></Pressable>
    </View>}
    <SheetModal visible={!!panel} onRequestClose={closePanel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[sheetStyles.backdrop, { paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityLabel="Fechar painel do editor" style={{ flex: 1 }} onPress={closePanel} />
        <View style={[sheetStyles.surface, { paddingBottom: Math.max(insets.bottom, 12), maxHeight: maxSheetHeight }]}><View style={sheetStyles.handle} />
          <View onStartShouldSetResponder={() => true} style={[sheetStyles.header, sheetContentStyle, { flexShrink: 0 }]}><Text style={[studioStyles.sectionTitle, { flex: 1 }]}>{panel === 'preparation' ? 'Sua ideia' : 'Recuperar arquivos'}</Text><SheetCloseButton onPress={closePanel} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={[sheetContentStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 18 }}>
            {panel === 'preparation' ? <>
              <StudioField label="Título do projeto" value={fields.title} onChangeText={value => setField('title', value)} placeholder="Dê um nome à sua ideia" maxLength={180} editable={!locked} />
              <StudioField label="Objetivo do aprendizado" value={fields.objective} onChangeText={value => setField('objective', value)} placeholder="O que a pessoa vai conseguir fazer?" multiline maxLength={1000} editable={!locked} />
              <StudioField label="Para quem você está ensinando?" value={fields.audience} onChangeText={value => setField('audience', value)} placeholder="Descreva seu público" maxLength={500} editable={!locked} />
              <StudioField label="Guia de gravação" value={fields.script} onChangeText={value => setField('script', value)} placeholder={'Abertura\n\nExplicação e demonstração\n\nAplicação prática'} multiline style={{ minHeight: 180 }} hint="Seu guia pode acompanhar você no teleprompter." editable={!locked} />
              <StudioSaveStatus saving={saving} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} />
            </> : panel === 'recovery' ? <><Text style={studioStyles.body}>{project.pendingTakes?.length || 0} arquivo(s) aguardando recuperação.</Text><StudioButton label="Tentar recuperar" loading={busy} disabled={locked} onPress={() => { void recoverTakes(); }} /><StudioButton label="Retirar pendentes" secondary disabled={locked || busy} onPress={discardPending} /></> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </SheetModal>
  </View>;
}
function EditorTool({ label, icon, onPress, disabled }: { label: string; icon: ReactNode; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tool, disabled && { opacity: 0.3 }, pressed && { opacity: 0.65 }]}>{icon}<Text style={styles.toolLabel}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0E11' },
  header: { height: 62, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  iconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  smallIconButton: { width: 36, height: 30, alignItems: 'center', justifyContent: 'center' },
  overlayButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
  projectTitle: { flexDirection: 'row', gap: 7, alignItems: 'center', minHeight: 25 },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flexShrink: 1 },
  review: { minHeight: 42, borderRadius: 12, paddingHorizontal: 13, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewText: { fontSize: 13, fontWeight: '600', color: colors.text },
  previewStage: { flex: 1, minHeight: 160, alignItems: 'center', justifyContent: 'center', paddingBottom: 30 },
  previewFrame: { overflow: 'hidden', borderRadius: 5, backgroundColor: '#000000', borderWidth: 1, borderColor: '#000000' },
  selectedFrame: { borderColor: colors.accent },
  previewCaption: { position: 'absolute', bottom: 0, left: 20, right: 12, height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  formatLabel: { fontSize: 9, color: colors.mutedDim, letterSpacing: 1.2, fontWeight: '600' },
  workspace: { paddingTop: 4, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' },
  transport: { height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  timeBlock: { position: 'absolute', left: '50%', transform: [{ translateX: -44 }], width: 88, alignItems: 'center', gap: 3 },
  time: { color: colors.text, fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  totalTime: { color: colors.mutedDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  playButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  historyButtons: { marginLeft: 'auto', flexDirection: 'row', gap: 2 },
  selectionRow: { minHeight: 40, paddingHorizontal: 18, paddingVertical: 7, gap: 4 },
  selectionLabel: { color: colors.textSecondary, fontSize: 11 },
  editHint: { color: colors.mutedDim, fontSize: 10 },
  toolbar: { flexGrow: 1, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8, paddingTop: 8 },
  tool: { width: 68, height: 60, alignItems: 'center', justifyContent: 'center', gap: 7 },
  toolLabel: { fontSize: 10, color: colors.textSecondary },
  disabled: { opacity: 0.25 },
  warning: { color: colors.accent, fontSize: 11, lineHeight: 16, paddingHorizontal: 18, paddingBottom: 4 },
  locked: { color: colors.muted, fontSize: 11, paddingHorizontal: 18, paddingBottom: 4 },
  fullscreenTools: { position: 'absolute', flexDirection: 'row', gap: 8 },
});
