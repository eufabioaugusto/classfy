import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Download, Film, Image, Loader2, Mic, Monitor, Music2, Pause, Play, Plus, Redo2, Scissors, SlidersHorizontal, Sparkles, Subtitles, Type, Undo2, Upload, Video, X } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { addCaption, addCaptionTrack, addLayerAsset, addMainAsset, addText, applyClassEdit, classEditTarget, duplicateClip, copyStudioClips, pasteStudioClips, groupStudioClips, patchClip, removeClassEditRetakes, removeClip, setLayerHidden, setLayerMuted, setMainMuted, splitLayerClip, splitMainClip, trimMainClip, trimLayerClip, type StudioWebClipPatch } from '@/lib/studio/editor/commands';
import { getAsset, getExport, putAsset, storeExport, studioAssetUri } from '@/lib/studio/editor/storage';
import { inspectStudioMedia } from '@/lib/studio/editor/media';
import { readStudioWaveform, type StudioWaveform } from '@/lib/studio/editor/audioEnvelope';
import { downloadStudioOriginal } from '@/lib/studio/editor/originalDownload';
import { findStudioRetakes, type StudioRetakeGroup } from '@/lib/studio/editor/studioRetakes';
import { findStudioPauses } from '@/lib/studio/editor/classEdit';
import { transcribeStudioCaptions } from '@/lib/studio/editor/studioCaptions';
import { analyzeStudioScene } from '@/lib/studio/editor/sceneAnalysis';
import { analyzeStudioSignature } from '@/lib/studio/editor/signatureAnalysis';
import { createStudioRenderer, type StudioRenderer } from '@/lib/studio/editor/renderer';
import { exportStudioProject, getStudioExportCapabilities, releaseStudioExport, type StudioBrowserExportCapabilities } from '@/lib/studio/editor/export';
import { compileStudioRecipe, formatStudioEditorTime, studioGrade, studioSeconds, studioTicks, withStudioOutputSelection, withStudioTakes, type StudioAsset, type StudioEffect, type StudioOutputSelection, type StudioProject, type StudioTextStyle } from '../../../../shared/studio';
import { StudioDesktopCanvas } from './StudioDesktopCanvas';
import { StudioDesktopTimeline, type TimelineTool } from './StudioDesktopTimeline';
import { StudioShortcutPanel } from './StudioShortcutPanel';
import { studioShortcutFor, type StudioShortcut } from './studioShortcuts';
import { studioSounds, studioSoundFile } from '@/lib/studio/editor/studioSoundEffects';
import { StudioDesktopInspector } from './StudioDesktopInspector';
import { StudioRecorder } from './StudioRecorder';
import { useStudioWorkspace } from './useStudioWorkspace';
import { useStudioExitGuard } from './useStudioExitGuard';
import { useStudioConfirmation } from './useStudioConfirmation';
import { parseDesktopCaptions } from './captionImport';
import '@/styles/studio-editor.css';

const tools = [
  { id: 'media', label: 'Mídia', Icon: Film },
  { id: 'audio', label: 'Áudio', Icon: Music2 },
  { id: 'text', label: 'Texto', Icon: Type },
  { id: 'captions', label: 'Legendas', Icon: Subtitles },
  { id: 'sounds', label: 'Efeitos sonoros', Icon: Music2 },
  { id: 'transitions', label: 'Transições', Icon: Film },
  { id: 'adjustments', label: 'Ajustes', Icon: SlidersHorizontal },
] as const;
type Tab = typeof tools[number]['id'];
const captionStyles = [
  { label: 'Limpa', style: { visualEffect: 'shadow-strong' } },
  { label: 'Tarja', style: { backgroundColor: '#16181CDD' } },
  { label: 'Destaque', style: { color: '#FFD884', visualEffect: 'shadow-strong' } },
] satisfies { label: string; style: Partial<StudioTextStyle> }[];
const colorPresets = [
  { id: 'natural', label: 'Original' },
  { id: 'studio', label: 'Studio' },
  { id: 'cinematic', label: 'Cinema' },
] as const;
type RecordingImport = { asset: StudioAsset; thumbnail?: Blob; warnings: string[]; clipId: string; target: 'main' | 'layer'; at: number; originalStored?: boolean; thumbnailStored?: boolean };
function classEditReviewKey(editing: StudioProject['editing']) {
  return editing ? JSON.stringify([editing.main, editing.layers, editing.mainMuted]) : '';
}

export function StudioEditorWorkspace({ owner, projectId, premium = false, premiumLoading = false, premiumError }: { owner: string; projectId: string; premium?: boolean; premiumLoading?: boolean; premiumError?: string | null }) {
  const navigate = useNavigate(), workspace = useStudioWorkspace(owner, projectId);
  const { project } = workspace;
  const [preview, setPreview] = useState<StudioProject | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [timelineTool, setTimelineTool] = useState<TimelineTool>('select');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState<number | 'actual'>(1);
  const [previewGuides, setPreviewGuides] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState<{ direction: number }>();
  const [loop, setLoop] = useState(false);
  const shuttle = useRef(0);
  const loopRef = useRef(false);
  const clipboard = useRef<ReturnType<typeof copyStudioClips>>();
  const selected = selection.length === 1 ? selection[0] : undefined;
  const setSelected = (id?: string) => setSelection(id ? [id] : []);
  const [tab, setTab] = useState<Tab | null>('media'), [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [renderLoading, setRenderLoading] = useState(false);
  const [captionLanguage, setCaptionLanguage] = useState('portuguese'), [captionStyle, setCaptionStyle] = useState(0);
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [reviewRetakes, setReviewRetakes] = useState(true);
  const [colorPreset, setColorPreset] = useState<StudioEffect>('studio'), [colorIntensity, setColorIntensity] = useState(.65);
  const [captionNotice, setCaptionNotice] = useState('');
  const [classEditRunning, setClassEditRunning] = useState(false);
  const classEditGradient = useId();
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null), [progress, setProgress] = useState(0);
  const measuredCaptionProgress = useRef(0);
  useEffect(() => {
    if (!classEditRunning) return;
    const ceiling = busy === 'Preparando modelo de voz' ? .775 : busy === 'Transcrevendo áudio' ? .925 : undefined;
    if (ceiling === undefined) return;
    // Keep moving within the current stage while the worker is busy on a block.
    const timer = setInterval(() => setProgress(value => {
      if (value >= ceiling) return value;
      const measured = Math.max(0, measuredCaptionProgress.current - value);
      const step = Math.max(.001, (ceiling - value) * .035, Math.min(.009, measured * .16));
      return Math.min(ceiling, value + step);
    }), 280);
    return () => clearInterval(timer);
  }, [busy, classEditRunning]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({}), [recorder, setRecorder] = useState<'camera' | 'screen' | 'audio' | null>(null);
  const [exportMenu, setExportMenu] = useState(false), [exportReady, setExportReady] = useState(false), [rename, setRename] = useState(false), [title, setTitle] = useState('');
  const [capabilities, setCapabilities] = useState<StudioBrowserExportCapabilities | null>(null);
  const [exitPreparing, setExitPreparing] = useState(false);
  const [originalDownload, setOriginalDownload] = useState<{ id: string; status: 'preparing' | 'started' | 'retry' }>();
  const downloadLock = useRef<string | null>(null), downloadTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    setOriginalDownload(undefined);
    return () => {
      clearTimeout(downloadTimer.current);
      downloadTimer.current = undefined;
      downloadLock.current = null;
    };
  }, [owner, projectId]);
  const [waveforms, setWaveforms] = useState<ReadonlyMap<string, StudioWaveform>>(new Map());
  const [classEditResults, setClassEditResults] = useState<{ key: string; cuts: number; removed: number; imageAdjusted: boolean; portraitStatus?: string; finishStatus: string; retakes: StudioRetakeGroup[] }[]>([]);
  const reviewKey = useMemo(() => classEditResults.length ? classEditReviewKey(project?.editing) : '', [project?.editing, classEditResults.length]);
  const classEditResult = classEditResults.find(result => result.key === reviewKey);
  const [comparing, setComparing] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), engine = useRef<StudioRenderer | null>(null), input = useRef<HTMLInputElement>(null), captionsInput = useRef<HTMLInputElement>(null);
  const pendingPatch = useRef<{ id: string; patch: StudioWebClipPatch } | null>(null), importTarget = useRef<'main' | 'layer'>('main'), locked = useRef(false), controller = useRef<AbortController | null>(null), alive = useRef(true), seekSequence = useRef(0);
  const picker = useRef<{ token: number; type: 'media' | 'captions'; target: 'main' | 'layer'; at: number } | null>(null);
  const recordingImports = useRef(new WeakMap<File, RecordingImport>());
  const recorderEntry = useRef<{ token: number; at: number; mode: 'camera' | 'screen' | 'audio' } | null>(null);
  const confirmation = useRef<object | null>(null);
  const { confirm, cancel: cancelConfirmation, pending: confirming, dialog } = useStudioConfirmation(`${owner}:${projectId}`);
  const blocked = !!busy || confirming || exitPreparing;
  const effective = preview ?? project;
  const recipe = useMemo(() => effective ? compileStudioRecipe(effective) : null, [effective]);
  const previewRecipe = useMemo(() => comparing && selected && effective && recipe?.clips.some(clip => clip.id === selected && (clip.kind === 'video' || clip.kind === 'image')) ? compileStudioRecipe(patchClip(effective, selected, { signature: null, enhancement: null, portrait: null, grade: studioGrade(), effect: 'natural' })) : recipe, [comparing, selected, effective, recipe]);
  const latestRecipe = useRef(previewRecipe); latestRecipe.current = previewRecipe;
  const selectedClip = recipe?.clips.find(c => c.id === selected), duration = recipe ? studioSeconds(recipe.durationTicks) : 0;
  useEffect(() => {
    if (!recipe || preview) return;
    const visible = new Set(recipe.clips.map(clip => clip.id));
    setSelection(current => current.every(id => visible.has(id)) ? current : current.filter(id => visible.has(id)));
    if (selected && !visible.has(selected)) setComparing(false);
  }, [selected, recipe, preview]);
  const waveformAssets = JSON.stringify(project?.editing?.assets.filter(asset =>
    (asset.kind === 'video' || asset.kind === 'audio') && asset.hasAudio !== false && asset.durationTicks > 0)
    .map(asset => [asset.id, asset.durationTicks]) ?? []);
  const waveformCache = useRef<{ owner: string; projectId: string; data: Map<string, StudioWaveform | null> }>();
  useEffect(() => {
    const abort = new AbortController();
    if (waveformCache.current?.owner !== owner || waveformCache.current.projectId !== projectId) {
      waveformCache.current = { owner, projectId, data: new Map() };
      setWaveforms(new Map());
    }
    const cache = waveformCache.current.data;
    const assets: [string, number][] = JSON.parse(waveformAssets);
    void (async () => {
      for (const [assetId, ticks] of assets) {
        if (abort.signal.aborted) return;
        if (cache.has(assetId)) continue;
        try {
          const original = await getAsset(owner, projectId, assetId);
          if (!original || abort.signal.aborted) continue;
          const waveform = await readStudioWaveform(original, studioSeconds(ticks), abort.signal);
          if (abort.signal.aborted) return;
          cache.set(assetId, waveform);
          if (waveform) setWaveforms(previous => new Map(previous).set(assetId, waveform));
        } catch { /* Codecs unsupported by this browser have no waveform. */ }
      }
    })();
    return () => abort.abort();
  }, [owner, projectId, waveformAssets]);

  const scope = useCallback((token: number) => alive.current && workspace.isCurrent(token) && document.visibilityState !== 'hidden', [workspace.isCurrent]);
  const apply = (change: (value: StudioProject) => StudioProject) => { if (locked.current || confirmation.current) return; try { workspace.apply(change); setError(null); setExportReady(false); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revise esta edição.'); } };
  const settle = () => {
    const draft = pendingPatch.current; if (!draft) return;
    pendingPatch.current = null;
    try { workspace.apply(value => patchClip(value, draft.id, draft.patch)); setPreview(null); setExportReady(false); }
    catch (cause) { pendingPatch.current = draft; setError(cause instanceof Error ? cause.message : 'Não foi possível concluir esta edição.'); throw cause; }
  };
  const selectMany = (ids: string[]) => {
    if (locked.current || confirmation.current) return;
    try { settle(); setComparing(false); setSelection([...new Set(ids.flatMap(id => project?.editing?.clipGroups?.find(group => group.includes(id)) ?? [id]))]); } catch { /* Preserve the draft and selection. */ }
  };
  const select = (id?: string) => selectMany(id ? [id] : []);
  const seek = async (seconds: number, previewEnd?: number) => {
    shuttle.current = 0;
    if (locked.current || confirmation.current) return;
    try { settle(); } catch { return; }
    engine.current?.pause(); const token = ++seekSequence.current;
    setPlaying(false); setPosition(Math.max(0, Math.min(duration, seconds)));
    try {
      const renderer = engine.current;
      await renderer?.seek(seconds);
      if (previewEnd !== undefined && token === seekSequence.current && alive.current && renderer === engine.current && !locked.current && !confirmation.current) await renderer?.play(1, previewEnd);
    } catch (cause) { if (alive.current && token === seekSequence.current) setError(cause instanceof Error ? cause.message : 'Não foi possível mostrar este quadro.'); }
  };
  useEffect(() => {
    alive.current = true;
    confirmation.current = null; locked.current = false; controller.current = null; recorderEntry.current = null; pendingPatch.current = null;
    clipboard.current = undefined; shuttle.current = 0;
    setClassEditResults([]); setClassEditRunning(false); setBusy(null); setRecorder(null); setPreview(null); setSelected(undefined); setExitPreparing(false); setComparing(false);
    return () => { alive.current = false; confirmation.current = null; picker.current = null; controller.current?.abort(); ++seekSequence.current; engine.current?.dispose(); };
  }, [owner, projectId]);
  useEffect(() => { let active = true; getStudioExportCapabilities().then(value => { if (active) setCapabilities(value); }).catch(() => undefined); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!project || !canvas.current) return;
    let active = true, renderer: StudioRenderer | null = null, unsubscribe: (() => void) | undefined;
    setRenderLoading(true);
    createStudioRenderer(compileStudioRecipe(project), assetId => getAsset(owner, projectId, assetId), { canvas: canvas.current }).then(async value => {
      if (!active) { value.dispose(); return; }
      renderer = value; engine.current = value; value.setLoop?.(loopRef.current);
      unsubscribe = value.subscribe(state => { if (!active) return; setPosition(state.position); setPlaying(state.playing); setRenderLoading(state.loading); if (state.error) setError(state.error); });
      if (latestRecipe.current) await value.setRecipe(latestRecipe.current);
      await value.seek(0);
    }).catch(cause => { if (active) { setError(cause instanceof Error ? cause.message : 'Não foi possível preparar a prévia.'); setRenderLoading(false); } });
    return () => { active = false; unsubscribe?.(); renderer?.dispose(); if (engine.current === renderer) engine.current = null; };
  }, [!!project, owner, projectId]);
  useEffect(() => { if (previewRecipe && engine.current) void engine.current.setRecipe(previewRecipe).catch(cause => { if (alive.current) setError(cause.message); }); }, [previewRecipe]);
  useEffect(() => {
    if (!project) return;
    let active = true; const urls: string[] = [];
    Promise.all(project.editing!.assets.map(async asset => { const blob = await getAsset(owner, projectId, `${asset.id}:thumbnail`); if (!blob || !active) return null; const url = URL.createObjectURL(blob); urls.push(url); return [asset.id, url] as const; })).then(pairs => { if (active) setThumbnails(Object.fromEntries(pairs.filter(Boolean))); }).catch(() => undefined);
    return () => { active = false; urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [owner, projectId, project?.editing?.assets]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => { if (workspace.hasPendingChanges() || locked.current || pendingPatch.current || recorder) { event.preventDefault(); event.returnValue = ''; } };
    const visibility = () => { if (document.visibilityState === 'hidden') { cancelConfirmation(); engine.current?.pause(); controller.current?.abort(); if (picker.current) { picker.current = null; locked.current = false; setBusy(null); } } };
    window.addEventListener('beforeunload', before); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('beforeunload', before); document.removeEventListener('visibilitychange', visibility); };
  }, [workspace.dirty, recorder, cancelConfirmation]);
  const recordError = (cause: unknown) => { if (cause instanceof DOMException && cause.name === 'AbortError') return; setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a operação.'); };
  const external = async (label: string, task: (token: number, signal: AbortSignal) => Promise<void>, propagateError = false, classEdit = false): Promise<boolean> => {
    if (locked.current || confirmation.current || !alive.current || document.visibilityState === 'hidden') return false;
    try { settle(); } catch (cause) { if (propagateError) throw cause; return false; }
    locked.current = true; shuttle.current = 0; ++seekSequence.current; engine.current?.pause(); setBusy(label); setClassEditRunning(classEdit); setError(null); setProgress(0);
    const token = workspace.epoch.current, abort = new AbortController(); controller.current = abort;
    try { await workspace.flush(); if (!scope(token) || abort.signal.aborted) return false; await task(token, abort.signal); return scope(token) && !abort.signal.aborted; }
    catch (cause) { if (workspace.isCurrent(token) && alive.current) recordError(cause); if (propagateError) throw cause; return false; }
    finally { if (workspace.isCurrent(token) && alive.current) { locked.current = false; setBusy(null); setClassEditRunning(false); if (controller.current === abort) controller.current = null; } }
  };
  const downloadOriginal = (asset: StudioAsset) => {
    if (downloadLock.current || locked.current || confirmation.current) return;
    const token = workspace.epoch.current;
    downloadLock.current = asset.id;
    setOriginalDownload({ id: asset.id, status: 'preparing' });
    void external('Preparando original', async (operationToken, signal) => {
      const original = await getAsset(owner, projectId, asset.id);
      if (!scope(operationToken) || signal.aborted) return;
      if (!original) throw new Error('O original deste trecho não está disponível neste navegador.');
      downloadStudioOriginal(original, asset.name);
      setOriginalDownload({ id: asset.id, status: 'started' });
      downloadTimer.current = setTimeout(() => {
        if (!workspace.isCurrent(token)) return;
        downloadTimer.current = undefined;
        downloadLock.current = null;
        setOriginalDownload({ id: asset.id, status: 'retry' });
      }, 4000);
    }).then(() => {
      if (workspace.isCurrent(token) && downloadTimer.current === undefined) {
        downloadLock.current = null;
        setOriginalDownload(undefined);
      }
    });
  };
  const importFiles = async (files: File[], target: 'main' | 'layer', at = position, recorded = false) => external('Importando arquivos', async (token, signal) => {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      let imported = recorded ? recordingImports.current.get(file) : undefined;
      if (!imported) {
        const info = await inspectStudioMedia(file, { signal });
        if (!scope(token) || signal.aborted) throw new DOMException('Importação cancelada.', 'AbortError');
        const id = crypto.randomUUID(), asset: StudioAsset = { id, kind: info.kind, name: file.name, uri: studioAssetUri(owner, projectId, id, file.name), durationTicks: studioTicks(info.duration), width: info.width, height: info.height, frameRate: info.frameRate, hasAudio: info.hasAudio, colorSpace: info.colorSpace, sourceStage: 'standard', sourceKind: 'standard', ...(info.thumbnail ? { thumbnailUri: studioAssetUri(owner, projectId, `${id}:thumbnail`, `${file.name}.jpg`) } : {}) };
        imported = { asset, thumbnail: info.thumbnail, warnings: info.warnings, clipId: crypto.randomUUID(), target, at };
        if (recorded) recordingImports.current.set(file, imported);
      }
      const entry = imported;
      if (!entry.originalStored) { await putAsset(owner, projectId, entry.asset.id, file); entry.originalStored = true; }
      if (!scope(token) || signal.aborted) throw new DOMException('Importação cancelada.', 'AbortError');
      if (entry.thumbnail && !entry.thumbnailStored) { await putAsset(owner, projectId, `${entry.asset.id}:thumbnail`, entry.thumbnail); entry.thumbnailStored = true; }
      if (!scope(token) || signal.aborted) return;
      workspace.apply(value => {
        // A failed durable write can leave this clip in the local draft. Retrying
        // the same recording confirms that write without inserting a second take.
        if (value.editing!.main.some(clip => clip.id === entry.clipId) || value.editing!.layers.some(layer => layer.items.some(item => item.id === entry.clipId))) return value;
        return entry.target === 'main' || !value.editing!.main.length ? addMainAsset(value, entry.asset, entry.clipId) : addLayerAsset(value, entry.asset, Math.min(entry.at, Math.max(0, studioSeconds(compileStudioRecipe(value).durationTicks) - .1)), { itemId: entry.clipId });
      });
      await workspace.flush(); if (!scope(token)) return; setProgress((index + 1) / files.length);
      if (entry.warnings.length) setError(entry.warnings.join(' '));
    }
  }, recorded);
  const cancelPicker = () => { const pending = picker.current; picker.current = null; if (pending && workspace.isCurrent(pending.token) && alive.current) { locked.current = false; setBusy(null); } };
  const cancelPickerLatest = useRef(cancelPicker); cancelPickerLatest.current = cancelPicker;
  useEffect(() => {
    const elements = [input.current, captionsInput.current].filter((element): element is HTMLInputElement => !!element);
    const cancel = () => cancelPickerLatest.current();
    elements.forEach(element => element.addEventListener('cancel', cancel));
    return () => elements.forEach(element => element.removeEventListener('cancel', cancel));
  }, [!!project, owner, projectId]);
  const openPicker = async (type: 'media' | 'captions', target: 'main' | 'layer', accept?: string) => {
    if (locked.current || confirmation.current || !alive.current) return; try { settle(); } catch { return; }
    locked.current = true; engine.current?.pause(); setBusy('Escolhendo arquivo'); const token = workspace.epoch.current;
    picker.current = { token, type, target, at: position };
    try { await workspace.flush(); if (!scope(token) || !picker.current) { cancelPicker(); return; } const element = type === 'media' ? input.current : captionsInput.current; if (element) { if (accept) element.accept = accept; element.click(); } else cancelPicker(); }
    catch (cause) { cancelPicker(); if (alive.current) recordError(cause); }
  };
  const openImport = (target: 'main' | 'layer', accept = 'video/*,image/*,audio/*') => { void openPicker('media', target, accept); };
  const openRecorder = (mode: 'camera' | 'screen' | 'audio') => void external('Preparando gravação', async (token, signal) => { if (scope(token) && !signal.aborted) { recorderEntry.current = { token, at: position, mode }; setRecorder(mode); } });
  const reuse = (asset: StudioAsset, target: 'main' | 'layer') => { if (confirmation.current || locked.current) return; settle(); const id = crypto.randomUUID(); apply(value => target === 'main' || !value.editing!.main.length ? addMainAsset(value, asset, id) : addLayerAsset(value, asset, Math.min(position, duration - .1), { itemId: id })); setSelected(id); };
  const makeText = (caption = false) => { if (confirmation.current || locked.current) return; const id = crypto.randomUUID(); try { settle(); } catch { return; } apply(value => caption ? addCaption(value, 'Sua legenda', Math.min(position, Math.max(0, duration - .1)), 3, { itemId: id }) : addText(value, 'Seu texto', Math.min(position, Math.max(0, duration - .1)), 3, { itemId: id })); setSelected(id); setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-studio-text-input]')?.focus(), 0); };
  const draftPatch = (patch: StudioWebClipPatch) => {
    if (!selected || locked.current || confirmation.current || !workspace.current.current) return;
    setComparing(false);
    const old = pendingPatch.current?.id === selected ? pendingPatch.current.patch : {};
    const merged = { ...old, ...patch, ...(patch.rect ? { rect: { ...old.rect, ...patch.rect } } : {}), ...(patch.text ? { text: { ...old.text, ...patch.text } } : {}), ...(patch.grade ? { grade: { ...old.grade, ...patch.grade } } : {}) };
    try { const next = patchClip(workspace.current.current, selected, merged); pendingPatch.current = { id: selected, patch: merged }; setPreview(next); } catch (cause) { recordError(cause); }
  };
  const transcribe = (snapshot: StudioProject, token: number, signal: AbortSignal, onStage: (stage: string, progress?: number) => void = setBusy) =>
    transcribeStudioCaptions(snapshot, id => getAsset(owner, projectId, id), captionLanguage, signal, (stage, fraction) => {
      if (scope(token) && !signal.aborted) onStage(stage, fraction);
    });
  const generateCaptions = () => {
    if (!premium) return;
    setCaptionNotice('');
    void external('Preparando áudio da montagem', async (token, signal) => {
      const snapshot = workspace.current.current!;
      if (snapshot.editing!.layers.some(layer => layer.kind === 'caption' && layer.items.length)) return;
      const cues = await transcribe(snapshot, token, signal);
      if (!scope(token) || signal.aborted) return;
      const edited = addCaptionTrack(snapshot, cues, captionStyles[captionStyle].style);
      if (edited === snapshot) { setCaptionNotice('Nenhuma fala identificada no áudio da montagem.'); return; }
      workspace.apply(() => edited);
      setExportReady(false);
      await workspace.flush();
    });
  };
  const chosenGrade = { ...studioGrade(colorPreset), intensity: colorIntensity };
  const runClassEdit = () => {
    if (!premium) return;
    void external('Detectando pausas', async (token, signal) => {
      const snapshot = workspace.current.current!;
      const target = classEditTarget(snapshot);
      if (!target) return;
      const original = await getAsset(owner, projectId, target.asset.id);
      if (!scope(token) || signal.aborted) return;
      if (!original) throw new Error('O original deste trecho não está disponível neste navegador.');
      const { clip } = target;
      const pauses = await findStudioPauses(original, studioSeconds(clip.sourceStartTicks), studioSeconds(clip.sourceEndTicks), signal);
      if (!scope(token) || signal.aborted) return;
      let enhancement: Awaited<ReturnType<typeof analyzeStudioScene>> | undefined;
      if (!clip.enhancement) {
        setBusy('Ajustando a imagem');
        setProgress(.24);
        const current = compileStudioRecipe(snapshot);
        const analysis = await analyzeStudioScene(original, current.clips.find(value => value.id === clip.id)!, current.timebase, {
          signal, onProgress: value => { if (scope(token) && !signal.aborted) setProgress(.24 + .21 * value); },
        });
        enhancement = { ...analysis, strength: .35 };
      }
      if (!scope(token) || signal.aborted) return;
      let portrait: { version: 2; strength: number } | undefined;
      let portraitStatus: string | undefined;
      if (!clip.portrait && engine.current) {
        setBusy('Preparando retoque natural');
        setProgress(.48);
        try {
          await engine.current.preparePortrait(signal);
          portrait = { version: 2, strength: .25 };
          portraitStatus = 'Retoque leve aplicado';
        } catch {
          if (signal.aborted) return;
          portraitStatus = 'Retoque indisponível neste navegador';
        }
      }
      if (!scope(token) || signal.aborted) return;
      await engine.current?.seek(0);
      if (!scope(token) || signal.aborted) return;
      let edited = applyClassEdit(snapshot, clip.id, pauses, enhancement, portrait, chosenGrade);
      const finish = colorPreset === 'natural' ? [] : [`Filtro ${colorPresets.find(preset => preset.id === colorPreset)?.label} aplicado`];
      let retakes: StudioRetakeGroup[] = [];
      if (autoCaptions || reviewRetakes) {
        measuredCaptionProgress.current = 0;
        setProgress(.58);
        setBusy('Preparando áudio da montagem');
        try {
          const cues = await transcribe(edited, token, signal, (stage, fraction = 0) => {
            setBusy(stage);
            const [start, end] = stage === 'Transcrevendo áudio' ? [.78, .93] : [.67, .77];
            measuredCaptionProgress.current = Math.max(measuredCaptionProgress.current, start + (end - start) * Math.min(1, Math.max(0, fraction)));
            setProgress(value => Math.max(value, start));
          });
          if (!scope(token) || signal.aborted) return;
          if (reviewRetakes) {
            retakes = findStudioRetakes(cues);
            if (!retakes.length) finish.push(cues.length ? 'Sem repetições semelhantes detectadas' : 'Sem fala para comparar');
          }
          if (autoCaptions) {
            const captioned = addCaptionTrack(edited, cues, captionStyles[captionStyle].style);
            finish.push(captioned === edited ? 'Nenhuma fala identificada' : 'Legendas geradas');
            edited = captioned;
          }
        } catch {
          if (!scope(token) || signal.aborted) return;
          finish.push(autoCaptions && reviewRetakes ? 'Legendas e revisão de repetições indisponíveis' : autoCaptions ? 'Legendas indisponíveis' : 'Revisão de repetições indisponível');
        }
      }
      setBusy('Salvando a edição');
      setProgress(.94);
      workspace.apply(() => edited);
      setSelected(clip.id);
      setComparing(false);
      setExportReady(false);
      const saved = await workspace.flush();
      if (!scope(token) || !saved) return;
      setBusy('Edição concluída');
      setProgress(1);
      // Give the last portion of the border time to reach 100% before revealing the result.
      await new Promise(resolve => setTimeout(resolve, 320));
      if (scope(token)) setClassEditResults([{ key: classEditReviewKey(saved.editing), cuts: pauses.length, imageAdjusted: !!enhancement, portraitStatus, retakes, finishStatus: finish.join(' · '), removed: pauses.reduce((total, pause) => total + pause.end - pause.start, 0) }]);
    }, false, true);
  };
  const keepRetake = (group: StudioRetakeGroup, chosen: StudioRetakeGroup[number]) => {
    const result = classEditResult;
    if (!result) return;
    void external('Removendo takes repetidos', async (token, signal) => {
      const snapshot = workspace.current.current;
      if (!snapshot || classEditReviewKey(snapshot.editing) !== result.key || !scope(token) || signal.aborted) return;
      const cuts = group.filter(attempt => attempt !== chosen);
      const next = removeClassEditRetakes(snapshot, cuts);
      const shift = (time: number) => time - cuts.reduce((removed, cut) => removed + Math.max(0, Math.min(time, cut.end) - cut.start), 0);
      const retakes = result.retakes.filter(other => other !== group).map(other => other.map(attempt => ({
        ...attempt, start: shift(attempt.start), end: shift(attempt.end),
      })));
      workspace.apply(() => next);
      setSelection([]);
      setExportReady(false);
      const saved = await workspace.flush();
      if (saved && scope(token)) setClassEditResults(results => [{ ...result, key: classEditReviewKey(saved.editing), retakes,
        finishStatus: [result.finishStatus, `${cuts.length} ${cuts.length === 1 ? 'take removido' : 'takes removidos'}`].filter(Boolean).join(' · ') }, ...results.slice(0, 79)]);
    });
  };
  const improveScene = () => {
    if (!selected) return;
    const id = selected;
    void external('Analisando sua cena', async (token, signal) => {
      const current = compileStudioRecipe(workspace.current.current!), clip = current.clips.find(value => value.id === id);
      if (!clip?.assetId || !['video', 'image'].includes(clip.kind)) throw new Error('Selecione uma imagem ou um vídeo para melhorar a cena.');
      const original = await getAsset(owner, projectId, clip.assetId);
      if (!scope(token) || signal.aborted) return;
      if (!original) throw new Error('O original deste trecho não está disponível neste navegador.');
      const enhancement = await analyzeStudioScene(original, clip, current.timebase, { signal, onProgress: value => { if (scope(token) && !signal.aborted) setProgress(value); } });
      if (!scope(token) || signal.aborted) return;
      workspace.apply(value => patchClip(value, id, { enhancement })); setComparing(false); setExportReady(false); await workspace.flush();
    });
  };
  const applySignature = () => {
    if (!selected) return;
    const id = selected;
    void external('Preparando Assinatura Classfy', async (token, signal) => {
      const current = compileStudioRecipe(workspace.current.current!), clip = current.clips.find(value => value.id === id), renderer = engine.current;
      if (!clip?.assetId || !['video', 'image'].includes(clip.kind)) throw new Error('Selecione uma cena com o creator para aplicar a assinatura.');
      if (!renderer) throw new Error('Aguarde a prévia ficar pronta para destacar o creator.');
      await renderer.prepareSignature(signal);
      if (!scope(token) || signal.aborted) return;
      const original = await getAsset(owner, projectId, clip.assetId);
      if (!scope(token) || signal.aborted) return;
      if (!original) throw new Error('O original deste trecho não está disponível neste navegador.');
      setBusy('Criando sua cena Classfy');
      const signature = await analyzeStudioSignature(original, clip, current.timebase, { signal, measure: renderer.measureSignature,
        onProgress: value => { if (scope(token) && !signal.aborted) setProgress(value); } });
      if (!scope(token) || signal.aborted) return;
      workspace.apply(value => patchClip(value, id, { signature, enhancement: null })); setComparing(false); setExportReady(false); await workspace.flush();
    });
  };
  const enablePortrait = () => {
    if (!selected) return;
    const id = selected;
    void external('Preparando retoque natural', async (token, signal) => {
      if (!engine.current) throw new Error('Aguarde a prévia ficar pronta para ativar o retoque.');
      await engine.current.preparePortrait(signal);
      if (!scope(token) || signal.aborted) return;
      workspace.apply(value => patchClip(value, id, { portrait: { version: 2, strength: .45 } })); setComparing(false); setExportReady(false); await workspace.flush();
    });
  };
  const atCursor = (clip: NonNullable<typeof selectedClip>, time: number) =>
    time >= studioSeconds(clip.startTicks) + .1 && time <= studioSeconds(clip.startTicks + clip.durationTicks) - .1;
  const canSplit = !!selectedClip && atCursor(selectedClip, position);
  const splitAt = (time: number, id?: string) => {
    if (confirmation.current || locked.current) return;
    const targets = recipe?.clips.filter(clip => atCursor(clip, time) &&
      (id ? clip.id === id : selection.length ? selection.includes(clip.id) : clip.zIndex === 0));
    if (!targets?.length) return;
    try { settle(); } catch { return; }
    apply(value => targets.reduce((next, clip) => clip.zIndex === 0
      ? splitMainClip(next, clip.id, time) : splitLayerClip(next, clip.id, time), value));
  };
  const split = () => { if (selected && canSplit) splitAt(position, selected); };
  const trimAtCursor = (edge: 'start' | 'end') => {
    const clip = selectedClip ?? (!selection.length ? recipe?.clips.find(item => item.zIndex === 0 &&
      position > studioSeconds(item.startTicks) && position < studioSeconds(item.startTicks + item.durationTicks)) : undefined);
    if (!clip) return;
    const start = studioSeconds(clip.startTicks), end = studioSeconds(clip.startTicks + clip.durationTicks);
    if (position <= start || position >= end || (edge === 'start' ? end - position : position - start) < .1) return;
    try { settle(); } catch { return; }
    apply(value => {
      if (clip.zIndex > 0) return trimLayerClip(value, clip.id, edge === 'start' ? position : start, edge === 'end' ? position : end);
      if (clip.kind === 'image') return trimMainClip(value, clip.id, 0, edge === 'start' ? end - position : position - start);
      const sourcePosition = studioSeconds(clip.sourceStartTicks) + (position - start) * (clip.playbackRate ?? 1);
      return trimMainClip(value, clip.id, edge === 'start' ? sourcePosition : studioSeconds(clip.sourceStartTicks),
        edge === 'end' ? sourcePosition : studioSeconds(clip.sourceEndTicks));
    });
    if (edge === 'start' && clip.zIndex === 0) void seek(start);
  };
  const remove = () => {
    if (confirmation.current || locked.current || !selection.length) return;
    try { settle(); } catch { return; }
    const targets = recipe?.clips.filter(clip => selection.includes(clip.id)).sort((a, b) => b.zIndex - a.zIndex) ?? [];
    apply(value => targets.reduce((next, clip) => removeClip(next, clip.id), value));
  };
  const toggle = () => { if (locked.current || confirmation.current || recorder) return; try { settle(); } catch { return; } if (playing) engine.current?.pause(); else void engine.current?.play().catch(recordError); };
  const exportFile = (publication: boolean) => void external('Exportando arquivo', async (token, signal) => {
    const snapshot = workspace.current.current!; let file: File | null = null;
    try {
      const cached = await getExport(owner, projectId, snapshot.revision);
      if (!scope(token) || signal.aborted) return;
      file = cached ?? await exportStudioProject(snapshot, assetId => getAsset(owner, projectId, assetId), { signal, onProgress: value => { if (scope(token) && !signal.aborted) setProgress(value); } });
      if (!scope(token) || signal.aborted) return;
      if (!cached) await storeExport(owner, projectId, file, snapshot.revision);
      if (!scope(token) || signal.aborted) return;
      setProgress(1); setExportReady(true); setExportMenu(false);
      if (publication) navigate(`/studio/upload?type=${snapshot.kind}&studioProject=${encodeURIComponent(projectId)}&studioRevision=${snapshot.revision}`);
      else { const stored = await getExport(owner, projectId, snapshot.revision); if (!scope(token) || !stored) return; const url = URL.createObjectURL(stored), link = document.createElement('a'); link.href = url; link.download = stored.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    } finally { if (file) await releaseStudioExport(file); }
  });
  const chooseOutput = (patch: Partial<StudioOutputSelection>) => {
    if (confirmation.current || locked.current) return;
    try { settle(); } catch { return; }
    apply(value => withStudioTakes({ ...value, editing: withStudioOutputSelection(value.editing!, { resolution: 'hd', frameRate: 30, ...value.editing!.output.selection, ...patch }) }));
  };
  const close = async () => { if (locked.current || confirmation.current || recorder) return; try { settle(); const token = workspace.epoch.current; await workspace.flush(); if (scope(token)) navigate('/studio/projects'); } catch (cause) { recordError(cause); } };
  useStudioExitGuard({ enabled: !!project,
    hasRisk: () => workspace.hasPendingChanges() || !!pendingPatch.current || locked.current || !!recorder || !!confirmation.current,
    prepare: async () => {
      if (confirmation.current) return false;
      // The response authorizes only this exact operation. A completed import,
      // replaced picker or recorder must never let a stale answer cancel new work.
      const token = workspace.epoch.current, abort = controller.current, picking = picker.current, recording = recorderEntry.current, wasLocked = locked.current;
      const reservation = {}; confirmation.current = reservation; setExitPreparing(true);
      let authorized = false;
      try {
        if (wasLocked || recording) {
          const approved = await confirm({
            title: recording ? 'Descartar a gravação e sair?' : 'Cancelar a operação e sair?',
            description: recording ? 'O trecho ainda não usado será descartado. Suas edições e os originais já salvos permanecem neste navegador.' : 'A operação em andamento será cancelada. Suas edições e os originais já salvos permanecem neste navegador.',
            confirmLabel: recording ? 'Descartar e sair' : 'Cancelar e sair', cancelLabel: 'Continuar no editor', tone: 'danger', icon: 'exit',
          });
          if (!approved) return false;
        }
        if (!scope(token) || confirmation.current !== reservation || controller.current !== abort || picker.current !== picking || recorderEntry.current !== recording || locked.current !== wasLocked) return false;
        settle(); abort?.abort(); cancelPicker(); engine.current?.pause();
        await workspace.flush();
        authorized = scope(token) && confirmation.current === reservation && recorderEntry.current === recording && picker.current === null && (controller.current === null || controller.current === abort && !!abort?.signal.aborted);
        return authorized;
      } catch (cause) { if (scope(token)) recordError(cause); return false; }
      // Keep the approved exit reserved until the actual router POP/unmount,
      // so a new REC cannot begin between history.go() and its native event.
      finally { if (!authorized && confirmation.current === reservation) { confirmation.current = null; if (workspace.isCurrent(token) && alive.current) setExitPreparing(false); } }
    },
  });
  const runShortcut = (command: StudioShortcut) => {
    if (blocked || recorder || locked.current || confirmation.current) return;
    const clips = recipe?.clips ?? [];
    const frame = (recipe?.output.frameRateDenominator ?? 1) / (recipe?.output.frameRateNumerator ?? 30);
    const cursor = studioTicks(position);
    const selectedTypes = new Set(clips.filter(clip => selection.includes(clip.id)).map(clip => clip.kind));
    switch (command) {
      case 'split': splitAt(position); break;
      case 'trimStart': case 'trimEnd': trimAtCursor(command === 'trimStart' ? 'start' : 'end'); break;
      case 'select': case 'trim': case 'blade': case 'hand': setTimelineTool(command); break;
      case 'annotation': if (duration >= .1) makeText(); break;
      case 'remove': remove(); break;
      case 'clear': setTimelineTool('select'); select(undefined); break;
      case 'clearAll': select(undefined); break;
      case 'selectAll': selectMany(clips.map(clip => clip.id)); break;
      case 'similar': selectMany(clips.filter(clip => selectedTypes.has(clip.kind)).map(clip => clip.id)); break;
      case 'selectAt': case 'selectAfter': case 'selectBefore':
        selectMany(clips.filter(clip => command === 'selectAt' ? clip.startTicks <= cursor && cursor < clip.startTicks + clip.durationTicks
          : command === 'selectAfter' ? clip.startTicks >= cursor : clip.startTicks < cursor).map(clip => clip.id)); break;
      case 'nextClip': case 'previousClip': {
        const next = command === 'nextClip';
        const points = [...new Set(clips.flatMap(clip => [clip.startTicks, clip.startTicks + clip.durationTicks]))].sort((a, b) => next ? a - b : b - a);
        const point = points.find(at => next ? at > cursor : at < cursor);
        if (point !== undefined) void seek(studioSeconds(point));
        break;
      }
      case 'nextFrame': case 'previousFrame': case 'nextTen': case 'previousTen':
        void seek(position + frame * (command.startsWith('next') ? 1 : -1) * (command.endsWith('Ten') ? 10 : 1)); break;
      case 'play': shuttle.current = 0; toggle(); break;
      case 'restart': void seek(0).then(() => engine.current?.play()).catch(recordError); break;
      case 'loop': {
        const next = !loopRef.current;
        loopRef.current = next; setLoop(next); engine.current?.setLoop?.(next);
        break;
      }
      case 'reverse': case 'forward': {
        const direction = command === 'reverse' ? -1 : 1;
        const previous = playing ? shuttle.current : 0;
        const speed = Math.sign(previous) === direction ? Math.min(4, Math.abs(previous) * 2) : 1;
        shuttle.current = direction * speed;
        void engine.current?.play(shuttle.current).catch(recordError);
        break;
      }
      case 'pause': shuttle.current = 0; engine.current?.pause(); break;
      case 'undo': case 'redo':
        try { settle(); } catch { return; }
        if (command === 'undo') workspace.undo(); else workspace.redo(); break;
      case 'group': case 'ungroup':
        if (selection.length) apply(value => groupStudioClips(value, selection, command === 'group')); break;
      case 'copy': case 'cut': case 'paste': case 'duplicate': {
        if (command !== 'paste' && !selection.length) break;
        try { settle(); } catch { return; }
        const snapshot = workspace.current.current;
        if (!snapshot) break;
        if (command === 'copy' || command === 'cut') {
          clipboard.current = copyStudioClips(snapshot, selection);
          if (command === 'cut') remove();
        } else if (command === 'duplicate') {
          const ids = new Map(selection.map(id => [id, crypto.randomUUID()]));
          apply(value => selection.reduce((draft, id) => duplicateClip(draft, id, ids.get(id)!), value));
          setSelection([...ids.values()]);
        } else if (clipboard.current && Number.isFinite(clipboard.current.start)) {
          const copied = clipboard.current, ids = new Map([...copied.main, ...copied.layers.flatMap(layer => layer.items)].map(clip => [clip.id, crypto.randomUUID()]));
          apply(value => pasteStudioClips(value, copied, position, ids));
          setSelection([...ids.values()]);
        }
        break;
      }
      case 'timelineIn': case 'timelineOut': case 'timelineFit':
        setTimelineZoom({ direction: command === 'timelineIn' ? 1 : command === 'timelineOut' ? -1 : 0 }); break;
      case 'previewIn': case 'previewOut':
        setPreviewZoom(value => Math.max(.25, Math.min(4, (value === 'actual' ? 1 : value) * (command === 'previewIn' ? 1.25 : .8)))); break;
      case 'previewFit': setPreviewZoom(1); break;
      case 'previewActual': setPreviewZoom('actual'); break;
      case 'guides': setPreviewGuides(value => !value); break;
      case 'search': setShortcutsOpen(true); break;
      case 'audio': case 'sounds': case 'transitions': case 'adjustments': setTab(command); break;
      case 'filters': setTab('adjustments'); break;
      case 'voice': setTab('audio'); if (duration) openRecorder('audio'); break;
      case 'import': openImport('main'); break;
      case 'export': if (project?.editing?.main.length) setExportMenu(value => !value); break;
    }
  };
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.isComposing || event.getModifierState('AltGraph') ||
        target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"]') ||
        blocked || recorder) return;
      const command = studioShortcutFor(event);
      if (!command || (command === 'play' || command === 'restart') && target instanceof Element && target.closest('button, summary, a')) return;
      event.preventDefault();
      if (!event.repeat || ['nextFrame', 'previousFrame', 'nextTen', 'previousTen', 'timelineIn', 'timelineOut'].includes(command)) runShortcut(command);
    };
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
  });
  if (workspace.loading) return <><div className="se-loading"><Loader2 className="se-spin" size={24} /><span>Abrindo projeto…</span></div>{dialog}</>;
  if (!project || !effective || !recipe) return <><div className="se-loading"><p role="alert">{workspace.error ?? 'Projeto indisponível.'}</p><button className="se-button" onClick={() => navigate('/studio/projects')}>Voltar aos projetos</button></div>{dialog}</>;
  const classEditAvailable = !!classEditTarget(project);
  const hasCaptions = project.editing!.layers.some(layer => layer.kind === 'caption' && layer.items.length);
  const hasAudio = recipe.clips.some(clip => clip.gain > 0 && (clip.kind === 'audio' ||
    clip.kind === 'video' && recipe.assets.find(asset => asset.id === clip.assetId)?.hasAudio !== false));
  const colorTargets = selection.length > 1
    ? recipe.clips.filter(clip => selection.includes(clip.id) && (clip.kind === 'video' || clip.kind === 'image')).map(clip => clip.id)
    : selectedClip && (selectedClip.kind === 'video' || selectedClip.kind === 'image')
    ? [selectedClip.id]
    : project.editing!.main.filter(clip => project.editing!.assets.some(asset => asset.id === clip.assetId && asset.kind !== 'audio')).map(clip => clip.id);
  const premiumMessage = premiumLoading ? 'Verificando seu plano…' : premiumError || <Link to="/planos">Conhecer o Premium</Link>;
  return <div className="se-editor"><header className="se-editor-header"><div className="se-editor-brand"><button className="se-icon" disabled={blocked || !!recorder} aria-label="Voltar aos projetos" onClick={() => void close()}><ArrowLeft size={18} /></button><img src="/brand/classfy-icone-principal.svg" alt="Classfy" /><span>Studio</span><span className="se-header-divider" /><button className="se-project-title" disabled={blocked} onClick={() => { setTitle(project.title); setRename(true); }}>{project.title || 'Projeto sem título'}<ChevronDown size={13} /></button></div><div className="se-editor-actions"><span className={`se-save-state ${workspace.error ? 'error' : ''}`}>{workspace.saving ? <Loader2 size={12} className="se-spin" /> : <Check size={12} />}{workspace.error ? 'Falha ao salvar' : workspace.saving ? 'Salvando…' : 'Salvo neste navegador'}</span><button className="se-icon" disabled={!workspace.canUndo || blocked} aria-label="Desfazer" onClick={() => { if (confirmation.current) return; settle(); workspace.undo(); }}><Undo2 size={18} /></button><button className="se-icon" disabled={!workspace.canRedo || blocked} aria-label="Refazer" onClick={() => { if (confirmation.current) return; settle(); workspace.redo(); }}><Redo2 size={18} /></button><button className="se-button se-class-edit-button" aria-disabled={premiumLoading || (premium && !classEditAvailable) || blocked || !!recorder}
      title={!premium ? 'Class Edit Premium' : !classEditAvailable ? 'Use um único vídeo com áudio, sem camadas ou efeitos de tempo e assinatura.' : undefined}
      onClick={() => { if (blocked || recorder || premiumLoading) return; if (!premium) { setTab('adjustments'); return; } if (classEditAvailable) runClassEdit(); }}><Scissors size={15} />Class Edit</button><button className="se-button se-primary" disabled={blocked || !!recorder || !project.editing!.main.length} onClick={() => setExportMenu(!exportMenu)}><Upload size={15} /> Exportar<ChevronDown size={12} /></button></div>
      {exportMenu && <div className="se-export-menu"><p>{recipe.output.width} × {recipe.output.height} · {Number((recipe.output.frameRateNumerator / recipe.output.frameRateDenominator).toFixed(2))} FPS · SDR</p>
        <label className="se-field">Resolução<select aria-label="Resolução de exportação" disabled={blocked || !capabilities} value={project.editing!.output.selection?.resolution ?? 'original'} onChange={e => chooseOutput({ resolution: e.target.value as StudioOutputSelection['resolution'] })}><option value="original">Original</option>{(['720p', 'hd', '2k', '4k'] as const).map(value => <option key={value} value={value} disabled={!capabilities?.profiles.some(profile => profile.resolution === value)}>{value === 'hd' ? '1080p' : value === '720p' ? '720p' : value === '2k' ? '2K · 1440p' : '4K · 2160p'}</option>)}</select></label>
        <label className="se-field">Cadência<select aria-label="FPS de exportação" disabled={blocked || !capabilities} value={project.editing!.output.selection?.frameRate ?? 30} onChange={e => chooseOutput({ frameRate: e.target.value === 'original' ? 'original' : +e.target.value as 24 | 30 | 60 })}><option value="original">Original</option>{([24, 30, 60] as const).map(value => <option key={value} value={value} disabled={!capabilities?.profiles.some(profile => profile.frameRate === value)}>{value} FPS</option>)}</select></label>
        {capabilities?.reason && <p role="status">{capabilities.reason}</p>}<button disabled={!capabilities?.available && project.kind !== 'podcast'} onClick={() => exportFile(false)}><Download size={16} />Baixar arquivo</button><button disabled={!capabilities?.available && project.kind !== 'podcast'} onClick={() => exportFile(true)}><Upload size={16} />Preparar publicação</button></div>}
    </header>
    {(error || workspace.error) && <div className="se-editor-error" role="alert"><span>{workspace.error || error}</span>{workspace.error && <button onClick={() => void workspace.flush().catch(recordError)}>Tentar salvar</button>}<button className="se-icon" aria-label="Fechar mensagem" onClick={() => setError(null)}><X size={13} /></button></div>}
    {classEditResult && <div className="se-class-edit-result" role="status">
      {classEditResult.cuts === 0 ? 'Nenhum corte aplicado · Sem pausas de pelo menos 0,35 s com queda clara no áudio'
        : `${classEditResult.cuts === 1 ? '1 pausa encurtada' : `${classEditResult.cuts} pausas encurtadas`} · ${classEditResult.removed.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s removidos`}{classEditResult.imageAdjusted ? ' · Ajuste leve de imagem aplicado' : ''}{classEditResult.portraitStatus ? ` · ${classEditResult.portraitStatus}` : ''}{classEditResult.finishStatus ? ` · ${classEditResult.finishStatus}` : ''}
      {!!classEditResult.retakes.length && <details className="se-retake-review">
        <summary>Revisar possíveis takes repetidos ({classEditResult.retakes.length})</summary>
        <div className="se-retake-list">{classEditResult.retakes.map(group => {
          const suggested = group.reduce((best, attempt) => attempt.text.split(/\s+/).length >= best.text.split(/\s+/).length ? attempt : best);
          return <div key={group[0].start} className="se-retake-group">
            {group.map(attempt => <div className="se-retake-option" key={attempt.start}>
              <button className="se-button" title={attempt.text} disabled={blocked || !!recorder}
                onClick={() => void seek(attempt.start, attempt.end)}><Play size={13} />Ouvir <time>{formatStudioEditorTime(attempt.start)}</time><span>{attempt.text}</span>{attempt === suggested && <small>Sugestão</small>}</button>
              <button className="se-button" disabled={blocked || !!recorder} aria-label={`Manter take de ${formatStudioEditorTime(attempt.start)} e remover os demais`}
                onClick={() => keepRetake(group, attempt)}>Manter este</button>
            </div>)}
          </div>;
        })}</div>
      </details>}
    </div>}
    <ResizablePanelGroup direction="vertical" className="se-workspace-panels"><ResizablePanel defaultSize={67} minSize={35}><div className="se-library">
      <nav aria-label="Ferramentas do editor">{tools.map(({ id, label, Icon }) => <button key={id} aria-pressed={tab === id}
        className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={18} /><span>{label}</span></button>)}</nav>
      <ResizablePanelGroup direction="horizontal" className="se-tools-layout">
      {tab && <ResizablePanel id="studio-tool-panel" order={1} defaultSize={20} minSize={14} maxSize={33}><section className="se-library-content" aria-labelledby="se-tool-heading">
        <header className="se-tool-heading"><h2 id="se-tool-heading">{tools.find(tool => tool.id === tab)?.label}</h2><button className="se-icon" aria-label="Fechar painel de ferramentas" title="Fechar painel"
          onClick={() => { setTab(null); document.querySelector<HTMLButtonElement>('.se-library nav button.active')?.focus(); }}><X size={16} /></button></header>
        {tab === 'media' && <><button className="se-button se-primary se-wide" disabled={blocked || !!recorder} onClick={() => openImport('main')}><Plus size={16} />Importar arquivos</button><div className="se-capture-buttons"><button className="se-button" disabled={blocked} onClick={() => openRecorder('camera')}><Video size={16} />Câmera</button><button className="se-button" disabled={blocked} onClick={() => openRecorder('screen')}><Monitor size={16} />Tela</button></div><div className="se-asset-grid">{project.editing!.assets.filter(a => a.kind !== 'audio').map(asset => <article key={asset.id}><button className="se-asset-thumb" disabled={blocked} aria-label={`Adicionar ${asset.name} à montagem`} onClick={() => reuse(asset, 'main')}>{thumbnails[asset.id] ? <img src={thumbnails[asset.id]} alt="" /> : <Film size={23} />}<span>{asset.kind === 'image' ? 'Imagem' : formatStudioEditorTime(studioSeconds(asset.durationTicks))}</span></button><p title={asset.name}>{asset.name}</p><div className="se-asset-actions"><button className="se-asset-overlay" disabled={blocked || !duration} onClick={() => reuse(asset, 'layer')}>Sobrepor <Plus size={12} /></button><button className="se-asset-original" aria-label={`Baixar original de ${asset.name}`} title="Baixar original" disabled={blocked || !!recorder || originalDownload?.id === asset.id && originalDownload.status !== 'retry'} onClick={() => downloadOriginal(asset)}>
          {originalDownload?.id === asset.id && originalDownload.status === 'preparing' ? <><Loader2 className="se-spin" size={13} />Preparando download…</>
            : originalDownload?.id === asset.id && originalDownload.status === 'started' ? <><Check size={13} />Download iniciado</>
            : <><Download size={13} />{originalDownload?.id === asset.id ? 'Baixar novamente' : 'Baixar original'}</>}
        </button><span className="se-sr" role="status">{originalDownload?.id === asset.id && originalDownload.status === 'started' ? 'Download iniciado no navegador.' : ''}</span></div></article>)}</div>{!project.editing!.assets.length && <p className="se-muted se-library-empty">Arraste arquivos para a prévia ou importe seus originais.</p>}</>}
        {tab === 'text' && <><button className="se-button se-primary se-wide" disabled={blocked || !duration} onClick={() => makeText()}><Type size={17} />Adicionar texto</button><div className="se-text-examples"><span>Aa</span><p>Títulos, tópicos e destaques editáveis.</p></div></>}
        {tab === 'captions' && <div className="se-tool-stack">
          <label className="se-field">Idioma falado<select disabled={blocked} value={captionLanguage} onChange={event => setCaptionLanguage(event.target.value)}>
            <option value="">Detectar automaticamente</option><option value="portuguese">Português</option><option value="english">Inglês</option><option value="spanish">Espanhol</option>
          </select></label>
          <fieldset className="se-tool-choices" disabled={blocked}><legend>Estilo da legenda</legend><div>
            {captionStyles.map(({ label }, index) => <button type="button" key={label} aria-pressed={captionStyle === index} onClick={() => setCaptionStyle(index)}><span className={`se-caption-sample style-${index}`}>Aa</span>{label}</button>)}
          </div></fieldset>
          <button className="se-button se-primary se-wide" disabled={blocked || !!recorder || !premium || !hasAudio || hasCaptions} onClick={generateCaptions}><Sparkles size={15} />Gerar legendas</button>
          <p className="se-muted">{hasCaptions ? 'Remova as legendas da montagem para gerar novamente.' : 'Usa o áudio da montagem. O modelo de voz é baixado no primeiro uso.'}</p>
          {!premium && <p className="se-tool-plan">Geração automática Premium · {premiumMessage}</p>}
          {captionNotice && <p role="status">{captionNotice}</p>}
          <div className="se-tool-actions">
            <button className="se-button" disabled={blocked || !duration} onClick={() => void openPicker('captions', 'layer')}>Importar SRT</button>
            <button className="se-button" disabled={blocked || duration < .1} onClick={() => makeText(true)}>Adicionar legenda</button>
          </div>
        </div>}
        {tab === 'adjustments' && <div className="se-tool-stack">
          <fieldset className="se-tool-choices" disabled={blocked}><legend>Filtro de cor</legend><div>
            {colorPresets.map(({ id, label }) => <button type="button" key={id} aria-pressed={colorPreset === id} onClick={() => setColorPreset(id)}><span className={`se-color-sample ${id}`} aria-hidden="true" />{label}</button>)}
          </div></fieldset>
          <label className="se-tool-range"><span>Intensidade <output>{Math.round(colorIntensity * 100)}%</output></span><input type="range" min="0" max="1" step=".01" value={colorIntensity} disabled={blocked || colorPreset === 'natural'} onChange={event => setColorIntensity(+event.target.value)} /></label>
          <button className="se-button se-wide" disabled={blocked || !!recorder || !colorTargets.length} onClick={() => {
            try { settle(); } catch { return; }
            apply(value => colorTargets.reduce((next, id) => patchClip(next, id, { grade: chosenGrade, effect: colorPreset }), value)); setComparing(false);
          }}>{colorTargets.length === 1 ? 'Aplicar filtro ao clipe' : selection.length > 1 ? 'Aplicar filtro à seleção' : 'Aplicar filtro à faixa principal'}</button>
          <div className="se-tool-class-edit">
            <h3><Sparkles size={15} />Class Edit Premium</h3>
            {premium ? <>
              <label><input type="checkbox" checked={autoCaptions} disabled={blocked} onChange={event => setAutoCaptions(event.target.checked)} /> Gerar legendas com o Class Edit</label>
              <label><input type="checkbox" checked={reviewRetakes} disabled={blocked} onChange={event => setReviewRetakes(event.target.checked)} /> Sinalizar tomadas repetidas</label>
              <button className="se-button se-primary se-wide" disabled={blocked || !!recorder || !classEditAvailable} onClick={runClassEdit}>Aplicar Class Edit</button>
              {!classEditAvailable && <p className="se-muted">Comece com um único vídeo com áudio e sem camadas.</p>}
            </> : <p className="se-tool-plan">{premiumMessage}</p>}
          </div>
        </div>}
        {tab === 'sounds' && <div className="se-tool-stack">{studioSounds.map(sound => <button key={sound.id} className="se-button"
          disabled={blocked || duration - position < .1} onClick={() => void importFiles([studioSoundFile(sound)], 'layer', position)}>
          <Music2 size={15} />Adicionar {sound.name.toLowerCase()}
        </button>)}</div>}
        {tab === 'transitions' && <div className="se-tool-stack">
          {!selectedClip && <p>Selecione um clipe para aplicar uma transição suave.</p>}
          {(['entrada', 'saída', 'entrada e saída', 'remover'] as const).map(style => <button key={style} className="se-button"
            disabled={blocked || !selectedClip || selectedClip.kind === 'audio'} onClick={() => {
              if (!selectedClip) return;
              try { settle(); } catch { return; }
              const fade = Math.min(studioTicks(.35), Math.floor(selectedClip.durationTicks / 2));
              apply(value => patchClip(value, selectedClip.id, {
                ...(style !== 'saída' ? { fadeInTicks: style === 'remover' ? 0 : style === 'entrada' ? Math.min(fade, selectedClip.durationTicks - selectedClip.fadeOutTicks) : fade } : {}),
                ...(style !== 'entrada' ? { fadeOutTicks: style === 'remover' ? 0 : style === 'saída' ? Math.min(fade, selectedClip.durationTicks - selectedClip.fadeInTicks) : fade } : {}),
              }));
            }}>{style === 'remover' ? 'Remover transição' : `Fade de ${style}`}</button>)}
        </div>}
        {tab === 'audio' && <><button className="se-button se-primary se-wide" disabled={blocked} onClick={() => openImport('layer', 'audio/*')}><Music2 size={17} />Importar áudio</button><button className="se-button se-wide" disabled={blocked || !duration} onClick={() => openRecorder('audio')}><Mic size={17} />Gravar narração</button><div className="se-audio-library">{project.editing!.assets.filter(a => a.kind === 'audio').map(asset => <button key={asset.id} disabled={blocked} onClick={() => reuse(asset, 'layer')}><Mic size={19} /><span>{asset.name}<small>{formatStudioEditorTime(studioSeconds(asset.durationTicks))}</small></span><Plus size={14} /></button>)}</div></>}
      </section></ResizablePanel>}{tab && <ResizableHandle className="se-resize-handle" />}
      <ResizablePanel id="studio-preview-panel" order={2} defaultSize={tab ? 57 : 77} minSize={25}><main className="se-preview-area" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!locked.current && !confirmation.current && e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files), 'main'); }}><div className="se-preview-label"><span>{comparing ? 'Original · trecho selecionado' : 'Prévia'}</span><span>{project.kind === 'short' ? '9:16' : project.kind === 'podcast' ? 'Áudio' : '16:9'}</span></div>
        <StudioDesktopCanvas zoom={previewZoom} showGuides={previewGuides} project={effective} selectedId={selected} position={position} disabled={blocked || !!recorder} canvasRef={canvas} onSelect={select} onEditText={id => { select(id); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-studio-text-input]')?.focus()); }} onBegin={() => { if (confirmation.current) return; settle(); engine.current?.pause(); }} onPreview={value => { if (!confirmation.current) setPreview(value); }} onCommit={apply} />
        {renderLoading && <div className="se-preview-loading"><Loader2 size={20} className="se-spin" /></div>}
        {!duration && <div className="se-first-media"><Film size={31} strokeWidth={1} /><p>Comece com seu primeiro arquivo</p><button className="se-button" onClick={() => openImport('main')}>Importar mídia</button></div>}
        <div className="se-transport"><button className="se-icon" aria-label={playing ? 'Pausar montagem' : 'Reproduzir montagem'} disabled={blocked || !!recorder || !duration} onClick={toggle}>{playing ? <Pause size={20} /> : <Play size={20} />}</button><span>{formatStudioEditorTime(position)}<i>/</i>{formatStudioEditorTime(duration)}</span><button className="se-icon" aria-label="Dividir no cursor" disabled={!canSplit || blocked} onClick={split}><Scissors size={17} /></button></div>
      </main></ResizablePanel><ResizableHandle className="se-resize-handle" /><ResizablePanel id="studio-inspector-panel" order={3} defaultSize={23} minSize={18} maxSize={35}><StudioDesktopInspector comparing={comparing} onCompare={() => { try { settle(); engine.current?.pause(); setComparing(value => !value); } catch { /* Preserve draft on save failure. */ } }} onSignature={engine.current ? applySignature : undefined} onEnhance={improveScene} onPortrait={enablePortrait} clip={selectedClip} disabled={blocked || !!recorder} canSplit={canSplit} outputHeight={recipe.output.height} onDraft={draftPatch} onCommit={() => { try { settle(); } catch { /* keep error visible */ } }} onDuplicate={() => { if (selected) { settle(); apply(value => duplicateClip(value, selected)); } }} onRemove={remove} onSplit={split} /></ResizablePanel>
    </ResizablePanelGroup></div></ResizablePanel><ResizableHandle className="se-resize-handle" /><ResizablePanel defaultSize={33} minSize={20} maxSize={65}><StudioDesktopTimeline zoomCommand={timelineZoom} loop={loop} onToggleLoop={() => runShortcut('loop')} shortcuts={<StudioShortcutPanel open={shortcutsOpen} onOpen={setShortcutsOpen} onAction={runShortcut} />} project={effective} position={position} playing={playing} selectedIds={selection} tool={timelineTool} onTool={setTimelineTool} onSelectMany={selectMany} onBlade={splitAt} disabled={blocked || !!recorder} thumbnails={thumbnails} waveforms={waveforms} onSelect={select} onSeek={value => void seek(value)} onPreview={value => { if (confirmation.current) return; engine.current?.pause(); setPreview(value); }} onCommit={apply} onAdd={() => openImport('main')} onMainMute={() => apply(value => setMainMuted(value, !value.editing!.mainMuted))} onLayerHide={id => apply(value => setLayerHidden(value, id, !value.editing!.layers.find(l => l.id === id)?.hidden))} onLayerMute={id => apply(value => setLayerMuted(value, id, !value.editing!.layers.find(l => l.id === id)?.muted))} /></ResizablePanel></ResizablePanelGroup>
    <input ref={input} className="se-sr" tabIndex={-1} type="file" multiple onChange={e => { const files = Array.from(e.target.files ?? []), pending = picker.current; e.currentTarget.value = ''; cancelPicker(); if (!confirmation.current && files.length && pending?.type === 'media' && scope(pending.token)) void importFiles(files, pending.target, pending.at); }} />
    <input ref={captionsInput} className="se-sr" tabIndex={-1} type="file" accept=".srt,text/plain" onChange={e => { const file = e.target.files?.[0], pending = picker.current; e.currentTarget.value = ''; cancelPicker(); if (!confirmation.current && file && pending?.type === 'captions' && scope(pending.token)) void external('Importando legendas', async (token, signal) => { const cues = parseDesktopCaptions(await file.text()); if (!scope(token) || signal.aborted) return; const current = workspace.current.current!, length = studioSeconds(compileStudioRecipe(current).durationTicks); if (cues.some(c => c.start >= length || c.end > length + .01)) throw new Error('Uma legenda ultrapassa a duração da montagem. Revise o arquivo SRT.'); workspace.apply(value => addCaptionTrack(value, cues, captionStyles[captionStyle].style)); await workspace.flush(); }); }} />
    {busy && classEditRunning && <div className="se-modal-backdrop">
      <section className="se-progress-modal se-class-edit-progress" role="dialog" aria-modal="true" aria-label="Class Edit">
        <svg className="se-class-edit-progress-border" viewBox="0 0 350 192" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id={classEditGradient} x2="100%" y2="100%">
            <stop stopColor="#f176ac" /><stop offset=".5" stopColor="#d73585" /><stop offset="1" stopColor="#ef5066" />
          </linearGradient></defs>
          <path d="M175 2 H334 Q348 2 348 16 V176 Q348 190 334 190 H16 Q2 190 2 176 V16 Q2 2 16 2 Z"
            pathLength={100} fill="none" stroke={`url(#${classEditGradient})`} strokeWidth={3}
            vectorEffect="non-scaling-stroke" strokeDasharray="100 100" strokeDashoffset={100 - progress * 100} />
        </svg>
        <div className="se-class-edit-percent" role="progressbar" aria-label="Progresso do Class Edit" aria-valuenow={Math.round(progress * 100)}>{Math.round(progress * 100)}%</div>
        <h2 role="status">{busy}</h2>
        <button className="se-button" disabled={progress >= .94} onClick={() => controller.current?.abort()}>Cancelar</button>
      </section>
    </div>}
    {busy && !classEditRunning && <div className="se-modal-backdrop"><section className="se-progress-modal" role="dialog" aria-modal="true" aria-label={busy}><Loader2 size={23} className="se-spin" /><h2>{busy}</h2>{busy !== 'Escolhendo arquivo' && busy !== 'Detectando pausas' && busy !== 'Transcrevendo áudio' && !busy.startsWith('Preparando') && <><progress max={1} value={progress} /><p>{Math.round(progress * 100)}%{busy.startsWith('Exportando') && ' · Mantenha esta aba aberta'}</p></>}<button className="se-button" onClick={() => { if (picker.current) cancelPicker(); else controller.current?.abort(); }}>Cancelar</button></section></div>}
    {recorder && <div className="se-modal-backdrop"><StudioRecorder key={`${owner}:${projectId}`} scopeKey={`${owner}:${projectId}`} mode={recorder} aspectRatio={project.kind==='short'?'9:16':'16:9'} disabled={blocked} onClose={() => { const entry = recorderEntry.current; if (entry && scope(entry.token)) { recorderEntry.current = null; setRecorder(null); } }} onRecorded={async file => { const entry = recorderEntry.current; if (!entry || !scope(entry.token)) throw new DOMException('Gravação cancelada.', 'AbortError'); const saved = await importFiles([file], entry.mode === 'audio' ? 'layer' : 'main', entry.at, true); if (!saved || !scope(entry.token)) throw new DOMException('A gravação permanece disponível para tentar novamente.', 'AbortError'); }} /></div>}
    {rename && <div className="se-modal-backdrop"><section className="se-modal" role="dialog" aria-modal="true" aria-label="Nome do projeto"><header><h2>Nome do projeto</h2><button className="se-icon" aria-label="Fechar nome" onClick={() => setRename(false)}><X size={17} /></button></header><input autoFocus value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /><button className="se-button se-primary se-wide" disabled={!title.trim()} onClick={() => { apply(value => withStudioTakes({ ...value, editing: value.editing!, title: title.trim() })); setRename(false); }}>Salvar nome</button></section></div>}
    {dialog}
    {exportReady && !busy && <div className="se-toast" role="status"><Check size={15} />Arquivo preparado</div>}
  </div>;
}
