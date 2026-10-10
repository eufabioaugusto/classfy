import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, useNavigation, usePreventRemove } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useSharedValue } from 'react-native-reanimated';
import * as Crypto from 'expo-crypto';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, Blend, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Copy, ImagePlus, Layers, Music, Captions, SlidersHorizontal, Type, FileText, Film, Maximize2, Mic, Minimize2, Pause, Pencil, Play, Scissors, Redo2, Split, Gauge, FlipHorizontal2, Sparkles, Volume2, Trash2, Undo2, Upload, Video, X } from 'lucide-react-native';
import { AppScreen } from '@/components/AppScreen';
import { NavigationHeader } from '@/components/NavigationHeader';
import { SheetCloseButton, SheetModal, sheetStyles } from '@/components/SheetModal';
import { useAuth } from '@/features/auth/authContext';
import { colors } from '@/theme/colors';
import { useStudioProject } from '@/features/studio/useStudioProjects';
import { useStudioOrientation } from '@/features/studio/useStudioOrientation';
import { importStudioMedia, importStudioLayer, importStudioCaptionFile, recoverPendingStudioTakes } from '@/features/studio/media';
import { discardTransientStudioProject, getStudioProject, isTransientStudioProject, mutateStudioProject } from '@/features/studio/store';
import { canSplitStudioTake, duplicateStudioTake, locateStudioTime, moveStudioTake, removeStudioTake, splitStudioTake } from '@/features/studio/timeline';
import { addStudioLayerItem, compileStudioRecipe, createStudioTextItem, deriveStudioTakes, moveStudioLayerItemToLane, patchStudioClipGrade, patchStudioClipProperties, setStudioClipPlaybackRate, studioPlaybackRate, patchStudioLayerItem, removeStudioLayerItem, setStudioLayerHidden, setStudioLayerMuted, setStudioMainMuted, studioEditing, studioSeconds, studioTicks, withStudioStandardOutput, formatStudioEditorTime, timelineDuration, type StudioEditing, type StudioProject, type StudioTake } from '@/features/studio/model';
import { StudioPreview, type StudioPlaybackState, type StudioPreviewHandle } from '@/features/studio/StudioPreview';
import { StudioCompositionPreview } from '@/features/studio/StudioCompositionPreview';
import { StudioCanvasEditor, type StudioCanvasTransform } from '@/features/studio/StudioCanvasEditor';
import { initialStudioCanvasTransformChannel } from '@/features/studio/canvasTransformChannel';
import { mergeStudioCanvasDraft, patchStudioCanvasTransform } from '@/features/studio/canvasEditing';
import { applyStudioLayerTimelineRange, freezeStudioLayerTimeline, type StudioLayerTimelineRange } from '@/features/studio/layerTimelineInteraction';
import { StudioLayerPanel, type StudioTextEditRequest } from '@/features/studio/StudioLayerPanel';
import { StudioVoiceoverPanel } from '@/features/studio/StudioVoiceoverPanel';
import { StudioClipPanel, type StudioClipPanelMode } from '@/features/studio/StudioClipPanel';
import { StudioTreatmentPanel } from '@/features/studio/StudioTreatmentPanel';
import { addStudioCaptionCues, studioTranscriptCues } from '@/features/studio/captions';
import { isStudioCompositionAvailable, isStudioEditorToolsAvailable, isStudioFilterPreviewAvailable, getMediaInfoAsync, getStudioTranscriptionCapabilitiesAsync, installStudioTranscriptionModelAsync, transcribeStudioAsync, cancelStudioTranscriptionAsync } from '../../modules/classfy-studio-media';
import { canSplitStudioLayer, duplicateStudioLayer, splitStudioLayer, extractStudioClipAudio } from '@/features/studio/layerActions';
import { StudioTimeline } from '@/features/studio/StudioTimeline';
import type { StudioTimelinePlaybackChannel } from '@/features/studio/timelinePlaybackChannel';
import { createStudioEditingHistory } from '@/features/studio/editingHistory';
import { captureStudioPlaybackAnchor, restoreStudioPlaybackAnchor, type StudioPlaybackAnchor } from '@/features/studio/editorInteraction';
import { canContinueStudioTrim, freezeStudioTrim } from '@/features/studio/timelineLayout';
import { StudioAccess, StudioButton, StudioField, StudioLoading, StudioSaveStatus, studioStyles, useStudioFields } from '@/features/studio/StudioUI';
import { studioEffectiveOutput, studioOutputLabel, studioOutputSupported, studioOutputWarnings, withStudioOutputSelection, type StudioOutputSelection } from '@/features/studio/model';
import { getStudioExportCapabilitiesAsync, type StudioExportCapabilities } from '../../modules/classfy-studio-media';

export default function StudioProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, loading, error, update } = useStudioProject(Array.isArray(id) ? id[0] : id || '');
  return <StudioAccess>{loading ? <AppScreen scroll={false} edgeToEdge header={<NavigationHeader title="Seu projeto" back />}><StudioLoading /></AppScreen> : !project ?
    <AppScreen header={<NavigationHeader title="Seu projeto" back />}><View style={studioStyles.empty}><Text style={studioStyles.sectionTitle}>Projeto indisponível</Text><Text style={studioStyles.body}>{error || 'Este projeto não foi encontrado nesta conta e neste aparelho.'}</Text></View></AppScreen> : <ProjectEditor key={project.id} project={project} update={update} />}
  </StudioAccess>;
}

type Panel = 'preparation' | 'recovery' | 'append' | 'media' | 'captions' | 'output' | null;
type TrimRange = { takeId: string; start: number; end: number; previewSourceSeconds?: number };
type EditorEntry = { ownerId: string; projectId: string; focusEpoch: number; identityEpoch: number; selectionEpoch: number; targetId?: string; anchor: StudioPlaybackAnchor | null; draft?: StudioEditing; allowLocked: boolean; errorReported?: boolean };
class EditorEntryCancelled extends Error {}
function ProjectEditor({ project, update }: { project: StudioProject; update: (id: string, patch: Partial<StudioProject>) => Promise<StudioProject> }) {
  const router = useRouter();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const focusRef = useRef(focused);
  const focusEpoch = useRef(0);
  if (focusRef.current !== focused) { focusEpoch.current += 1; focusRef.current = focused; }
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const landscape = width > height;
  const [fullscreen, setFullscreen] = useState(false);
  const { orientationReady, orientationError } = useStudioOrientation(project.kind, true, fullscreen ? 'preview' : 'editor');
  const { user } = useAuth();
  const current = useRef({ project, owner: user?.id });
  const identityEpoch = useRef(0);
  if (current.current.owner !== user?.id || current.current.project.id !== project.id) identityEpoch.current += 1;
  current.current = { project, owner: user?.id };
  const { fields, setField, flush, saving, saveError } = useStudioFields(project, update, { preventNavigation: false });
  const [panel, setPanel] = useState<Panel>(null);
  const [outputCapabilities, setOutputCapabilities] = useState<StudioExportCapabilities>();
  useEffect(() => {
    let active = true;
    void getStudioExportCapabilitiesAsync().then(value => { if (active) setOutputCapabilities(value); });
    return () => { active = false; };
  }, []);
  const [selectedTakeId, setSelectedTakeId] = useState<string>();
  const [selectedLayerId, setSelectedLayerId] = useState<string>();
  const selectionEpoch = useRef(0);
  const [treating, setTreating] = useState(false);
  const [clipTool, setClipTool] = useState<StudioClipPanelMode>();
  const toolsEnabled = isStudioEditorToolsAvailable();
  const [voiceover, setVoiceover] = useState(false);
  const [voiceoverRecording, setVoiceoverRecording] = useState(false);
  const voiceoverScope = useRef<{ owner: string; id: string; focus: number; identity: number; selection: number } | undefined>(undefined);
  const voiceoverHistory = useRef<ReturnType<ReturnType<typeof createStudioEditingHistory>['beginEditing']>>(null);
  const [treatmentTab, setTreatmentTab] = useState<'filters' | 'adjust'>('filters');
  const [editingPreview, setEditingPreview] = useState<StudioEditing>();
  const editingPreviewRef = useRef(editingPreview); editingPreviewRef.current = editingPreview;
  const [canvasInteracting, setCanvasInteracting] = useState(false);
  const canvasGesture = useRef(false);
  const [layerInteracting, setLayerInteracting] = useState(false);
  const layerGesture = useRef(false);
  const [editTextRequest, setEditTextRequest] = useState<StudioTextEditRequest>();
  const textEditSequence = useRef(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [layerPanelExpanded, setLayerPanelExpanded] = useState(false);
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
  const inlineDraftBaseline = useRef<{ key: string; editing: StudioEditing } | undefined>(undefined);
  const inlineDraftKey = selectedLayerId || selectedTakeId && (clipTool || treating)
    ? `${project.ownerId}:${project.id}:${selectedLayerId || selectedTakeId}:${clipTool || (treating ? 'treatment' : 'layer')}` : undefined;
  // A panel keeps its initial snapshot while the store publishes unrelated
  // changes. Comparing its draft with the latest document invents bulk edits.
  if (inlineDraftKey && inlineDraftBaseline.current?.key !== inlineDraftKey) inlineDraftBaseline.current = { key: inlineDraftKey, editing };
  if (!inlineDraftKey) inlineDraftBaseline.current = undefined;
  const effectiveOutput = studioEffectiveOutput(editing);
  const outputLabel = editing.output.profile === 'legacy-source' ? 'Original' : studioOutputLabel(editing).split(' · ')[0];
  // An older project has a fixed profile, not an implicit new Original choice.
  const outputSelection: StudioOutputSelection = editing.output.selection || {
    resolution: editing.output.profile === 'legacy-source' ? 'original' : Math.min(effectiveOutput.width, effectiveOutput.height) === 2160 ? '4k' : Math.min(effectiveOutput.width, effectiveOutput.height) === 1440 ? '2k' : 'hd',
    frameRate: editing.output.profile === 'legacy-source' ? 'original' : effectiveOutput.frameRateNumerator / effectiveOutput.frameRateDenominator === 24 ? 24 : effectiveOutput.frameRateNumerator / effectiveOutput.frameRateDenominator === 60 ? 60 : 30,
  };
  const visibleEditing = editingPreview || editing;
  const previewProject = editingPreview ? { ...project, editing: editingPreview, takes: deriveStudioTakes(editingPreview) } : project;
  const recipe = useMemo(() => compileStudioRecipe(previewProject), [project.editing, project.kind, project.takes, editingPreview]);
  const timelineRecipe = useMemo(() => compileStudioRecipe(project), [project.editing, project.kind, project.takes]);
  const timelineLayers = useMemo(() => timelineRecipe.clips.filter(clip => clip.zIndex > 0), [timelineRecipe]);
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
  const editorEntry = useRef<EditorEntry | null>(null);
  const allowRemoval = useRef(false);
  const leaving = useRef(false);
  const mounted = useRef(true);
  const preview = useRef<StudioPreviewHandle>(null);
  const playbackChannel = useSharedValue<StudioTimelinePlaybackChannel>({ active: false, sequence: 0, position: 0, playing: false, loading: false });
  const canvasTransformChannel = useSharedValue(initialStudioCanvasTransformChannel());
  const [playback, setPlayback] = useState<StudioPlaybackState>({ position: 0, sourcePosition: 0, playing: false, loading: false });
  const playbackRef = useRef(playback); playbackRef.current = playback;
  const receivePlayback = useCallback((state: StudioPlaybackState) => {
    // A durable edit may publish its new takes before its promise settles.
    // Removing/splitting the playing ID makes the native preview temporarily
    // fall back to the first clip; retain the cursor until its anchor is restored.
    const anchor = playbackRef.current;
    const next = working.current || pendingRestore.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current
      ? { ...state, playing: false, position: anchor.position, sourcePosition: anchor.sourcePosition, takeId: anchor.takeId } : state;
    playbackRef.current = next;
    setPlayback(previous => previous.position === next.position && previous.sourcePosition === next.sourcePosition && previous.playing === next.playing && previous.loading === next.loading && previous.takeId === next.takeId ? previous : next);
  }, []);
  const activeTake = project.takes.find(take => take.id === (selectedTakeId || activeTakeId)) || project.takes[0];
  const activeIndex = project.takes.findIndex(take => take.id === activeTake?.id);
  const duration = studioSeconds(recipe.durationTicks);
  const previewAspect = project.kind === 'podcast' ? 1 : recipe.output.width / recipe.output.height;
  const previewWidth = Math.max(1, Math.min(stageSize.width - 24, (stageSize.height - 16) * previewAspect));
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
  useEffect(() => {
    if (focused) allowRemoval.current = false;
    else {
      setEditTextRequest(undefined);
      if (captionRequest.current) { captionRequest.current.cancelled = true; void cancelStudioTranscriptionAsync(captionRequest.current.id); }
    }
  }, [focused]);
  useEffect(() => { navigation.setOptions({ gestureEnabled: !voiceover && !busy && !trimDraft && !saving && !editingPreview && !canvasInteracting && !layerInteracting }); }, [navigation, voiceover, busy, trimDraft, saving, editingPreview, canvasInteracting, layerInteracting]);
  usePreventRemove(voiceover || busy || !!trimDraft || saving || !!saveError || !!editingPreview || canvasInteracting || layerInteracting, ({ data }) => {
    if (allowRemoval.current) { navigation.dispatch(data.action); return; }
    // A take write must settle before leaving; an unfinished drag is discarded.
    if (voiceover || working.current || leaving.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    if (trimDraft) { cancelTrim(); return; }
    void navigate('back', data.action);
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
  const entryCurrent = (entry: EditorEntry, requireMounted = true) => editorEntry.current === entry && working.current
    && (!requireMounted || mounted.current) && focusRef.current && focusEpoch.current === entry.focusEpoch
    && identityEpoch.current === entry.identityEpoch
    && selectionEpoch.current === entry.selectionEpoch
    && current.current.owner === entry.ownerId && current.current.project.id === entry.projectId;
  const entryProject = (entry: EditorEntry) => getStudioProject(entry.ownerId, entry.projectId) || current.current.project;
  const assertEntry = (entry: EditorEntry) => {
    if (!entryCurrent(entry)) throw new EditorEntryCancelled();
    const latest = entryProject(entry);
    if (!entry.allowLocked && ['preparing', 'uploading', 'processing', 'submitted'].includes(latest.state)) throw new EditorEntryCancelled();
    const value = studioEditing(latest);
    if (entry.targetId && !value.main.some(item => item.id === entry.targetId) && !value.layers.some(layer => layer.items.some(item => item.id === entry.targetId))) throw new EditorEntryCancelled();
    return latest;
  };
  const reserveEntry = (targetId?: string, allowLocked = false) => {
    if (voiceover || !mounted.current || !focusRef.current || current.current.owner !== project.ownerId || working.current || leaving.current || trimDraft || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current || (!allowLocked && locked)) return null;
    const entry: EditorEntry = { ownerId: project.ownerId, projectId: project.id, focusEpoch: focusEpoch.current, identityEpoch: identityEpoch.current, selectionEpoch: selectionEpoch.current, targetId,
      anchor: captureStudioPlaybackAnchor(current.current.project.takes, playbackRef.current), draft: editingPreviewRef.current, allowLocked };
    if (!startWork()) return null;
    editorEntry.current = entry;
    return entry;
  };
  const releaseEntry = (entry: EditorEntry) => { if (editorEntry.current === entry) { editorEntry.current = null; finishWork(); } };
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
  const editEditing = async (change: (editing: StudioEditing) => StudioEditing, { restoreCursor = true, entry }: { restoreCursor?: boolean; entry?: EditorEntry } = {}) => {
    if (locked || (entry ? !entryCurrent(entry) : !startWork())) return;
    const laneIntent = pendingLayerMove.current;
    const anchor = captureStudioPlaybackAnchor(current.current.project.takes, playbackRef.current);
    let operation: ReturnType<typeof history.beginEditing> = null;
    try {
      await flush(); assertOwner();
      if (entry) assertEntry(entry);
      const saved = await mutateStudioProject(project.ownerId, project.id, latest => {
        assertOwner();
        if (entry) assertEntry(entry);
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
        setEditingPreview(undefined); editingPreviewRef.current = undefined; inlineDraftBaseline.current = undefined; setBefore(false); setHistoryState(history.state());
        // Visibility and mute keep every interval/source in place. The native
        // preview already holds this cursor; seeking it again invalidates the
        // newly prepared frame. Structural edits still restore their anchor.
        if (restoreCursor && (!entry || entryCurrent(entry))) { pendingRestore.current = { anchor, revision: saved.revision }; setRestoreSequence(value => value + 1); }
      }
      return saved;
    } catch (error) {
      if (operation) history.abort(operation);
      if (!(error instanceof EditorEntryCancelled) && (!entry || entryCurrent(entry))) {
        Alert.alert('Editar camada', error instanceof Error ? error.message : 'Não foi possível salvar esta edição.');
        if (entry) entry.errorReported = true;
      }
      throw error;
    } finally { if (!entry) finishWork(); }
  };
  const standardProfile = async (entry?: EditorEntry) => {
    const existing = studioEditing(entry ? assertEntry(entry) : current.current.project);
    if (existing.output.profile === 'standard') return true;
    let next = withStudioStandardOutput(existing);
    let fallback = false;
    const capabilities = await getStudioExportCapabilitiesAsync();
    if (entry) assertEntry(entry);
    if (!studioOutputSupported(studioEffectiveOutput(next), capabilities)) {
      const accepted = await new Promise<boolean>(resolve => Alert.alert('Atualização do editor necessária',
        'O Classfy Dev instalado exporta esta montagem em HD e 30 FPS. Para manter a qualidade original com camadas, será preciso instalar o motor atualizado. Você também pode escolher HD e 30 FPS; os originais serão preservados.',
        [{ text: 'Manter original', style: 'cancel', onPress: () => resolve(false) }, { text: 'Escolher HD · 30 FPS', onPress: () => resolve(true) }], { cancelable: false }));
      if (entry) assertEntry(entry);
      if (!accepted) return false;
      fallback = true;
      next = withStudioOutputSelection(existing, { resolution: 'hd', frameRate: 30 });
    } else {
      const warnings = studioOutputWarnings(next).filter(warning => warning.code === 'sdr-conversion');
      if (warnings.length && !await new Promise<boolean>(resolve => Alert.alert('Tratamento em SDR', warnings.map(warning => warning.message).join('\n\n'),
        [{ text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) }, { text: 'Continuar', onPress: () => resolve(true) }], { cancelable: false }))) return false;
      if (entry) assertEntry(entry);
    }
    const confirmedWarnings = studioOutputWarnings(next);
    try { return (await editEditing(latest => {
      const resolved = fallback ? withStudioOutputSelection(latest, { resolution: 'hd', frameRate: 30 }) : withStudioStandardOutput(latest);
      if (!studioOutputSupported(studioEffectiveOutput(resolved), capabilities) || JSON.stringify(resolved.output) !== JSON.stringify(next.output)
        || JSON.stringify(studioOutputWarnings(resolved)) !== JSON.stringify(confirmedWarnings)) throw new Error('A qualidade dos originais mudou. Abra novamente esta ferramenta para confirmar a saída.');
      return resolved;
    }, { entry, restoreCursor: !entry }))?.editing?.output.profile === 'standard'; }
    catch { return false; }
  };
  const chooseOutput = async (selection: StudioOutputSelection) => {
    const entry = reserveEntry();
    if (!entry) return;
    try {
      const next = withStudioOutputSelection(studioEditing(assertEntry(entry)), selection);
      const capabilities = await getStudioExportCapabilitiesAsync();
      assertEntry(entry);
      if (!studioOutputSupported(studioEffectiveOutput(next), capabilities)) {
        Alert.alert('Atualização do editor necessária', 'Esta qualidade requer o novo motor de exportação do Classfy Dev. Instale a versão atualizada para usá-la; o projeto e os originais continuam preservados.');
        return;
      }
      const warnings = studioOutputWarnings(next);
      if (warnings.length) {
        const accepted = await new Promise<boolean>(resolve => Alert.alert('Converter a qualidade?', warnings.map(warning => warning.message).join('\n\n'),
          [{ text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) }, { text: 'Usar esta qualidade', onPress: () => resolve(true) }], { cancelable: false }));
        assertEntry(entry);
        if (!accepted) return;
      }
      await editEditing(latest => {
        const resolved = withStudioOutputSelection(latest, selection);
        if (!studioOutputSupported(studioEffectiveOutput(resolved), capabilities) || JSON.stringify(resolved.output) !== JSON.stringify(next.output)
          || JSON.stringify(studioOutputWarnings(resolved)) !== JSON.stringify(warnings)) throw new Error('A qualidade dos originais mudou. Escolha a saída novamente para confirmar a conversão.');
        return resolved;
      }, { entry });
    } catch (cause) {
      if (!(cause instanceof EditorEntryCancelled) && !entry.errorReported && entryCurrent(entry)) Alert.alert('Qualidade de saída', cause instanceof Error ? cause.message : 'Não foi possível salvar a qualidade.');
    } finally { releaseEntry(entry); }
  };
  const closeLayer = () => { selectionEpoch.current += 1; inlineDraftBaseline.current = undefined; setLayerPanelExpanded(false); setClipTool(undefined); pendingLayerMove.current = undefined; setEditTextRequest(undefined); setSelectedLayerId(undefined); setEditingPreview(undefined); editingPreviewRef.current = undefined; setBefore(false); setTreating(false); };
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
    try {
      const saved = await editEditing(latest => mergeStudioCanvasDraft(latest, draft, id));
      if (!saved) throw new Error('Aguarde a edição atual terminar.');
    } catch (error) { previewEditing(draft); throw error; }
  };
  const mergeInlineDraft = (latest: StudioEditing, draft: StudioEditing) => {
    if (selectedLayerId) {
      const item = draft.layers.flatMap(layer => layer.items).find(item => item.id === selectedLayerId);
      if (!item || !latest.layers.some(layer => layer.items.some(candidate => candidate.id === selectedLayerId))) throw new Error('Esta camada não está mais na montagem.');
      if (clipTool) {
        const actual = latest.layers.flatMap(layer => layer.items).find(value => value.id === selectedLayerId)!;
        if (actual.assetId !== item.assetId) throw new Error('Selecione novamente este clip.');
        // Retiming must resolve the host's current rate and source anchor, not
        // install the panel's earlier duration/anchor over the latest document.
        if (clipTool === 'speed') return setStudioClipPlaybackRate(latest, selectedLayerId, item.playbackRate ?? 1);
        if (clipTool === 'volume') return patchStudioClipProperties(latest, selectedLayerId, { gain: item.gain, fadeInTicks: item.fadeInTicks, fadeOutTicks: item.fadeOutTicks });
        if (clipTool === 'mirror') return patchStudioClipProperties(latest, selectedLayerId, { flipHorizontal: item.flipHorizontal, flipVertical: item.flipVertical, rotationDegrees: item.rotationDegrees });
        return patchStudioClipProperties(latest, selectedLayerId, { motion: item.motion });
      }
      let merged = patchStudioLayerItem(latest, selectedLayerId, item);
      if (item.text) {
        const original = inlineDraftBaseline.current?.editing || studioEditing(current.current.project), draftLane = draft.layers.find(lane => lane.items.some(value => value.id === selectedLayerId));
        for (const value of draftLane?.items || []) {
          if (value.id === selectedLayerId || value.kind !== item.kind || !value.text) continue;
          const previous = original.layers.flatMap(lane => lane.items).find(candidate => candidate.id === value.id);
          const actual = merged.layers.flatMap(lane => lane.items).find(candidate => candidate.id === value.id);
          if (actual?.text && previous?.text && JSON.stringify(value.text) !== JSON.stringify(previous.text)) merged = patchStudioLayerItem(merged, value.id, { text: { ...value.text, content: actual.text.content } });
        }
      }
      return merged;
    }
    if (treating && activeTake) {
      const clip = draft.main.find(item => item.id === activeTake.id);
      if (!clip?.grade || !latest.main.some(item => item.id === activeTake.id)) throw new Error('Este take não está mais na montagem.');
      return patchStudioClipGrade(latest, activeTake.id, clip.grade);
    }
    if (selectedTakeId && clipTool) {
      const original = inlineDraftBaseline.current?.editing || studioEditing(current.current.project), base = original.main.find(item => item.id === selectedTakeId), target = draft.main.find(item => item.id === selectedTakeId);
      if (!base || !target || target.assetId !== base.assetId) throw new Error('Selecione novamente este clip.');
      if (clipTool === 'volume') {
        let next = latest;
        for (const item of draft.main) {
          const previous = original.main.find(value => value.id === item.id);
          if (previous && (item.gain !== previous.gain || item.fadeInTicks !== previous.fadeInTicks || item.fadeOutTicks !== previous.fadeOutTicks)) next = patchStudioClipProperties(next, item.id, { gain: item.gain, fadeInTicks: item.fadeInTicks, fadeOutTicks: item.fadeOutTicks });
        }
        return next;
      }
      if (clipTool === 'speed') return setStudioClipPlaybackRate(latest, selectedTakeId, target.playbackRate ?? 1);
      if (clipTool === 'mirror') return patchStudioClipProperties(latest, selectedTakeId, { flipHorizontal: target.flipHorizontal, flipVertical: target.flipVertical, rotationDegrees: target.rotationDegrees });
      return patchStudioClipProperties(latest, selectedTakeId, { motion: target.motion });
    }
    if (selectedTakeId) return mergeStudioCanvasDraft(latest, draft, selectedTakeId);
    throw new Error('Selecione novamente o item que deseja editar.');
  };
  const toggleTrackControl = async (action: 'visibility' | 'mute' | 'main', zIndex = 0) => {
    if (!focusRef.current || locked || working.current || trimDraft || canvasGesture.current || layerTrimDraft.current || layerGesture.current || pendingRestore.current) return;
    // Resolve the persistent lane ID before the profile/save await. A reorder
    // must never redirect an already accepted button to another visual lane.
    const visible = editingPreviewRef.current || studioEditing(current.current.project);
    const lane = action === 'main' ? undefined : visible.layers[zIndex - 1];
    if (action !== 'main' && !lane) return;
    const enabled = action === 'main' ? !visible.mainMuted : action === 'visibility' ? !lane!.hidden : !lane!.muted;
    const entry = reserveEntry(selectedLayerId || selectedTakeId);
    if (!entry) return;
    try {
      if (!await standardProfile(entry)) return;
      assertEntry(entry);
      await editEditing(latest => {
        const merged = entry.draft ? mergeInlineDraft(latest, entry.draft) : latest;
        if (action === 'main') return setStudioMainMuted(merged, enabled);
        return action === 'visibility' ? setStudioLayerHidden(merged, lane!.id, enabled) : setStudioLayerMuted(merged, lane!.id, enabled);
      }, { entry, restoreCursor: false });
    } catch (error) { if (!(error instanceof EditorEntryCancelled)) throw error; }
    finally { releaseEntry(entry); }
  };
  const applyInlineDraft = async (draft: StudioEditing) => {
    const focusAtStart = focusEpoch.current, identityAtStart = identityEpoch.current;
    const saved = await editEditing(latest => mergeInlineDraft(latest, draft));
    if (!saved) throw new Error('Aguarde a edição atual terminar.');
    if (mounted.current && focusRef.current && focusAtStart === focusEpoch.current && identityAtStart === identityEpoch.current) closeLayer();
  };
  const applyVisibleEditing = async () => {
    const draft = editingPreviewRef.current;
    if (!draft) return true;
    try {
      await applyInlineDraft(draft);
      return true;
    } catch { return false; }
  };
  const prepareEntry = async (entry: EditorEntry, needsStandard = false) => {
    assertEntry(entry);
    if (entry.draft) {
      // A cancelled picker keeps the same selection. Only the accepted draft
      // is saved; a later target/focus cannot inherit this operation.
      const saved = await editEditing(latest => mergeInlineDraft(latest, entry.draft!), { entry, restoreCursor: false });
      if (!saved) throw new EditorEntryCancelled();
      assertEntry(entry);
    }
    if (needsStandard && !await standardProfile(entry)) return null;
    assertEntry(entry);
    await flush();
    return assertEntry(entry);
  };
  const pressEmptyCanvas = () => {
    if (voiceover || !focusRef.current || working.current || trimDraft || canvasGesture.current || layerGesture.current || layerTrimDraft.current || panel) return;
    if (fullscreen || (!selectedLayerId && !selectedTakeId)) { preview.current?.togglePlayback(); return; }
    if (!editingPreviewRef.current) { Keyboard.dismiss(); closeLayer(); setSelectedTakeId(undefined); setOrganizing(false); return; }
    const entry = reserveEntry(selectedLayerId || selectedTakeId);
    if (!entry) return;
    void prepareEntry(entry).then(saved => {
      if (saved && entryCurrent(entry)) { Keyboard.dismiss(); closeLayer(); setSelectedTakeId(undefined); setOrganizing(false); }
    }).catch(() => { /* Keep the draft/selection on a failed save or cancelled entry. */ }).finally(() => releaseEntry(entry));
  };
  const selectLayer = (id: string, editText = false) => {
    if (!focusRef.current || current.current.owner !== project.ownerId || working.current || trimDraft || canvasInteracting || layerGesture.current) return;
    preview.current?.pause();
    // The single/double tap recognizers may deliver callbacks in either order.
    // A same-target selection cannot erase the explicit request before focus.
    const requestTextEdit = () => {
      if (editText) setEditTextRequest({ id, sequence: ++textEditSequence.current });
      else setEditTextRequest(pending => pending?.id === id ? pending : undefined);
    };
    if (selectedLayerId === id && !treating) { requestTextEdit(); return; }
    const focusAtStart = focusEpoch.current, identityAtStart = identityEpoch.current;
    const select = () => { selectionEpoch.current += 1; setSelectedTakeId(undefined); setTreating(false); previewEditing(undefined); setSelectedLayerId(id); requestTextEdit(); };
    if (editingPreviewRef.current) { void applyVisibleEditing().then(saved => {
      const latest = getStudioProject(project.ownerId, project.id) || current.current.project;
      if (saved && mounted.current && focusRef.current && focusAtStart === focusEpoch.current && identityAtStart === identityEpoch.current && studioEditing(latest).layers.some(layer => layer.items.some(item => item.id === id))) select();
    }); }
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
    if (!advanced) return;
    const locationAtEntry = locateStudioTime(current.current.project.takes, playbackRef.current.position);
    if (!locationAtEntry) return;
    const entry = reserveEntry(locationAtEntry.takeId);
    if (!entry) return;
    try {
      const latest = await prepareEntry(entry, true);
      if (!latest) return;
      assertEntry(entry);
      const restored = restoreStudioPlaybackAnchor(latest.takes, entry.anchor);
      if (!restored) return;
      const location = locateStudioTime(latest.takes, restored.position);
      if (!location || location.takeId !== entry.targetId) return;
      const ticks = studioTicks(restored.position);
      const durationTicks = studioTicks(Math.max(0.1, Math.min(3, (location.take.end - location.sourceSeconds) / studioPlaybackRate(location.take.playbackRate))));
      const id = Crypto.randomUUID();
      if (kind === 'text' || kind === 'caption') {
        const item = createStudioTextItem({ id, kind, content: kind === 'caption' ? 'Sua legenda' : 'Seu título', atTicks: ticks, durationTicks });
        if (kind === 'text') item.rect = { x: 0.2, y: 0.44, width: 0.6, height: 0.16 };
        item.anchor = { clipId: location.takeId, offsetTicks: studioTicks((location.sourceSeconds - location.take.start) / studioPlaybackRate(location.take.playbackRate)) };
        const saved = await editEditing(value => addStudioLayerItem(value, item, `layer:item:${id}`), { entry, restoreCursor: false });
        if (saved && entryCurrent(entry)) { closeLayer(); setSelectedTakeId(undefined); setSelectedLayerId(id); }
        return;
      }
      const item = { id, kind, atTicks: ticks, durationTicks: kind === 'audio' ? studioTicks(Math.max(0.1, timelineDuration(latest.takes) - restored.position)) : durationTicks,
        ...(kind === 'audio' ? { gain: 0.25, fadeInTicks: Math.min(studioTicks(0.5), Math.floor(durationTicks / 2)), fadeOutTicks: Math.min(studioTicks(0.5), Math.floor(durationTicks / 2)) } : { rect: { x: 0.64, y: 0.06, width: 0.3, height: 0.3 }, anchor: { clipId: location.takeId, offsetTicks: studioTicks((location.sourceSeconds - location.take.start) / studioPlaybackRate(location.take.playbackRate)) } }) };
      assertEntry(entry);
      const saved = await importStudioLayer(latest, kind, item);
      if (saved && entryCurrent(entry)) {
        assertEntry(entry);
        setSelectedLayerId(id); setSelectedTakeId(undefined); setEditTextRequest(undefined); setTreating(false);
        pendingRestore.current = { anchor: entry.anchor, revision: saved.revision }; setRestoreSequence(value => value + 1);
      }
    } catch (error) { if (!(error instanceof EditorEntryCancelled) && !entry.errorReported && entryCurrent(entry)) Alert.alert('Adicionar camada', error instanceof Error ? error.message : 'Não foi possível importar.'); }
    finally { releaseEntry(entry); }
  };
  const captionFile = async () => {
    if (!advanced || !activeTake) return;
    const entry = reserveEntry(activeTake.id);
    if (!entry) return;
    try {
      const latest = await prepareEntry(entry, true);
      if (!latest) return;
      assertEntry(entry);
      const take = latest.takes.find(item => item.id === entry.targetId);
      if (!take) return;
      const cues = await importStudioCaptionFile(latest, take.duration);
      const currentProject = assertEntry(entry);
      if (cues && currentProject.takes.find(item => item.id === take.id)?.uri === take.uri) {
        await editEditing(value => addStudioCaptionCues(value, take.id, cues, Crypto.randomUUID), { entry, restoreCursor: false });
      }
    } catch (error) { if (!(error instanceof EditorEntryCancelled) && !entry.errorReported && entryCurrent(entry)) Alert.alert('Importar legendas', error instanceof Error ? error.message : 'Não foi possível importar.'); }
    finally { releaseEntry(entry); }
  };
  const generateCaptions = async () => {
    if (!advanced || !activeTake) return;
    const entry = reserveEntry(activeTake.id);
    if (!entry) return;
    const request = { id: Crypto.randomUUID(), cancelled: false }; captionRequest.current = request;
    try {
      const latest = await prepareEntry(entry, true);
      if (!latest) return;
      assertEntry(entry);
      const take = latest.takes.find(item => item.id === entry.targetId);
      if (!take) return;
      const capabilities = await getStudioTranscriptionCapabilitiesAsync();
      assertEntry(entry);
      if (!capabilities.available) throw new Error(capabilities.reason || 'A transcrição local não está disponível neste aparelho.');
      setCaptionProgress(capabilities.requiresModelDownload ? 'Preparando o modelo de português…' : 'Gerando legendas neste aparelho…');
      const reportProgress = (stage: string, progress: number) => {
        if (entryCurrent(entry) && !request.cancelled && captionRequest.current === request) setCaptionProgress(`${stage === 'model' ? 'Baixando modelo de português' : 'Gerando legendas'} · ${Math.round(progress * 100)}%`);
      };
      if (capabilities.requiresModelDownload) await installStudioTranscriptionModelAsync(request.id, reportProgress);
      assertEntry(entry); if (request.cancelled || captionRequest.current !== request) return;
      const result = await transcribeStudioAsync(request.id, take.uri, reportProgress);
      const currentProject = assertEntry(entry);
      if (request.cancelled || captionRequest.current !== request || currentProject.takes.find(item => item.id === take.id)?.uri !== take.uri) return;
      const cues = studioTranscriptCues(result.segments, take.duration);
      if (!cues.length) throw new Error('Não encontramos fala neste take. Você pode adicionar uma legenda manual.');
      await editEditing(value => addStudioCaptionCues(value, take.id, cues, Crypto.randomUUID), { entry, restoreCursor: false });
      if (entryCurrent(entry)) Alert.alert('Legendas prontas', 'Revise o texto e os tempos nas camadas de legenda.');
    } catch (error) { if (!(error instanceof EditorEntryCancelled) && !entry.errorReported && !request.cancelled && entryCurrent(entry)) Alert.alert('Gerar legendas', error instanceof Error ? error.message : 'Não foi possível transcrever este take.'); }
    finally { if (captionRequest.current === request) { captionRequest.current = undefined; if (mounted.current) setCaptionProgress(undefined); } releaseEntry(entry); }
  };
  const canSaveVoiceover = useCallback(() => {
    const scope = voiceoverScope.current, latest = current.current.project;
    return !!scope && mounted.current && focusRef.current && !working.current && !leaving.current
      && scope.focus === focusEpoch.current && scope.identity === identityEpoch.current && scope.selection === selectionEpoch.current
      && scope.owner === current.current.owner && scope.id === latest.id && scope.owner === latest.ownerId
      && !['preparing', 'uploading', 'processing', 'submitted'].includes(latest.state);
  }, []);
  const openVoiceover = async () => {
    if (!advanced || !project.takes.length) return;
    const entry = reserveEntry(selectedLayerId || selectedTakeId);
    if (!entry) return;
    try {
      if (!await prepareEntry(entry, true)) return;
      assertEntry(entry); closeLayer(); setSelectedTakeId(undefined); preview.current?.pause();
      voiceoverScope.current = { owner: entry.ownerId, id: entry.projectId, focus: focusEpoch.current, identity: identityEpoch.current, selection: selectionEpoch.current };
      setVoiceover(true);
    } catch (cause) { if (!(cause instanceof EditorEntryCancelled) && entryCurrent(entry) && !entry.errorReported) Alert.alert('Narração', cause instanceof Error ? cause.message : 'Não foi possível abrir o microfone.'); }
    finally { releaseEntry(entry); }
  };
  const receiveVoiceoverRecording = useCallback((active: boolean) => {
    setVoiceoverRecording(active);
    if (!active) preview.current?.pause();
  }, []);
  useEffect(() => {
    if (voiceoverRecording && canSaveVoiceover() && !playbackRef.current.playing) preview.current?.togglePlayback();
  }, [voiceoverRecording, canSaveVoiceover]);
  const closeVoiceover = () => { voiceoverScope.current = undefined; setVoiceover(false); };
  const openClipTool = async (mode: StudioClipPanelMode) => {
    const target = selectedLayerId || selectedTakeId || activeTake?.id;
    if (!target || !advanced) return;
    const entry = reserveEntry(target);
    if (!entry) return;
    try {
      const latest = await prepareEntry(entry, true);
      if (!latest) return;
      assertEntry(entry);
      const layer = studioEditing(latest).layers.some(lane => lane.items.some(item => item.id === target));
      closeLayer(); if (layer) setSelectedLayerId(target); else setSelectedTakeId(target);
      preview.current?.pause(); setClipTool(mode);
    } catch { /* Preserve the current draft if the entry cannot be opened. */ }
    finally { releaseEntry(entry); }
  };
  const extractAudio = async () => {
    const target = selectedLayerId || selectedTakeId || activeTake?.id;
    if (!target || !toolsEnabled || !advanced) return;
    const entry = reserveEntry(target);
    if (!entry) return;
    const audioId = Crypto.randomUUID(), confirmedAssetId = Crypto.randomUUID();
    try {
      const latest = await prepareEntry(entry, true);
      if (!latest) return;
      assertEntry(entry);
      const sourceEditing = studioEditing(latest), sourceClip = sourceEditing.main.find(item => item.id === target) || sourceEditing.layers.flatMap(lane => lane.items).find(item => item.id === target), asset = sourceEditing.assets.find(item => item.id === sourceClip?.assetId);
      if (!asset || asset.kind !== 'video') throw new Error('Selecione um vídeo para extrair o áudio.');
      const info = await getMediaInfoAsync(asset.uri); assertEntry(entry);
      if (!info.hasAudio) throw new Error('Este vídeo não tem uma faixa de áudio.');
      const saved = await editEditing(value => {
        if (value.assets.find(item => item.id === asset.id)?.uri !== asset.uri) throw new Error('O original mudou. Selecione este vídeo novamente.');
        return extractStudioClipAudio(value, target, audioId, undefined, asset.hasAudio === true ? undefined : { ...asset, id: confirmedAssetId, hasAudio: true });
      }, { entry, restoreCursor: false });
      if (saved && entryCurrent(entry)) { closeLayer(); setSelectedTakeId(undefined); setSelectedLayerId(audioId); }
    } catch (cause) { if (!(cause instanceof EditorEntryCancelled) && entryCurrent(entry)) Alert.alert('Extrair áudio', cause instanceof Error ? cause.message : 'Não foi possível extrair este áudio.'); }
    finally { releaseEntry(entry); }
  };
  const openTreatment = async (tab: 'filters' | 'adjust' = 'filters') => {
    if (!activeTake || !advanced) return;
    const entry = reserveEntry(activeTake.id);
    if (!entry) return;
    try {
      if (!await prepareEntry(entry, true)) return;
      assertEntry(entry);
      closeLayer(); setSelectedTakeId(entry.targetId); setTreatmentTab(tab); setTreating(true);
    } catch { /* A failed save leaves the existing draft available. */ }
    finally { releaseEntry(entry); }
  };
  const openLayerTreatment = async () => {
    const id = selectedLayerId;
    if (!id) return;
    const entry = reserveEntry(id);
    if (!entry) return;
    try {
      if (!await prepareEntry(entry, true)) return;
      assertEntry(entry);
      closeLayer(); setSelectedLayerId(id); setTreatmentTab('adjust'); setTreating(true);
    } catch { /* A failed save leaves the existing draft available. */ }
    finally { releaseEntry(entry); }
  };
  const duplicateLayer = async () => {
    const id = selectedLayerId;
    if (!id || working.current || locked || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    const duplicateId = Crypto.randomUUID();
    try {
      const saved = await editEditing(latest => duplicateStudioLayer(editingPreviewRef.current ? mergeInlineDraft(latest, editingPreviewRef.current) : latest, id, duplicateId));
      if (saved && mounted.current) selectLayer(duplicateId);
    } catch { /* The editor retains its draft and reports the failed save. */ }
  };
  const splitLayer = async () => {
    const id = selectedLayerId;
    if (!id || working.current || locked || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    const rightId = Crypto.randomUUID(), seconds = playbackRef.current.position;
    try {
      const saved = await editEditing(latest => splitStudioLayer(editingPreviewRef.current ? mergeInlineDraft(latest, editingPreviewRef.current) : latest, id, seconds, rightId));
      if (saved && mounted.current) selectLayer(rightId);
    } catch { /* The editor retains its draft and reports the failed save. */ }
  };
  const addMedia = async () => {
    const entry = reserveEntry(selectedLayerId || selectedTakeId);
    if (!entry) return;
    try {
      const latest = await prepareEntry(entry);
      if (!latest) return;
      assertEntry(entry);
      const takes = await importStudioMedia(latest);
      if (entryCurrent(entry) && takes.length) { assertEntry(entry); closeLayer(); setActiveTakeId(takes[0].id); setSelectedTakeId(takes[0].id); }
    } catch (error) { if (!(error instanceof EditorEntryCancelled) && !entry.errorReported && entryCurrent(entry)) Alert.alert('Importar conteúdo', error instanceof Error ? error.message : 'Não foi possível importar. Tente novamente.'); }
    finally { releaseEntry(entry); }
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
  const navigate = async (destination: 'record' | 'review' | 'back', backAction?: Parameters<typeof navigation.dispatch>[0]) => {
    const entry = reserveEntry(selectedLayerId || selectedTakeId, destination !== 'record');
    if (!entry) return;
    if (destination === 'back') leaving.current = true;
    try {
      if (!await prepareEntry(entry)) return;
      assertEntry(entry);
      if (destination === 'back') {
        await discardTransientStudioProject(entry.ownerId, entry.projectId);
        // Discarding an empty session may unmount this editor by design.
        if (!entryCurrent(entry, false)) return;
        if (entry.draft && mounted.current) closeLayer();
        allowRemoval.current = true;
        if (backAction) navigation.dispatch(backAction);
        else if (router.canGoBack()) router.back(); else router.replace('/studio');
      }
      else { if (entry.draft) closeLayer(); router.push({ pathname: destination === 'record' ? '/studio/capture' : '/studio/review', params: { id: project.id } }); }
    } catch (error) { if (!(error instanceof EditorEntryCancelled) && !entry.errorReported && entryCurrent(entry)) Alert.alert('Seu projeto está aqui', error instanceof Error ? error.message : 'Não foi possível salvar. Tente novamente.'); }
    finally { if (destination === 'back') leaving.current = false; releaseEntry(entry); }
  };
  const selectTake = (take: StudioTake) => {
    if (!focusRef.current || current.current.owner !== project.ownerId || working.current || trimDraft || canvasInteracting || layerTrimDraft.current || layerGesture.current) return;
    preview.current?.pause();
    const select = () => { closeLayer(); setSelectedTakeId(take.id); };
    const focusAtStart = focusEpoch.current, identityAtStart = identityEpoch.current;
    if (editingPreviewRef.current) void applyVisibleEditing().then(saved => {
      const latest = getStudioProject(project.ownerId, project.id) || current.current.project;
      if (saved && mounted.current && focusRef.current && focusAtStart === focusEpoch.current && identityAtStart === identityEpoch.current && latest.takes.some(item => item.id === take.id)) select();
    });
    else select();
  };
  const selectMainCanvas = (id: string) => {
    if (!focusRef.current || current.current.owner !== project.ownerId || working.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    const take = current.current.project.takes.find(item => item.id === id);
    if (!take) return;
    if (studioEditing(current.current.project).output.profile === 'standard') { selectTake(take); return; }
    const entry = reserveEntry(id);
    if (!entry) return;
    void prepareEntry(entry, true).then(saved => { if (saved && entryCurrent(entry)) { closeLayer(); setSelectedTakeId(id); } })
      .catch(() => { /* Keep the current selection on cancellation or failed save. */ }).finally(() => releaseEntry(entry));
  };
  const editCanvasElement = (id: string) => {
    if (!focusRef.current || current.current.owner !== project.ownerId || working.current || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
    const item = (editingPreviewRef.current || studioEditing(current.current.project)).layers.flatMap(layer => layer.items).find(item => item.id === id);
    if (!item) { selectMainCanvas(id); return; }
    selectLayer(id, !!item.text);
  };
  const openPanel = (next: Panel) => {
    if (voiceover || working.current || trimDraft || canvasDraft.current || canvasGesture.current || layerTrimDraft.current || layerGesture.current) return;
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
  const canSplit = !locked && !!activeTake && playback.takeId === activeTake.id && canSplitStudioTake(project.takes, activeTake.id, playback.sourcePosition);
  const closePanel = () => { if (!busy) setPanel(null); };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={!fullscreen} style={[styles.screen, !fullscreen && { paddingTop: insets.top }]}>
    <StatusBar hidden={focused && fullscreen} style="light" />
    {!fullscreen && <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Voltar aos projetos" disabled={voiceover || busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void navigate('back'); }} style={styles.iconButton}><X size={20} color={colors.text} strokeWidth={1.7} /></Pressable>
      <View style={{ flex: 1, minWidth: 0 }}><Pressable accessibilityRole="button" accessibilityLabel="Editar título e roteiro do projeto" onPress={() => openPanel('preparation')} style={styles.projectTitle}><Text numberOfLines={1} style={styles.title}>{fields.title || (project.kind === 'aula' ? 'Nova aula' : project.kind === 'short' ? 'Novo short' : 'Novo podcast')}</Text><ChevronDown size={12} color={colors.text} strokeWidth={2.2} /></Pressable></View>
      {(saving || !!saveError) && <View style={styles.saveNotice}><StudioSaveStatus saving={saving} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} /></View>}
      {!!project.pendingTakes?.length && <Pressable accessibilityRole="button" accessibilityLabel="Recuperar arquivos pendentes" onPress={() => openPanel('recovery')} style={styles.iconButton}><Text style={{ color: colors.accent }}>{project.pendingTakes.length}</Text></Pressable>}
      <Pressable accessibilityRole="button" accessibilityLabel={`Qualidade de saída: ${studioOutputLabel(editing)}`} onPress={() => openPanel('output')} style={styles.outputButton}><Text style={styles.outputText}>{outputLabel}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={locked ? 'Acompanhar publicação' : 'Revisar publicação'} disabled={voiceover || busy || canvasInteracting || layerInteracting || transient || !!trimDraft} hitSlop={{ top: 6, bottom: 6 }} onPress={() => { void navigate('review'); }} style={[styles.review, (busy || canvasInteracting || layerInteracting || transient || !!trimDraft) && { opacity: 0.5 }]}><Text style={styles.reviewText}>{locked ? 'Publicação' : 'Avançar'}</Text><ChevronRight size={15} color="#0B0E11" /></Pressable>
    </View>}
    <View style={fullscreen ? StyleSheet.absoluteFillObject : styles.previewStage} onLayout={event => { setStageSize(event.nativeEvent.layout); }}>
      <View style={fullscreen ? StyleSheet.absoluteFillObject : [styles.previewFrame, { width: previewWidth, height: previewHeight }]}>
        <StudioCompositionPreview ref={preview} project={previewProject} recipe={recipe} playbackChannel={playbackChannel} canvasTransformChannel={canvasTransformChannel} before={before} activeTakeId={activeTakeId} onActiveTakeChange={setActiveTakeId} onPlaybackState={receivePlayback}
          paused={(voiceover && !voiceoverRecording) || !focused || !!pendingRestore.current || !!panel || busy || !!trimDraft || canvasInteracting || layerInteracting || treating || !!clipTool || (!fullscreen && (layerPanelExpanded || keyboardVisible))} onCanvasPress={pressEmptyCanvas} canvasLabel={playback.playing ? 'Pausar prévia' : 'Reproduzir prévia'} />
        {!fullscreen && advanced && <StudioCanvasEditor editing={visibleEditing} recipe={recipe} canvasTransformChannel={canvasTransformChannel} positionSeconds={playback.position} selectedLayerId={selectedLayerId} selectedMainClipId={selectedTakeId}
          disabled={voiceover || !focused || busy || locked || !!panel || !!trimDraft || layerInteracting || treating || !!clipTool}
          onSelectLayer={selectLayer} onSelectMainClip={selectMainCanvas} onCanvasPress={pressEmptyCanvas} onPreviewRect={previewCanvas} onCommitRect={commitCanvas} onEditText={editCanvasElement}
          onInteractionStart={() => { canvasGesture.current = true; preview.current?.pause(); setCanvasInteracting(true); }} onInteractionEnd={() => { canvasGesture.current = false; setCanvasInteracting(false); }} />}
      </View>
      {!fullscreen && <Pressable accessibilityRole="button" accessibilityLabel="Prévia em tela inteira" disabled={voiceover || busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { preview.current?.pause(); setFullscreen(true); }} style={[styles.expandPreview, { top: Math.max(0, (stageSize.height + previewHeight) / 2 - 44) }]}><ChevronDown size={20} color={colors.text} strokeWidth={2.5} /></Pressable>}

    </View>
    {/* KeyboardAvoidingView owns its bottom padding. Keep the gesture clearance
        on the workspace so the closed keyboard cannot overwrite the safe area. */}
    {!fullscreen ? <View style={[styles.workspace, { paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 8) + 20 }]}>
      {!voiceover && !keyboardVisible && !layerPanelExpanded && !treating && !clipTool && <View style={styles.transport}>
        <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} disabled={!project.takes.length || !!panel || busy || playback.loading || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => preview.current?.togglePlayback()} style={styles.playButton}>
          {playback.loading ? <ActivityIndicator size="small" color={colors.muted} /> : playback.playing ? <Pause size={20} color={colors.text} fill={colors.text} strokeWidth={1.2} /> : <Play size={20} color={colors.text} fill={colors.text} strokeWidth={1.2} />}
        </Pressable>
        <View pointerEvents="none" style={styles.timeBlock}><Text style={styles.time}>{formatStudioEditorTime(playback.position)}</Text><Text style={styles.totalTime}>{formatStudioEditorTime(duration)}</Text></View>
        <View style={styles.historyButtons}>
          <Pressable accessibilityRole="button" accessibilityLabel="Desfazer edição" disabled={!historyState.canUndo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft} onPress={() => { closeLayer(); void editTakes('undo'); }} style={[styles.iconButton, (!historyState.canUndo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft) && styles.disabled]}><Undo2 size={22} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Refazer edição" disabled={!historyState.canRedo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft} onPress={() => { closeLayer(); void editTakes('redo'); }} style={[styles.iconButton, (!historyState.canRedo || busy || canvasInteracting || layerInteracting || locked || !!trimDraft) && styles.disabled]}><Redo2 size={22} color={colors.textSecondary} strokeWidth={1.6} /></Pressable>
        </View>
      </View>}
      {!voiceover && !keyboardVisible && !layerPanelExpanded && !treating && !clipTool && <StudioTimeline editing={editing} layers={timelineLayers} selectedLayerId={selectedLayerId} onSelectLayer={selectLayer} onMoveLayer={moveLayer} onEditLayer={editCanvasElement} onLayerTrimPreview={previewLayerTrim} onLayerTrimCommit={commitLayerTrim} onLayerInteractionStart={() => { layerGesture.current = true; preview.current?.pause(); setLayerInteracting(true); }} onLayerInteractionEnd={() => { layerGesture.current = false; setLayerInteracting(false); }} takes={project.takes} position={playback.position} playing={playback.playing && !panel && !trimDraft && !editingPreview && !canvasInteracting && !layerInteracting && !pendingRestore.current} loading={playback.loading} activeTakeId={selectedTakeId} audio={project.kind === 'podcast'}
        playbackChannel={playbackChannel} cancelEpoch={trimCancelEpoch}
        onToggleLaneVisibility={zIndex => toggleTrackControl('visibility', zIndex)} onToggleLaneMute={zIndex => toggleTrackControl('mute', zIndex)} onToggleMainMute={() => toggleTrackControl('main')}
        locked={locked} busy={!focused || busy || canvasInteracting} onSelect={selectTake} onScrubStart={() => preview.current?.pause()} onSeek={seconds => preview.current?.seek(seconds)} onAppend={() => openPanel('append')}
        onTrimChange={previewTrim} onTrimCommit={commitTrim} onTrimCancel={cancelTrim} />}
      {captionProgress && <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 }}><Text style={{ flex: 1, color: colors.muted, fontSize: 11 }}>{captionProgress}</Text><Pressable accessibilityLabel="Cancelar transcrição" onPress={() => { const request = captionRequest.current; if (request) { request.cancelled = true; setCaptionProgress('Cancelando…'); void cancelStudioTranscriptionAsync(request.id); } }} style={styles.iconButton}><X size={16} color={colors.text} /></Pressable></View>}
      {voiceover ? <StudioVoiceoverPanel project={project} positionSeconds={playback.position} disabled={busy || locked || !focused} canCommit={canSaveVoiceover} onClose={closeVoiceover} onRecordingChange={receiveVoiceoverRecording}
        onBeforePersist={(latest, next) => { if (!canSaveVoiceover()) throw new EditorEntryCancelled(); voiceoverHistory.current = history.beginEditing(latest, next); }}
        onPersisted={saved => { if (voiceoverHistory.current) history.commit(voiceoverHistory.current, saved); voiceoverHistory.current = null; if (mounted.current) setHistoryState(history.state()); }}
        onPersistError={() => { history.abort(voiceoverHistory.current); voiceoverHistory.current = null; }}
        onSaved={id => { if (canSaveVoiceover()) { closeVoiceover(); selectionEpoch.current++; setSelectedLayerId(id); } }} /> : clipTool && (selectedLayerId || selectedTakeId) ? <StudioClipPanel key={`${selectedLayerId || selectedTakeId}:${clipTool}`} editing={editing} targetId={(selectedLayerId || selectedTakeId)!} mode={clipTool} toolsEnabled={toolsEnabled} disabled={busy || locked || !focused} onPreview={previewEditing} onApply={applyInlineDraft} onClose={closeLayer} /> : treating && (selectedLayerId || activeTake) ? <StudioTreatmentPanel key={selectedLayerId || activeTake!.id} editing={editing} targetId={selectedLayerId || activeTake!.id} initialTab={treatmentTab} previewsEnabled={isStudioFilterPreviewAvailable()} positionSeconds={playback.position} disabled={busy || locked} onPreview={previewEditing} onBefore={setBefore} onApply={applyInlineDraft} onClose={closeLayer} /> : layerItem ? <StudioLayerPanel key={layerItem.id} editing={visibleEditing} item={layerItem} ownerId={project.ownerId} toolsEnabled={toolsEnabled} onClipTool={mode => { void openClipTool(mode); }} onExtractAudio={extractAudio} canvasEditing onEditingChange={setLayerPanelExpanded} editTextRequest={editTextRequest} onTextEditConsumed={request => setEditTextRequest(pending => pending?.id === request.id && pending.sequence === request.sequence ? undefined : pending)} disabled={busy || locked || canvasInteracting || layerInteracting || !focused} onPreview={previewEditing} onApply={applyInlineDraft} onDuplicate={duplicateLayer} onSplit={splitLayer} canSplit={canSplitStudioLayer(visibleEditing, layerItem.id, playback.position)} onTreatment={layerItem.kind === 'image' || layerItem.kind === 'video' ? () => { void openLayerTreatment(); } : undefined} onRemove={() => { void editEditing(value => removeStudioLayerItem(value, layerItem.id)).then(saved => { if (saved) closeLayer(); }).catch(() => {}); }} onClose={closeLayer} /> : null}
      {orientationError ? <Text style={styles.warning}>{orientationError}</Text> : project.kind === 'short' && duration > 180 ? <Text style={styles.warning}>Ajuste a montagem para até 3 minutos.</Text> : locked ? <Text style={styles.locked}>{project.state === 'submitted' ? 'Enviado para curadoria' : 'Montagem em preparação · acompanhe na publicação'}</Text> : null}
      {!voiceover && !layerItem && !treating && !clipTool && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolbar}>
        {selectedTakeId && activeTake ? <>
          <EditorTool label="Voltar" icon={<ChevronLeft size={20} color={colors.text} strokeWidth={2.5} />} disabled={voiceover || busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void applyVisibleEditing().then(saved => { if (saved && mounted.current) { setSelectedTakeId(undefined); setOrganizing(false); } }); }} />
          {organizing ? <>
            <EditorTool label="Para antes" icon={<ArrowUp size={20} color={colors.text} strokeWidth={1.5} style={{ transform: [{ rotate: '-90deg' }] }} />} disabled={busy || canvasInteracting || layerInteracting || locked || !!trimDraft || activeIndex === 0} onPress={() => { void move(activeTake.id, -1); }} />
            <EditorTool label="Para depois" icon={<ArrowDown size={20} color={colors.text} strokeWidth={1.5} style={{ transform: [{ rotate: '-90deg' }] }} />} disabled={busy || canvasInteracting || layerInteracting || locked || !!trimDraft || activeIndex === project.takes.length - 1} onPress={() => { void move(activeTake.id, 1); }} />
          </> : <>
            <EditorTool label="Dividir" icon={<Split size={20} color={colors.text} strokeWidth={1.5} />} disabled={!canSplit || busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void split(); }} />
            <EditorTool label="Duplicar" icon={<Copy size={20} color={colors.text} strokeWidth={1.5} />} disabled={busy || locked || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => { void duplicate(); }} />
          </>}
          <EditorTool label="Filtros" icon={<Blend size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || canvasInteracting || layerInteracting || locked || !!trimDraft} onPress={() => { void openTreatment(); }} />
          <EditorTool label="Volume" icon={<Volume2 size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !!trimDraft} onPress={() => { void openClipTool('volume'); }} />
          <EditorTool label="Velocidade" icon={<Gauge size={20} color={colors.text} strokeWidth={1.5} />} disabled={!toolsEnabled || !advanced || busy || locked || !!trimDraft || activeTake.kind === 'image'} onPress={() => { void openClipTool('speed'); }} />
          <EditorTool label="Efeitos" icon={<Sparkles size={20} color={colors.text} strokeWidth={1.5} />} disabled={!toolsEnabled || !advanced || busy || locked || !!trimDraft} onPress={() => { void openClipTool('motion'); }} />
          <EditorTool label="Espelhar" icon={<FlipHorizontal2 size={20} color={colors.text} strokeWidth={1.5} />} disabled={!toolsEnabled || !advanced || busy || locked || !!trimDraft} onPress={() => { void openClipTool('mirror'); }} />
          <EditorTool label="Extrair áudio" icon={<Music size={20} color={colors.text} strokeWidth={1.5} />} disabled={!toolsEnabled || !advanced || busy || locked || !!trimDraft || activeTake.kind === 'image'} onPress={() => { void extractAudio(); }} />
          <EditorTool label="Excluir" icon={<Trash2 size={20} color={colors.text} strokeWidth={1.5} />} disabled={busy || locked || canvasInteracting || layerInteracting || !!trimDraft} onPress={deleteTake} />
          <EditorTool label={organizing ? 'Ferramentas' : 'Organizar'} icon={<Film size={20} color={colors.text} strokeWidth={1.5} />} disabled={voiceover || busy || canvasInteracting || layerInteracting || !!trimDraft} onPress={() => setOrganizing(value => !value)} />
        </> : <>
          <EditorTool label="Áudio" icon={<Music size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => { void addLayer('audio'); }} />
          <EditorTool label="Voz" icon={<Mic size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => { void openVoiceover(); }} />
          <EditorTool label="Texto" icon={<Type size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => { void addLayer('text'); }} />
          <EditorTool label="Sobrepor" icon={<Layers size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => openPanel('media')} />
          <EditorTool label="Legendas" icon={<Captions size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !project.takes.length} onPress={() => openPanel('captions')} />
          <EditorTool label="Filtros" icon={<Blend size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !activeTake} onPress={() => { void openTreatment(); }} />
          <EditorTool label="Ajustar" icon={<SlidersHorizontal size={20} color={colors.text} strokeWidth={1.5} />} disabled={!advanced || busy || locked || !activeTake} onPress={() => { void openTreatment('adjust'); }} />
        </>}
      </ScrollView>}
    </View> : <View pointerEvents="box-none" style={[styles.fullscreenTools, { paddingBottom: Math.max(insets.bottom, 8) + 20, paddingHorizontal: Math.max(insets.left, insets.right, 12) }]}>
      <View style={styles.fullscreenTransport}>
        <Pressable accessibilityRole="button" accessibilityLabel={playback.playing ? 'Pausar montagem' : 'Reproduzir montagem'} onPress={() => preview.current?.togglePlayback()} style={styles.overlayButton}>{playback.playing ? <Pause size={20} color={colors.text} /> : <Play size={20} color={colors.text} fill={colors.text} strokeWidth={1.2} />}</Pressable>
        <View style={styles.fullscreenHistory}>
          <Pressable accessibilityRole="button" accessibilityLabel="Desfazer edição" disabled={!historyState.canUndo || busy || locked} onPress={() => { closeLayer(); void editTakes('undo'); }} style={[styles.overlayButton, !historyState.canUndo && styles.disabled]}><Undo2 size={20} color={colors.text} strokeWidth={1.6} /></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Refazer edição" disabled={!historyState.canRedo || busy || locked} onPress={() => { closeLayer(); void editTakes('redo'); }} style={[styles.overlayButton, !historyState.canRedo && styles.disabled]}><Redo2 size={20} color={colors.text} strokeWidth={1.6} /></Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Voltar às ferramentas do editor" onPress={() => { preview.current?.pause(); setFullscreen(false); }} style={styles.returnEditor}><ChevronUp size={20} color={colors.text} strokeWidth={2.5} /><Text style={styles.returnLabel}>Editar</Text></Pressable>
      </View>
      <StudioTimeline playbackChannel={playbackChannel} previewOnly compact takes={project.takes} position={playback.position} playing={playback.playing && !pendingRestore.current} loading={playback.loading} locked busy={!focused || busy} audio={project.kind === 'podcast'} onSelect={() => {}} onScrubStart={() => preview.current?.pause()} onSeek={seconds => preview.current?.seek(seconds)} />
    </View>}
    <SheetModal visible={!!panel} onRequestClose={closePanel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[sheetStyles.backdrop, { paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityLabel="Fechar painel do editor" style={{ flex: 1 }} onPress={closePanel} />
        <View style={[sheetStyles.surface, { paddingBottom: Math.max(insets.bottom, 12) + 12, maxHeight: maxSheetHeight }]}><View style={sheetStyles.handle} />
          <View onStartShouldSetResponder={() => true} style={[sheetStyles.header, sheetContentStyle, { flexShrink: 0 }]}><Text style={[studioStyles.sectionTitle, { flex: 1 }]}>{panel === 'preparation' ? 'Projeto' : panel === 'recovery' ? 'Recuperar arquivos' : panel === 'append' ? 'Adicionar' : panel === 'media' ? 'Sobrepor' : panel === 'captions' ? 'Legendas' : 'Qualidade de saída'}</Text><SheetCloseButton onPress={closePanel} /></View>
          <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={[sheetContentStyle, { flexShrink: 1, flexGrow: 0 }]} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12, gap: 18 }}>
            {panel === 'preparation' ? <>
              <StudioField label="Título do projeto" value={fields.title} onChangeText={value => setField('title', value)} placeholder="Dê um nome à sua ideia" maxLength={180} editable={!locked} />
              <StudioField label="Objetivo do aprendizado" value={fields.objective} onChangeText={value => setField('objective', value)} placeholder="O que a pessoa vai conseguir fazer?" multiline maxLength={1000} editable={!locked} />
              <StudioField label="Para quem você está ensinando?" value={fields.audience} onChangeText={value => setField('audience', value)} placeholder="Descreva seu público" maxLength={500} editable={!locked} />
              <StudioField label="Guia de gravação" value={fields.script} onChangeText={value => setField('script', value)} placeholder={'Abertura\n\nExplicação e demonstração\n\nAplicação prática'} multiline style={{ minHeight: 180 }} hint="Seu guia pode acompanhar você no teleprompter." editable={!locked} />
              <StudioSaveStatus saving={saving} error={saveError} transient={transient} onRetry={() => { void flush().catch(() => {}); }} />
            </> : panel === 'append' ? <>
              <EditorSheetAction label="Gravar" icon={project.kind === 'podcast' ? <Mic size={20} color={colors.text} strokeWidth={1.5} /> : <Video size={20} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy || !orientationReady} onPress={() => { setPanel(null); void navigate('record'); }} />
              <EditorSheetAction label={project.kind === 'podcast' ? 'Arquivo de áudio' : 'Arquivo da galeria'} icon={<Upload size={20} color={colors.text} strokeWidth={1.5} />} disabled={locked || busy} onPress={() => { setPanel(null); void addMedia(); }} />
            </> : panel === 'media' ? <>
              <EditorSheetAction label="Imagem" icon={<ImagePlus size={26} color={colors.text} />} onPress={() => { setPanel(null); void addLayer('image'); }} />
              <EditorSheetAction label="Vídeo sobreposto" icon={<Video size={26} color={colors.text} />} onPress={() => { setPanel(null); void addLayer('video'); }} />
            </> : panel === 'captions' ? <>
              <View style={styles.optionRow}><Captions size={24} color={colors.text} /><Text style={styles.optionLabel}>Gerar a partir de</Text><Text style={styles.optionValue}>Take atual</Text></View>
              <View style={styles.optionRow}><Mic size={24} color={colors.text} /><Text style={styles.optionLabel}>Idioma falado</Text><Text style={styles.optionValue}>Português</Text></View>
              <EditorSheetAction label="Legenda manual" icon={<Type size={26} color={colors.text} />} onPress={() => { setPanel(null); void addLayer('caption'); }} />
              <EditorSheetAction label="Importar SRT/VTT" icon={<FileText size={26} color={colors.text} />} onPress={() => { setPanel(null); void captionFile(); }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Gerar legendas" onPress={() => { setPanel(null); void generateCaptions(); }} style={styles.sheetPrimary}><Text style={styles.sheetPrimaryText}>Gerar legendas</Text></Pressable>
            </> : panel === 'output' ? <>
              <View style={styles.outputGroup}><Text style={styles.optionLabel}>Resolução</Text><View style={styles.outputChoices}>
                {(['original', 'hd', '2k', '4k'] as const).map(resolution => {
                  const selection = { ...outputSelection, resolution };
                  const supported = !!outputCapabilities && studioOutputSupported(studioEffectiveOutput(withStudioOutputSelection(editing, selection)), outputCapabilities);
                  const selected = resolution === outputSelection.resolution;
                  const label = resolution === 'original' ? 'Original' : resolution === 'hd' ? 'HD' : resolution === '2k' ? '2K' : '4K';
                  return <Pressable key={resolution} accessibilityRole="button" accessibilityLabel={`Exportar em ${label}`} accessibilityState={{ selected, disabled: !supported || busy || locked }}
                    disabled={!supported || busy || locked} onPress={() => { void chooseOutput(selection); }} style={[styles.outputChoice, selected && styles.outputChoiceSelected, !supported && styles.disabled]}><Text style={[styles.outputChoiceText, selected && styles.outputChoiceTextSelected]}>{label}</Text></Pressable>;
                })}
              </View></View>
              <View style={styles.outputGroup}><Text style={styles.optionLabel}>Taxa de quadros</Text><View style={styles.outputChoices}>
                {(['original', 24, 30, 60] as const).map(frameRate => {
                  const selection = { ...outputSelection, frameRate };
                  const supported = !!outputCapabilities && studioOutputSupported(studioEffectiveOutput(withStudioOutputSelection(editing, selection)), outputCapabilities);
                  const selected = frameRate === outputSelection.frameRate;
                  const label = frameRate === 'original' ? 'Original' : String(frameRate);
                  return <Pressable key={frameRate} accessibilityRole="button" accessibilityLabel={`Exportar com ${label}${frameRate === 'original' ? '' : ' FPS'}`} accessibilityState={{ selected, disabled: !supported || busy || locked }}
                    disabled={!supported || busy || locked} onPress={() => { void chooseOutput(selection); }} style={[styles.outputChoice, selected && styles.outputChoiceSelected, !supported && styles.disabled]}><Text style={[styles.outputChoiceText, selected && styles.outputChoiceTextSelected]}>{label}</Text></Pressable>;
                })}
              </View></View>
              <View style={styles.optionRow}><Text style={styles.optionLabel}>Cor</Text><Text style={styles.optionValue}>{effectiveOutput.colorSpace === 'source' ? 'Original' : 'SDR'}</Text></View>
              <Text style={styles.outputSummary}>{effectiveOutput.profile === 'legacy-source' ? 'Qualidade original da captura' : `${effectiveOutput.width} × ${effectiveOutput.height} · ${Number((effectiveOutput.frameRateNumerator / effectiveOutput.frameRateDenominator).toFixed(3))} FPS`}</Text>
              {outputCapabilities && outputCapabilities.version < 2 ? <>
                <Text style={styles.outputSummary}>O motor instalado compõe em HD e 30 FPS. As outras opções serão liberadas ao instalar o Classfy Dev atualizado.</Text>
                {!studioOutputSupported(effectiveOutput, outputCapabilities) ? <EditorSheetAction label="Usar HD · 30 FPS" icon={<Film size={20} color={colors.text} />} disabled={busy || locked} onPress={() => { void chooseOutput({ resolution: 'hd', frameRate: 30 }); }} /> : null}
              </> : null}
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
function EditorSheetAction({ label, icon, onPress, disabled = false }: { label: string; icon: ReactNode; onPress: () => void; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.optionRow, disabled && styles.disabled]}>{icon}<Text style={styles.optionLabel}>{label}</Text><ChevronRight size={20} color={colors.text} /></Pressable>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B0E11' },
  header: { height: 52, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  smallIconButton: { width: 36, height: 30, alignItems: 'center', justifyContent: 'center' },
  overlayButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  projectTitle: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44 },
  title: { fontSize: 12, fontWeight: '600', color: colors.text, flexShrink: 1 },
  review: { height: 32, borderRadius: 9, paddingHorizontal: 10, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewText: { fontSize: 12, fontWeight: '600', color: '#0B0E11' },
  previewStage: { flex: 1, minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  previewFrame: { overflow: 'hidden', borderRadius: 5, backgroundColor: '#000000', borderWidth: 1, borderColor: '#000000' },
  expandPreview: { position: 'absolute', left: '50%', marginLeft: -22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  outputButton: { minWidth: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  outputText: { color: colors.text, fontWeight: '600', fontSize: 11 },
  outputGroup: { gap: 10 },
  outputChoices: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 12, backgroundColor: '#252A30' },
  outputChoice: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 9 },
  outputChoiceSelected: { backgroundColor: '#FFFFFF' },
  outputChoiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  outputChoiceTextSelected: { color: '#0B0E11' },
  outputSummary: { color: colors.mutedDim, fontSize: 12, lineHeight: 18 },
  saveNotice: { position: 'absolute', top: 50, left: 58, zIndex: 20, backgroundColor: '#0B0E11', paddingHorizontal: 8, borderRadius: 8 },
  workspace: { paddingTop: 4 },
  transport: { height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  timeBlock: { position: 'absolute', left: '50%', transform: [{ translateX: -44 }], width: 88, alignItems: 'center', gap: 3 },
  time: { color: colors.text, fontSize: 14, fontWeight: '500', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontVariant: ['tabular-nums'] },
  totalTime: { color: colors.mutedDim, fontSize: 11, fontVariant: ['tabular-nums'] },
  playButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  historyButtons: { marginLeft: 'auto', flexDirection: 'row', gap: 2 },
  toolbar: { flexGrow: 1, flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6 },
  tool: { width: 62, height: 56, alignItems: 'center', justifyContent: 'center', gap: 6 },
  toolLabel: { fontSize: 11, color: colors.textSecondary },
  disabled: { opacity: 0.25 },
  warning: { color: colors.accent, fontSize: 11, lineHeight: 16, paddingHorizontal: 18, paddingBottom: 4 },
  locked: { color: colors.muted, fontSize: 11, paddingHorizontal: 18, paddingBottom: 4 },
  fullscreenTools: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  fullscreenTransport: { height: 56, flexDirection: 'row', alignItems: 'center' },
  fullscreenHistory: { marginLeft: 'auto', flexDirection: 'row' },
  returnEditor: { position: 'absolute', left: '50%', marginLeft: -44, width: 88, alignItems: 'center', justifyContent: 'center', height: 56 },
  returnLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  optionRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 14 },
  optionLabel: { color: colors.text, fontSize: 15, flex: 1 },
  optionValue: { color: colors.muted, fontSize: 14 },
  sheetPrimary: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', marginTop: 12 },
  sheetPrimaryText: { fontSize: 15, fontWeight: '700', color: '#0B0E11' },
});
