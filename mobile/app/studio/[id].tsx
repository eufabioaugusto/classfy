import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, Check, ChevronRight, Copy, ImagePlus, Layers, Music, Captions, SlidersHorizontal, Type, FileText, Film, Maximize2, Mic, Minimize2, Pause, Pencil, Play, Scissors, Redo2, Split, Trash2, Undo2, Upload, Video, X } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { importStudioMedia, importStudioLayer, importStudioCaptionFile, recoverPendingStudioTakes } from '@/features/studio/media';
import { discardTransientStudioProject, getStudioProject, isTransientStudioProject, mutateStudioProject } from '@/features/studio/store';
import { duplicateStudioTake, locateStudioTime, moveStudioTake, removeStudioTake, splitStudioTake } from '@/features/studio/timeline';
import { addStudioLayerItem, compileStudioRecipe, createStudioTextItem, deriveStudioTakes, moveStudioLayerItemToLane, patchStudioClipGrade, patchStudioLayerItem, removeStudioLayerItem, studioEditing, studioSeconds, studioTicks, withStudioStandardOutput, formatStudioEditorTime, timelineDuration, type StudioEditing, type StudioProject, type StudioTake } from '@/features/studio/model';
import { StudioPreview, type StudioPlaybackState, type StudioPreviewHandle } from '@/features/studio/StudioPreview';
import { StudioCompositionPreview } from '@/features/studio/StudioCompositionPreview';
import { StudioCanvasEditor, type StudioCanvasTransform } from '@/features/studio/StudioCanvasEditor';
import { mergeStudioCanvasDraft, patchStudioCanvasTransform } from '@/features/studio/canvasEditing';
import { applyStudioLayerTimelineRange, freezeStudioLayerTimeline, type StudioLayerTimelineRange } from '@/features/studio/layerTimelineInteraction';
import { StudioLayerPanel, type StudioTextEditRequest } from '@/features/studio/StudioLayerPanel';
import { StudioTreatmentPanel } from '@/features/studio/StudioTreatmentPanel';
import { addStudioCaptionCues, studioTranscriptCues } from '@/features/studio/captions';
import { isStudioCompositionAvailable, getStudioTranscriptionCapabilitiesAsync, installStudioTranscriptionModelAsync, transcribeStudioAsync, cancelStudioTranscriptionAsync } from '../../modules/classfy-studio-media';
import { StudioTimeline } from '@/features/studio/StudioTimeline';
import { createStudioEditingHistory } from '@/features/studio/editingHistory';
import { captureStudioPlaybackAnchor, restoreStudioPlaybackAnchor, type StudioPlaybackAnchor } from '@/features/studio/editorInteraction';
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
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const [treating, setTreating] = useState(false);
  const [editingPreview, setEditingPreview] = useState<StudioEditing>();
  const editingPreviewRef = useRef(editingPreview); editingPreviewRef.current = editingPreview;
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const canvasGesture = useRef(false);
  const [layerInteracting, setLayerInteracting] = useState(false);
  const layerGesture = useRef(false);
  const [editTextRequest, setEditTextRequest] = useState<StudioTextEditRequest>();
  const textEditSequence = useRef(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const canvasDraft = useRef<{ id: string; base: StudioEditing; previous?: StudioEditing } | undefined>(undefined);
  const layerTrimDraft = useRef<{ id: string; base: StudioEditing; previous?: StudioEditing } | undefined>(undefined);
  const pendingLayerMove = useRef<{ id: string; targetZIndex: number } | undefined>(undefined);
  const [before, setBefore] = useState(false);
  const [captionProgress, setCaptionProgress] = useState<string>();
  const captionRequest = useRef<{ id: string; cancelled: boolean } | undefined>(undefined);
  useEffect(() => () => { if (captionRequest.current) { captionRequest.current.cancelled = true; void cancelStudioTranscriptionAsync(captionRequest.current.id); } }, []);
  const editing = studioEditing(project);
  const visibleEditing = editingPreview || editing;
  const previewProject = editingPreview ? { ...project, editing: editingPreview, takes: deriveStudioTakes(editingPreview) } : project;
  const recipe = useMemo(() => compileStudioRecipe(previewProject), [project.editing, project.kind, project.takes, editingPreview]);
  const timelineRecipe = useMemo(() => compileStudioRecipe(project), [project.editing, project.kind, project.takes]);
  const layerItem = visibleEditing.layers.flatMap(layer => layer.items).find(item => item.id === selectedLayerId);
  const advanced = isStudioCompositionAvailable() && project.kind !== 'podcast';
  const [organizing, setOrganizing] = useState(false);
  const [trimDraft, setTrimDraft] = useState<TrimRange | null>(null);
  const [trimCancelEpoch, setTrimCancelEpoch] = useState(0);
  const trimAnchor = useRef<StudioPlaybackAnchor | null>(null);
  const pendingRestore = useRef<{ anchor: StudioPlaybackAnchor | null; revision: number } | null>(null);
  const [restoreSequence, setRestoreSequence] = useState(0);
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
    // A durable edit may publish its new takes before its promise settles.
    // Removing/splitting the playing ID makes the native preview temporarily
    // fall back to the first clip; retain the cursor until its anchor is restored.
    const anchor = playbackRef.current;
    const next = working.current || pendingRestore.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current
      ? { ...state, position: anchor.position, sourcePosition: anchor.sourcePosition, takeId: anchor.takeId } : state;
    playbackRef.current = next;
    setPlayback(previous => previous.position === next.position && previous.sourcePosition === next.sourcePosition && previous.playing === next.playing && previous.loading === next.loading && previous.takeId === next.takeId ? previous : next);
  }, []);
  const activeTake = project.takes.find(take => take.id === (selectedTakeId || activeTakeId)) || project.takes[0];
  const activeIndex = project.takes.findIndex(take => take.id === activeTake?.id);
  const duration = studioSeconds(recipe.durationTicks);
  const previewAspect = project.kind === 'podcast' ? 1 : recipe.output.width / recipe.output.height;
  const previewWidth = Math.max(1, Math.min(stageSize.width - 24, (stageSize.height - 42) * previewAspect));
  const previewHeight = previewWidth / previewAspect;
  const locked = ['preparing', 'uploading', 'processing', 'submitted'].includes(project.state);
  const transient = isTransientStudioProject(project.ownerId, project.id);
  const maxSheetHeight = Math.max(1, height - insets.top - 12);
  const sheetContentWidth = landscape ? Math.min(width - insets.left - insets.right, maxSheetHeight * 16 / 9) : undefined;
  const sheetContentStyle = { width: '100%' as const, maxWidth: sheetContentWidth, alignSelf: 'center' as const };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!working.current && !pendingRestore.current && !project.takes.some(take => take.id === activeTakeId)) setActiveTakeId(project.takes[0]?.id);
  }, [project.takes, activeTakeId, busy]);
  useEffect(() => {
    if (selectedTakeId && !project.takes.some(take => take.id === selectedTakeId)) { setSelectedTakeId(undefined); setOrganizing(false); }
  }, [project.takes, selectedTakeId]);
  useEffect(() => {
    const owner = current.current.owner || '';
    setHistoryState(history.sync(owner === project.ownerId ? getStudioProject(owner, project.id) || null : null, owner));
  }, [history, project, user?.id]);
  useEffect(() => { if (focused) allowRemoval.current = false; else setEditTextRequest(undefined); }, [focused]);
  useEffect(() => { navigation.setOptions({ gestureEnabled: !busy && !trimDraft && !saving && !editingPreview && !canvasInteracting && !layerInteracting }); }, [navigation, busy, trimDraft, saving, editingPreview, canvasInteracting, layerInteracting]);
  usePreventRemove(busy || !!trimDraft || saving || !!saveError || !!editingPreview || canvasInteracting || layerInteracting, ({ data }) => {
    if (allowRemoval.current) { navigation.dispatch(data.action); return; }
    // A take write must settle before leaving; an unfinished drag is discarded.
    if (working.current || leaving.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    if (trimDraft) { cancelTrim(); return; }
    leaving.current = true;
    void (async () => {
      if (!await applyVisibleEditing() || !startWork()) return;
      await flush();
      assertOwner();
      if (!mounted.current) return;
      await discardTransientStudioProject(project.ownerId, project.id);
      // Discarding an empty session can unmount this editor by design.
      allowRemoval.current = true; navigation.dispatch(data.action);
    })().catch(() => {
      // Metadata retains its pending patch and exposes the existing retry.
    }).finally(() => { leaving.current = false; finishWork(); });
  });
  useEffect(() => {
    const pending = pendingRestore.current;
    if (!pending || project.revision < pending.revision || user?.id !== project.ownerId) return;
    pendingRestore.current = null;
    const restored = restoreStudioPlaybackAnchor(project.takes, pending.anchor);
    if (restored) preview.current?.seek(restored.position, restored.source);
    else {
      if (!project.takes.some(take => take.id === activeTakeId)) setActiveTakeId(project.takes[0]?.id);
      if (!project.takes.length) {
        const empty: StudioPlaybackState = { position: 0, sourcePosition: 0, playing: false, loading: false };
        playbackRef.current = empty; setPlayback(empty);
      }
    }
  }, [project.takes, project.revision, project.ownerId, user?.id, activeTakeId, restoreSequence]);
  const assertOwner = () => { if (current.current.owner !== project.ownerId) throw new Error('Abra este projeto na conta que o criou.'); };
  const startWork = () => {
    if (working.current) return false;
    allowRemoval.current = false;
    working.current = true; setBusy(true); preview.current?.pause(); return true;
  };
  const finishWork = () => { working.current = false; if (mounted.current) setBusy(false); };
  const editTakes = async (change: ((takes: readonly StudioTake[]) => StudioTake[]) | 'undo' | 'redo') => {
    if (locked || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current || !startWork()) return;
    const anchor = trimAnchor.current || captureStudioPlaybackAnchor(current.current.project.takes, playbackRef.current);
    let operation: ReturnType<typeof history.beginEdit> = null;
    try {
      await flush(); assertOwner();
      const saved = await mutateStudioProject(project.ownerId, project.id, latest => {
        assertOwner();
        operation = change === 'undo' ? history.beginUndo(latest) : change === 'redo' ? history.beginRedo(latest) : history.beginEdit(latest, change(latest.takes));
        return operation?.editing ? { editing: operation.editing } : { takes: operation ? operation.takes : [...latest.takes] };
      });
      if (operation) history.commit(operation, saved);
      if (mounted.current) {
        setHistoryState(history.state());
        pendingRestore.current = { anchor, revision: saved.revision };
        setRestoreSequence(value => value + 1);
      }
      return saved;
    } catch (error) {
      if (operation) history.abort(operation);
      if (mounted.current) setHistoryState(history.state());
      Alert.alert('Editar montagem', error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.');
    } finally { finishWork(); }
  };
  const editEditing = async (change: (editing: StudioEditing) => StudioEditing) => {
    if (locked || !startWork()) return;
    const laneIntent = pendingLayerMove.current;
    const anchor = captureStudioPlaybackAnchor(current.current.project.takes, playbackRef.current);
    let operation: ReturnType<typeof history.beginEditing> = null;
    try {
      await flush(); assertOwner();
      const saved = await mutateStudioProject(project.ownerId, project.id, latest => {
        assertOwner();
        let next = change(studioEditing(latest));
        // A failed vertical move stays recoverable when the next action is
        // Confirm, trim or a canvas transform. Merge only its lane intent.
        if (laneIntent && next.layers.some(layer => layer.items.some(item => item.id === laneIntent.id))) {
          next = moveStudioLayerItemToLane(next, laneIntent.id, laneIntent.targetZIndex);
        }
        operation = history.beginEditing(latest, next);
        return operation?.editing ? { editing: operation.editing } : {};
      });
      if (operation) history.commit(operation, saved);
      if (pendingLayerMove.current === laneIntent) pendingLayerMove.current = undefined;
      if (mounted.current) {
        setEditingPreview(undefined); editingPreviewRef.current = undefined; setBefore(false); setHistoryState(history.state());
        pendingRestore.current = { anchor, revision: saved.revision }; setRestoreSequence(value => value + 1);
      }
      return saved;
    } catch (error) {
      if (operation) history.abort(operation);
      Alert.alert('Editar camada', error instanceof Error ? error.message : 'Não foi possível salvar esta edição.');
      throw error;
    } finally { finishWork(); }
  };
  const standardProfile = async () => {
    if (editing.output.profile === 'standard') return true;
    const chosen = await new Promise<boolean>(resolve => Alert.alert('Perfil da edição', 'Camadas e tratamentos usam 1080p, 30 FPS e SDR nesta versão. Seus originais continuam na qualidade da captura.', [{ text: 'Manter perfil original', style: 'cancel', onPress: () => resolve(false) }, { text: 'Usar 1080p · 30 FPS', onPress: () => resolve(true) }], { cancelable: false }));
    if (chosen) {
      try { return (await editEditing(withStudioStandardOutput))?.editing?.output.profile === 'standard'; }
      catch { return false; }
    }
    return chosen;
  };
  const closeLayer = () => { pendingLayerMove.current = undefined; setEditTextRequest(undefined); setSelectedLayerId(undefined); setEditingPreview(undefined); editingPreviewRef.current = undefined; setBefore(false); setTreating(false); };
  const previewEditing = (value?: StudioEditing) => { editingPreviewRef.current = value; setEditingPreview(value); };
  const previewCanvas = (id: string, transform?: StudioCanvasTransform) => {
    if (working.current || locked) return;
    if (!transform) {
      const session = canvasDraft.current;
      if (session?.id === id) previewEditing(session.previous);
      canvasDraft.current = undefined; canvasGesture.current = false; setCanvasInteracting(false); return;
    }
    const session = canvasDraft.current?.id === id ? canvasDraft.current : {
      id, base: editingPreviewRef.current || studioEditing(current.current.project), previous: editingPreviewRef.current,
    };
    canvasDraft.current = session;
    previewEditing(patchStudioCanvasTransform(session.base, id, transform));
  };
  const commitCanvas = async (id: string, transform: StudioCanvasTransform) => {
    const session = canvasDraft.current?.id === id ? canvasDraft.current : { id, base: editingPreviewRef.current || studioEditing(current.current.project) };
    const draft = patchStudioCanvasTransform(session.base, id, transform);
    previewEditing(draft); canvasDraft.current = undefined; canvasGesture.current = false; setCanvasInteracting(false);
    try { await editEditing(latest => mergeStudioCanvasDraft(latest, draft, id)); }
    catch { previewEditing(draft); }
  };
  const mergeInlineDraft = (latest: StudioEditing, draft: StudioEditing) => {
    if (selectedLayerId) {
      const item = draft.layers.flatMap(layer => layer.items).find(item => item.id === selectedLayerId);
      if (!item || !latest.layers.some(layer => layer.items.some(candidate => candidate.id === selectedLayerId))) throw new Error('Esta camada não está mais na montagem.');
      return patchStudioLayerItem(latest, selectedLayerId, item);
    }
    if (treating && activeTake) {
      const clip = draft.main.find(item => item.id === activeTake.id);
      if (!clip?.grade || !latest.main.some(item => item.id === activeTake.id)) throw new Error('Este take não está mais na montagem.');
      return patchStudioClipGrade(latest, activeTake.id, clip.grade);
    }
    if (selectedTakeId) return mergeStudioCanvasDraft(latest, draft, selectedTakeId);
    throw new Error('Selecione novamente o item que deseja editar.');
  };
  const applyInlineDraft = async (draft: StudioEditing) => {
    const saved = await editEditing(latest => mergeInlineDraft(latest, draft));
    if (!saved) throw new Error('Aguarde a edição atual terminar.');
    if (mounted.current) closeLayer();
  };
  const applyVisibleEditing = async () => {
    const draft = editingPreviewRef.current;
    if (!draft) return true;
    try {
      await applyInlineDraft(draft);
      return true;
    } catch { return false; }
  };
  const selectLayer = (id: string, editText = false) => {
    if (working.current || trimDraft || canvasInteracting || layerGesture.current) return;
    preview.current?.pause();
    // The single/double tap recognizers may deliver callbacks in either order.
    // A same-target selection cannot erase the explicit request before focus.
    const requestTextEdit = () => {
      if (editText) setEditTextRequest({ id, sequence: ++textEditSequence.current });
      else setEditTextRequest(pending => pending?.id === id ? pending : undefined);
    };
    if (selectedLayerId === id && !treating) { requestTextEdit(); return; }
    const select = () => { setSelectedTakeId(undefined); setTreating(false); previewEditing(undefined); setSelectedLayerId(id); requestTextEdit(); };
    if (editingPreviewRef.current) { void applyVisibleEditing().then(saved => { if (saved && mounted.current) select(); }); }
    else select();
  };
  const previewLayerTrim = (id: string, range?: StudioLayerTimelineRange) => {
    if (working.current || locked) return;
    if (!range) {
      const session = layerTrimDraft.current;
      if (session?.id === id) previewEditing(session.previous);
      layerTrimDraft.current = undefined; return;
    }
    const session = layerTrimDraft.current?.id === id ? layerTrimDraft.current : {
      id, base: editingPreviewRef.current || studioEditing(current.current.project), previous: editingPreviewRef.current,
    };
    layerTrimDraft.current = session;
    previewEditing(applyStudioLayerTimelineRange(session.base, id, range));
  };
  const commitLayerTrim = async (id: string, range: StudioLayerTimelineRange) => {
    const session = layerTrimDraft.current?.id === id ? layerTrimDraft.current : { id, base: editingPreviewRef.current || studioEditing(current.current.project) };
    const draft = applyStudioLayerTimelineRange(session.base, id, range);
    previewEditing(draft); layerTrimDraft.current = undefined;
    try { await editEditing(latest => mergeStudioCanvasDraft(latest, draft, id)); }
    catch { previewEditing(draft); throw new Error('A duração ainda não foi salva. Tente novamente.'); }
  };
  const moveLayer = async (id: string, delta: number, targetZIndex?: number) => {
    const base = editingPreviewRef.current || studioEditing(current.current.project);
    const ordered = targetZIndex === undefined ? base : moveStudioLayerItemToLane(base, id, targetZIndex);
    const frozen = freezeStudioLayerTimeline(ordered, id);
    const draft = applyStudioLayerTimelineRange(ordered, id, {
      startSeconds: frozen.startSeconds + delta, endSeconds: frozen.endSeconds + delta,
    }, 'move');
    if (targetZIndex !== undefined) pendingLayerMove.current = { id, targetZIndex };
    previewEditing(draft);
    try { await editEditing(latest => {
      const orderedLatest = targetZIndex === undefined ? latest : moveStudioLayerItemToLane(latest, id, targetZIndex);
      return mergeStudioCanvasDraft(orderedLatest, draft, id);
    }); }
    catch { previewEditing(draft); throw new Error('A posição na timeline ainda não foi salva. Tente novamente.'); }
  };
  const addLayer = async (kind: 'text' | 'caption' | 'image' | 'video' | 'audio') => {
    if (!advanced || working.current || busy || locked || canvasGesture.current || layerGesture.current || !project.takes.length || !await applyVisibleEditing() || !await standardProfile()) return;
    const latest = current.current.project;
    const location = locateStudioTime(latest.takes, playbackRef.current.position);
    if (!location) return;
    const ticks = studioTicks(playbackRef.current.position);
    const durationTicks = studioTicks(Math.max(0.1, Math.min(3, location.take.end - location.sourceSeconds)));
    const id = Crypto.randomUUID();
    let ownsWork = false;
    try {
      if (kind === 'text' || kind === 'caption') {
        const item = createStudioTextItem({ id, kind, content: kind === 'caption' ? 'Sua legenda' : 'Seu título', atTicks: ticks, durationTicks });
        item.anchor = { clipId: location.takeId, offsetTicks: studioTicks(location.sourceSeconds - location.take.start) };
        await editEditing(value => addStudioLayerItem(value, item, `layer:item:${id}`)); selectLayer(id); return;
      }
      if (!startWork()) return;
      ownsWork = true;
      await flush(); assertOwner();
      const anchor = captureStudioPlaybackAnchor(latest.takes, playbackRef.current);
      const item = { id, kind, atTicks: ticks, durationTicks: kind === 'audio' ? studioTicks(Math.max(0.1, duration - playbackRef.current.position)) : durationTicks,
        ...(kind === 'audio' ? { gain: 0.25, fadeInTicks: Math.min(studioTicks(0.5), Math.floor(durationTicks / 2)), fadeOutTicks: Math.min(studioTicks(0.5), Math.floor(durationTicks / 2)) } : { rect: { x: 0.64, y: 0.06, width: 0.3, height: 0.3 }, anchor: { clipId: location.takeId, offsetTicks: studioTicks(location.sourceSeconds - location.take.start) } }) };
      const saved = await importStudioLayer(getStudioProject(project.ownerId, project.id) || latest, kind, item);
      if (saved && mounted.current) {
        setSelectedLayerId(id); setSelectedTakeId(undefined); setEditTextRequest(undefined); setTreating(false);
        pendingRestore.current = { anchor, revision: saved.revision }; setRestoreSequence(value => value + 1);
      }
    } catch (error) { Alert.alert('Adicionar camada', error instanceof Error ? error.message : 'Não foi possível importar.'); }
    finally { if (ownsWork) finishWork(); }
  };
  const captionFile = async () => {
    if (!advanced || busy || locked || !activeTake || !await standardProfile()) return;
    try {
      const cues = await importStudioCaptionFile(current.current.project, activeTake.duration);
      if (cues) await editEditing(value => addStudioCaptionCues(value, activeTake.id, cues, Crypto.randomUUID));
    } catch (error) { Alert.alert('Importar legendas', error instanceof Error ? error.message : 'Não foi possível importar.'); }
  };
  const generateCaptions = async () => {
    if (!advanced || !activeTake || busy || locked || !await standardProfile() || !startWork()) return;
    const take = activeTake; const request = { id: Crypto.randomUUID(), cancelled: false }; captionRequest.current = request;
    try {
      await flush(); assertOwner();
      const capabilities = await getStudioTranscriptionCapabilitiesAsync();
      if (!capabilities.available) throw new Error(capabilities.reason || 'A transcrição local não está disponível neste aparelho.');
      setCaptionProgress(capabilities.requiresModelDownload ? 'Preparando o modelo de português…' : 'Gerando legendas neste aparelho…');
      const reportProgress = (stage: string, progress: number) => {
        if (mounted.current && !request.cancelled && captionRequest.current === request) setCaptionProgress(`${stage === 'model' ? 'Baixando modelo de português' : 'Gerando legendas'} · ${Math.round(progress * 100)}%`);
      };
      if (capabilities.requiresModelDownload) await installStudioTranscriptionModelAsync(request.id, reportProgress);
      assertOwner(); if (request.cancelled || !mounted.current || captionRequest.current !== request) return;
      const result = await transcribeStudioAsync(request.id, take.uri, reportProgress);
      assertOwner(); if (request.cancelled || !mounted.current || captionRequest.current !== request) return;
      const cues = studioTranscriptCues(result.segments, take.duration);
      if (!cues.length) throw new Error('Não encontramos fala neste take. Você pode adicionar uma legenda manual.');
      finishWork();
      await editEditing(value => addStudioCaptionCues(value, take.id, cues, Crypto.randomUUID));
      Alert.alert('Legendas prontas', 'Revise o texto e os tempos nas camadas de legenda.');
    } catch (error) { if (!request.cancelled && mounted.current) Alert.alert('Gerar legendas', error instanceof Error ? error.message : 'Não foi possível transcrever este take.'); }
    finally { if (captionRequest.current === request) { captionRequest.current = undefined; if (mounted.current) setCaptionProgress(undefined); if (working.current) finishWork(); } }
  };
  const openTreatment = async () => {
    if (!activeTake || !advanced || busy || locked || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current || !await applyVisibleEditing() || !await standardProfile()) return;
    preview.current?.pause(); setSelectedTakeId(activeTake.id); closeLayer(); setTreating(true);
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
    if (working.current || leaving.current || trimDraft || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current || (destination === 'record' && locked)) return;
    if (!await applyVisibleEditing()) return;
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
    if (working.current || trimDraft || canvasInteracting || layerTrimDraft.current || layerGesture.current) return;
    preview.current?.pause();
    const select = () => { closeLayer(); setSelectedTakeId(take.id); };
    if (editingPreviewRef.current) void applyVisibleEditing().then(saved => { if (saved && mounted.current) select(); });
    else select();
  };
  const selectMainCanvas = (id: string) => {
    if (working.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    const take = current.current.project.takes.find(item => item.id === id);
    if (!take) return;
    if (studioEditing(current.current.project).output.profile === 'standard') { selectTake(take); return; }
    void (async () => { if (await applyVisibleEditing() && await standardProfile() && mounted.current) selectTake(take); })();
  };
  const editCanvasElement = (id: string) => {
    if (working.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    const item = (editingPreviewRef.current || studioEditing(current.current.project)).layers.flatMap(layer => layer.items).find(item => item.id === id);
    if (!item) { selectMainCanvas(id); return; }
    selectLayer(id, !!item.text);
  };
  const openPanel = (next: Panel) => {
    if (working.current || trimDraft || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    preview.current?.pause(); setPanel(next);
  };
  const previewTrim = (range: TrimRange) => {
    if (working.current || locked) return;
    const latest = current.current.project;
    const take = latest.takes.find(item => item.id === range.takeId);
    if (!take || current.current.owner !== latest.ownerId) return;
    if (!trimAnchor.current) {
      trimAnchor.current = captureStudioPlaybackAnchor(latest.takes, playbackRef.current);
      preview.current?.pause();
    }
    setSelectedTakeId(range.takeId);
    setTrimDraft(range);
    preview.current?.previewSourceFrame({ takeId: take.id, uri: take.uri, seconds: range.previewSourceSeconds ?? range.start });
  };
  const cancelTrim = () => {
    if (working.current) return;
    setTrimCancelEpoch(value => value + 1);
    const anchor = trimAnchor.current;
    trimAnchor.current = null; setTrimDraft(null);
    const restored = restoreStudioPlaybackAnchor(current.current.project.takes, anchor);
    if (restored && current.current.owner === project.ownerId) preview.current?.seek(restored.position, restored.source);
  };
  const commitTrim = async (range: TrimRange) => {
    let saved: StudioProject | undefined;
    try {
      const baseline = freezeStudioTrim(current.current.project.takes, range.takeId);
      saved = await editTakes(takes => {
        if (!canContinueStudioTrim(baseline, takes, range.takeId)) throw new Error('A montagem mudou durante o corte. Selecione o take e tente novamente.');
        return takes.map(take => {
          if (take.id !== range.takeId) return take;
          if (![range.start, range.end].every(Number.isFinite) || range.start < 0 || range.end > take.duration + 0.05 || range.end - range.start < 0.1 - 1e-6) throw new Error('Revise os limites do corte. Cada trecho precisa ter pelo menos 0,1 segundo.');
          return { ...take, start: range.start, end: range.end };
        });
      });
    } catch (error) { Alert.alert('Editar montagem', error instanceof Error ? error.message : 'Não foi possível cortar este take.');
    } finally {
      const anchor = trimAnchor.current;
      trimAnchor.current = null;
      if (mounted.current) {
        setTrimDraft(null);
        // On failure the saved montage is unchanged; restore the same anchor.
        if (!saved) {
          const restored = restoreStudioPlaybackAnchor(current.current.project.takes, anchor);
          if (restored && current.current.owner === project.ownerId) preview.current?.seek(restored.position, restored.source);
        }
      }
    }
  };
  const split = async () => {
    if (!activeTake) return;
    const location = locateStudioTime(project.takes, playbackRef.current.position);
    if (!location) return;
    const leftId = Crypto.randomUUID(); const rightId = Crypto.randomUUID();
    const saved = await editTakes(takes => splitStudioTake(takes, location.takeId, location.sourceSeconds, leftId, rightId));
    if (saved && mounted.current) setSelectedTakeId(rightId);
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
    if (saved && mounted.current) setSelectedTakeId(id);
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
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={!fullscreen} style={[styles.screen, !fullscreen && { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 8) }]}>
    <StatusBar hidden={focused && fullscreen} style="light" />
    {!fullscreen && <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar aos projetos" disabled={busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void navigate('back'); }} style={styles.iconButton}><X size={24} color={colors.text} strokeWidth={1.7} /></Pressable>
      <View style={{ flex: 1, gap: 2 }}><Pressable accessibilityRole="button" accessibilityLabel="Editar título e roteiro do projeto" onPress={() => openPanel('preparation')} style={styles.projectTitle}><Text numberOfLines={1} style={styles.title}>{fields.title || (project.kind === 'aula' ? 'Nova aula' : project.kind === 'short' ? 'Novo short' : 'Novo podcast')}</Text><Pencil size={12} color={colors.muted} strokeWidth={1.5} /></Pressable>
        <StudioSaveStatus saving={saving || busy} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} />
      </View>
      {!!project.pendingTakes?.length && <Pressable accessibilityRole="button" accessibilityLabel="Recuperar arquivos pendentes" onPress={() => openPanel('recovery')} style={styles.iconButton}><Text style={{ color: colors.accent }}>{project.pendingTakes.length}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={locked ? 'Acompanhar publicação' : 'Revisar publicação'} disabled={busy || canvasInteracting || layerInteracting || transient || !!trimDraft} onPress={() => { void navigate('review'); }} style={[styles.review, (busy || canvasInteracting || layerInteracting || transient || !!trimDraft) && { opacity: 0.5 }]}><Text style={styles.reviewText}>{locked ? 'Publicação' : 'Revisar'}</Text><ChevronRight size={16} color={colors.text} /></Pressable>
    </View>}
    <View style={fullscreen ? StyleSheet.absoluteFillObject : styles.previewStage} onLayout={event => { setStageSize(event.nativeEvent.layout); }}>
      <View style={fullscreen ? StyleSheet.absoluteFillObject : [styles.previewFrame, { width: previewWidth, height: previewHeight }, selectedTakeId && styles.selectedFrame]}>
        <StudioCompositionPreview ref={preview} project={previewProject} recipe={recipe} before={before} activeTakeId={activeTakeId} onActiveTakeChange={setActiveTakeId} onPlaybackState={receivePlayback}
          paused={!!panel || busy || !!trimDraft || canvasInteracting || layerInteracting} onCanvasPress={() => {
            if (!fullscreen && (selectedLayerId || selectedTakeId)) {
              void applyVisibleEditing().then(saved => { if (saved && mounted.current) { closeLayer(); setSelectedTakeId(undefined); } });
            } else preview.current?.togglePlayback();
          }} canvasLabel={playback.playing ? 'Pausar prévia' : 'Reproduzir prévia'} />
        {!fullscreen && advanced && <StudioCanvasEditor editing={visibleEditing} recipe={recipe} positionSeconds={playback.position} selectedLayerId={selectedLayerId} selectedMainClipId={selectedTakeId}
          disabled={!focused || busy || locked || !!panel || !!trimDraft || layerInteracting || treating}
          onSelectLayer={selectLayer} onSelectMainClip={selectMainCanvas} onCanvasPress={() => preview.current?.togglePlayback()} onPreviewRect={previewCanvas} onCommitRect={commitCanvas} onEditText={editCanvasElement}
          onInteractionStart={() => { canvasGesture.current = true; preview.current?.pause(); setCanvasInteracting(true); }} onInteractionEnd={() => { canvasGesture.current = false; setCanvasInteracting(false); }} />}
      </View>
      {!fullscreen && <View style={styles.previewCaption}><Text style={styles.formatLabel}>{project.kind === 'aula' ? 'AULA · 16:9' : project.kind === 'short' ? 'SHORT · 9:16' : 'PODCAST'}{editing.output.profile === 'standard' ? ' · 1080p · 30 FPS · SDR' : activeTake?.width && activeTake.height && Math.min(activeTake.width, activeTake.height) >= 2160 ? ' · ORIGINAL 4K' : ' · ORIGINAL'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Prévia em tela inteira" disabled={busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { preview.current?.pause(); setFullscreen(true); }} style={styles.smallIconButton}><Maximize2 size={17} color={colors.muted} strokeWidth={1.5} /></Pressable>
      </View>}
    </View>
    {!fullscreen ? <View style={styles.workspace}>
      {!keyboardVisible && <View style={styles.transport}>
        <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} disabled={!project.takes.length || !!panel || busy || playback.loading || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => preview.current?.togglePlayback()} style={styles.playButton}>
          {playback.loading ? <ActivityIndicator size="small" color={colors.muted} /> : playback.playing ? <Pause size={22} color={colors.text} fill={colors.text} strokeWidth={1.2} /> : <Play size={22} color={colors.text} fill={colors.text} strokeWidth={1.2} />}
        </Pressable>
        <View pointerEvents="none" style={styles.timeBlock}><Text style={styles.time}>{formatStudioEditorTime(playback.position)}</Text><Text style={styles.totalTime}>{formatStudioEditorTime(duration)}</Text></View>
        <View style={styles.historyButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Desfazer edição" disabled={!historyState.canUndo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft} onPress={() => { closeLayer(); void editTakes('undo'); }} style={[styles.iconButton, (!historyState.canUndo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft) && styles.disabled]}><Undo2 size={23} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Refazer edição" disabled={!historyState.canRedo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft} onPress={() => { closeLayer(); void editTakes('redo'); }} style={[styles.iconButton, (!historyState.canRedo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft) && styles.disabled]}><Redo2 size={23} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
        </View>
      </View>}
      {!keyboardVisible && <StudioTimeline editing={editing} layers={timelineRecipe.clips.filter(clip => clip.zIndex > 0)} selectedLayerId={selectedLayerId} onSelectLayer={selectLayer} onMoveLayer={moveLayer} onEditLayer={editCanvasElement} onLayerTrimPreview={previewLayerTrim} onLayerTrimCommit={commitLayerTrim} onLayerInteractionStart={() => { layerGesture.current = true; preview.current?.pause(); setLayerInteracting(true); }} onLayerInteractionEnd={() => { layerGesture.current = false; setLayerInteracting(false); }} takes={project.takes} position={playback.position} activeTakeId={selectedTakeId} audio={project.kind === 'podcast'}
        cancelEpoch={trimCancelEpoch}
        locked={locked} busy={!focused || busy || canvasInteracting} onSelect={selectTake} onScrubStart={() => preview.current?.pause()} onSeek={seconds => preview.current?.seek(seconds)} onAppend={() => { void addMedia(); }}
        onTrimChange={previewTrim} onTrimCommit={commitTrim} onTrimCancel={cancelTrim} />}
      {captionProgress && <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 }}><Text style={{ flex: 1, color: colors.muted, fontSize: 11 }}>{captionProgress}</Text><Pressable accessibilityLabel="Cancelar transcrição" onPress={() => { const request = captionRequest.current; if (request) { request.cancelled = true; setCaptionProgress('Cancelando…'); void cancelStudioTranscriptionAsync(request.id); } }} style={styles.iconButton}><X size={18} color={colors.text} /></Pressable></View>}
      {layerItem ? <StudioLayerPanel key={layerItem.id} editing={visibleEditing} item={layerItem} canvasEditing editTextRequest={editTextRequest} onTextEditConsumed={request => setEditTextRequest(pending => pending?.id === request.id && pending.sequence === request.sequence ? undefined : pending)} disabled={busy || locked || canvasInteracting || layerInteracting || !focused} onPreview={previewEditing} onApply={applyInlineDraft} onRemove={() => { void editEditing(value => removeStudioLayerItem(value, layerItem.id)).then(saved => { if (saved) closeLayer(); }).catch(() => {}); }} onClose={closeLayer} /> : treating && activeTake ? <StudioTreatmentPanel key={activeTake.id} editing={editing} targetId={activeTake.id} disabled={busy || locked} onPreview={previewEditing} onBefore={setBefore} onApply={applyInlineDraft} onClose={closeLayer} /> : null}
      {!layerItem && !treating && <View style={styles.selectionRow}><Text numberOfLines={1} style={styles.selectionLabel}>{selectedTakeId && activeTake ? `${activeTake.name || `Take ${activeIndex + 1}`} · ${formatStudioEditorTime(activeTake.end - activeTake.start)}` : `${project.takes.length} ${project.takes.length === 1 ? 'take' : 'takes'} · arraste para navegar`}</Text>
        <Text style={styles.editHint}>{selectedTakeId ? 'Arraste as bordas para cortar · segure o vídeo para mover · pinça para redimensionar' : 'Toque em um take ou em um elemento do vídeo para editar'}</Text>
      </View>}
      {orientationError ? <Text style={styles.warning}>{orientationError}</Text> : project.kind === 'short' && duration > 180 ? <Text style={styles.warning}>Ajuste a montagem para até 3 minutos.</Text> : locked ? <Text style={styles.locked}>{project.state === 'submitted' ? 'Enviado para curadoria' : 'Montagem em preparação · acompanhe na publicação'}</Text> : null}
      {!layerItem && !treating && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
        {selectedTakeId && activeTake ? <>
          <EditorTool label="Concluir" icon={<Check size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void applyVisibleEditing().then(saved => { if (saved && mounted.current) { setSelectedTakeId(undefined); setOrganizing(false); } }); }} />
          {organizing ? <>
            <EditorTool label="Para antes" icon={<ArrowUp size={22} color={colors.text} strokeWidth={1.5} style={{ transform: [{ rotate: '-90deg' }] }} />} disabled={busy || canvasInteracting || layerInteracting || locked || !!trimDraft || activeIndex === 0} onPress={() => { void move(activeTake.id, -1); }} />
            <EditorTool label="Para depois" icon={<ArrowDown size={22} color={colors.text} strokeWidth={1.5} style={{ transform: [{ rotate: '-90deg' }] }} />} disabled={busy || canvasInteracting || layerInteracting || locked || !!trimDraft || activeIndex === project.takes.length - 1} onPress={() => { void move(activeTake.id, 1); }} />
          </> : <>
            <EditorTool label="Dividir" icon={<Split size={22} color={colors.text} strokeWidth={1.5} />} disabled={!canSplit || busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void split(); }} />
            <EditorTool label="Duplicar" icon={<Copy size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || locked || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void duplicate(); }} />
          </>}
          <EditorTool label="Imagem" icon={<SlidersHorizontal size={22} color={colors.text} />} disabled={!advanced || busy || canvasInteracting || layerInteracting || locked || !!trimDraft} onPress={() => { void openTreatment(); }} />
          <EditorTool label="Excluir" icon={<Trash2 size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || locked || canvasInteracting || layerInteracting || !!trimDraft} onPress={deleteTake} />
          <EditorTool label={organizing ? 'Ferramentas' : 'Organizar'} icon={<Film size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => setOrganizing(value => !value)} />
        </> : <>
          <EditorTool label="Gravar" icon={project.kind === 'podcast' ? <Mic size={22} color={colors.text} strokeWidth={1.5} /> : <Video size={22} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !orientationReady} onPress={() => { void navigate('record'); }} />
          <EditorTool label="Importar" icon={<Upload size={22} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy} onPress={() => { void addMedia(); }} />
          <EditorTool label="Editar take" icon={<Scissors size={22} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !activeTake} onPress={() => { if (activeTake) selectTake(activeTake); }} />
          <EditorTool label="Organizar" icon={<Film size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy || !activeTake} onPress={() => { if (activeTake) { selectTake(activeTake); setOrganizing(true); } }} />
          <EditorTool label="Texto" icon={<Type size={22} color={colors.text} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => { void addLayer('text'); }} />
          <EditorTool label="Camada" icon={<Layers size={22} color={colors.text} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => Alert.alert('Adicionar camada', undefined, [{ text: 'Imagem', onPress: () => { void addLayer('image'); } }, { text: 'Vídeo sobreposto', onPress: () => { void addLayer('video'); } }, { text: 'Cancelar', style: 'cancel' }])} />
          <EditorTool label="Áudio" icon={<Music size={22} color={colors.text} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => { void addLayer('audio'); }} />
          <EditorTool label="Legendas" icon={<Captions size={22} color={colors.text} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => Alert.alert('Legendas', 'Transcrição local em português. A primeira utilização pode baixar o modelo do iOS. Revise as legendas antes de publicar.', [{ text: 'Gerar no aparelho', onPress: () => { void generateCaptions(); } }, { text: 'Legenda manual', onPress: () => { void addLayer('caption'); } }, { text: 'Importar SRT/VTT', onPress: () => { void captionFile(); } }, { text: 'Cancelar', style: 'cancel' }])} />
          <EditorTool label="Imagem" icon={<SlidersHorizontal size={22} color={colors.text} />} disabled={!advanced || busy || locked || !activeTake} onPress={() => { void openTreatment(); }} />
          <EditorTool label="Roteiro" icon={<FileText size={22} color={colors.text} strokeWidth={1.5} />} disabled={busy} onPress={() => openPanel('preparation')} />
        </>}
      </ScrollView>}
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
  </KeyboardAvoidingView>;
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
