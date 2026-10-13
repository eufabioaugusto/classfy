import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown, Download, Film, Image, Loader2, Mic, Monitor, Music2, Pause, Play, Plus, Redo2, Scissors, Subtitles, Type, Undo2, Upload, Video, X } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { addCaption, addLayerAsset, addMainAsset, addText, duplicateClip, patchClip, removeClip, setLayerHidden, setLayerMuted, setMainMuted, splitLayerClip, splitMainClip, type StudioWebClipPatch } from '@/lib/studio/editor/commands';
import { getAsset, getExport, putAsset, storeExport, studioAssetUri } from '@/lib/studio/editor/storage';
import { inspectStudioMedia } from '@/lib/studio/editor/media';
import { analyzeStudioScene } from '@/lib/studio/editor/sceneAnalysis';
import { createStudioRenderer, type StudioRenderer } from '@/lib/studio/editor/renderer';
import { exportStudioProject, getStudioExportCapabilities, releaseStudioExport, type StudioBrowserExportCapabilities } from '@/lib/studio/editor/export';
import { compileStudioRecipe, formatStudioEditorTime, studioGrade, studioSeconds, studioTicks, withStudioOutputSelection, withStudioTakes, type StudioAsset, type StudioOutputSelection, type StudioProject } from '../../../../shared/studio';
import { StudioDesktopCanvas } from './StudioDesktopCanvas';
import { StudioDesktopTimeline } from './StudioDesktopTimeline';
import { StudioDesktopInspector } from './StudioDesktopInspector';
import { StudioRecorder } from './StudioRecorder';
import { useStudioWorkspace } from './useStudioWorkspace';
import { useStudioExitGuard } from './useStudioExitGuard';
import { useStudioConfirmation } from './useStudioConfirmation';
import { parseDesktopCaptions } from './captionImport';
import '@/styles/studio-editor.css';

type Tab = 'media' | 'text' | 'captions' | 'audio';
type RecordingImport = { asset: StudioAsset; thumbnail?: Blob; warnings: string[]; clipId: string; target: 'main' | 'layer'; at: number; originalStored?: boolean; thumbnailStored?: boolean };
export function StudioEditorWorkspace({ owner, projectId }: { owner: string; projectId: string }) {
  const navigate = useNavigate(), workspace = useStudioWorkspace(owner, projectId);
  const { project } = workspace;
  const [preview, setPreview] = useState<StudioProject | null>(null), [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState<Tab>('media'), [position, setPosition] = useState(0), [playing, setPlaying] = useState(false), [renderLoading, setRenderLoading] = useState(false);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState<string | null>(null), [progress, setProgress] = useState(0);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({}), [recorder, setRecorder] = useState<'camera' | 'screen' | 'audio' | null>(null);
  const [exportMenu, setExportMenu] = useState(false), [exportReady, setExportReady] = useState(false), [rename, setRename] = useState(false), [title, setTitle] = useState('');
  const [capabilities, setCapabilities] = useState<StudioBrowserExportCapabilities | null>(null);
  const [exitPreparing, setExitPreparing] = useState(false);
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
  const previewRecipe = useMemo(() => comparing && selected && effective && recipe?.clips.some(clip => clip.id === selected && (clip.kind === 'video' || clip.kind === 'image')) ? compileStudioRecipe(patchClip(effective, selected, { enhancement: null, portrait: null, grade: studioGrade(), effect: 'natural' })) : recipe, [comparing, selected, effective, recipe]);
  const latestRecipe = useRef(previewRecipe); latestRecipe.current = previewRecipe;
  const selectedClip = recipe?.clips.find(c => c.id === selected), duration = recipe ? studioSeconds(recipe.durationTicks) : 0;
  useEffect(() => { if (selected && recipe && !recipe.clips.some(clip => clip.id === selected)) { setSelected(undefined); setComparing(false); } }, [selected, recipe]);
  const scope = useCallback((token: number) => alive.current && workspace.isCurrent(token) && document.visibilityState !== 'hidden', [workspace.isCurrent]);
  const apply = (change: (value: StudioProject) => StudioProject) => { if (locked.current || confirmation.current) return; try { workspace.apply(change); setError(null); setExportReady(false); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Revise esta edição.'); } };
  const settle = () => {
    const draft = pendingPatch.current; if (!draft) return;
    pendingPatch.current = null;
    try { workspace.apply(value => patchClip(value, draft.id, draft.patch)); setPreview(null); setExportReady(false); }
    catch (cause) { pendingPatch.current = draft; setError(cause instanceof Error ? cause.message : 'Não foi possível concluir esta edição.'); throw cause; }
  };
  const select = (id?: string) => { if (locked.current || confirmation.current) return; try { settle(); setComparing(false); setSelected(id); } catch { /* Keep the draft and its original selection. */ } };
  const seek = async (seconds: number) => {
    if (locked.current || confirmation.current) return;
    try { settle(); } catch { return; }
    engine.current?.pause(); const token = ++seekSequence.current;
    setPlaying(false); setPosition(Math.max(0, Math.min(duration, seconds)));
    try { await engine.current?.seek(seconds); } catch (cause) { if (alive.current && token === seekSequence.current) setError(cause instanceof Error ? cause.message : 'Não foi possível mostrar este quadro.'); }
  };
  useEffect(() => {
    alive.current = true;
    confirmation.current = null; locked.current = false; controller.current = null; recorderEntry.current = null; pendingPatch.current = null;
    setBusy(null); setRecorder(null); setPreview(null); setSelected(undefined); setExitPreparing(false); setComparing(false);
    return () => { alive.current = false; confirmation.current = null; picker.current = null; controller.current?.abort(); ++seekSequence.current; engine.current?.dispose(); };
  }, [owner, projectId]);
  useEffect(() => { let active = true; getStudioExportCapabilities().then(value => { if (active) setCapabilities(value); }).catch(() => undefined); return () => { active = false; }; }, []);
  useEffect(() => {
    if (!project || !canvas.current) return;
    let active = true, renderer: StudioRenderer | null = null, unsubscribe: (() => void) | undefined;
    setRenderLoading(true);
    createStudioRenderer(compileStudioRecipe(project), assetId => getAsset(owner, projectId, assetId), { canvas: canvas.current }).then(async value => {
      if (!active) { value.dispose(); return; }
      renderer = value; engine.current = value;
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
  const external = async (label: string, task: (token: number, signal: AbortSignal) => Promise<void>, propagateError = false): Promise<boolean> => {
    if (locked.current || confirmation.current || !alive.current || document.visibilityState === 'hidden') return false;
    try { settle(); } catch (cause) { if (propagateError) throw cause; return false; }
    locked.current = true; engine.current?.pause(); setBusy(label); setError(null); setProgress(0);
    const token = workspace.epoch.current, abort = new AbortController(); controller.current = abort;
    try { await workspace.flush(); if (!scope(token) || abort.signal.aborted) return false; await task(token, abort.signal); return scope(token) && !abort.signal.aborted; }
    catch (cause) { if (workspace.isCurrent(token) && alive.current) recordError(cause); if (propagateError) throw cause; return false; }
    finally { if (workspace.isCurrent(token) && alive.current) { locked.current = false; setBusy(null); if (controller.current === abort) controller.current = null; } }
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
  const enablePortrait = () => {
    if (!selected) return;
    const id = selected;
    void external('Preparando retoque natural', async (token, signal) => {
      if (!engine.current) throw new Error('Aguarde a prévia ficar pronta para ativar o retoque.');
      await engine.current.preparePortrait(signal);
      if (!scope(token) || signal.aborted) return;
      workspace.apply(value => patchClip(value, id, { portrait: { version: 1, strength: .4 } })); setComparing(false); setExportReady(false); await workspace.flush();
    });
  };
  const canSplit = !!selectedClip && position > studioSeconds(selectedClip.startTicks) + .1 && position < studioSeconds(selectedClip.startTicks + selectedClip.durationTicks) - .1;
  const split = () => { if (confirmation.current || locked.current || !selectedClip || !canSplit) return; try { settle(); } catch { return; } apply(value => selectedClip.zIndex === 0 ? splitMainClip(value, selectedClip.id, position) : splitLayerClip(value, selectedClip.id, position)); setSelected(undefined); };
  const remove = () => { if (confirmation.current || locked.current || !selected) return; try { settle(); } catch { return; } apply(value => removeClip(value, selected)); setSelected(undefined); };
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
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement; if (target?.closest('input, textarea, select, [contenteditable="true"]') || locked.current || confirmation.current || recorder) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); try { settle(); } catch { return; } if (event.shiftKey) workspace.redo(); else workspace.undo(); }
      else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); workspace.redo(); }
      else if (event.code === 'Space') { event.preventDefault(); toggle(); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(); }
      else if (!modifier && event.key.toLowerCase() === 's') { event.preventDefault(); split(); }
      else if (event.key === 'Escape') select(undefined);
      else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); void seek(position + (event.key === 'ArrowRight' ? 1 : -1) / 30); }
    };
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
  });
  if (workspace.loading) return <><div className="se-loading"><Loader2 className="se-spin" size={24} /><span>Abrindo projeto…</span></div>{dialog}</>;
  if (!project || !effective || !recipe) return <><div className="se-loading"><p role="alert">{workspace.error ?? 'Projeto indisponível.'}</p><button className="se-button" onClick={() => navigate('/studio/projects')}>Voltar aos projetos</button></div>{dialog}</>;
  return <div className="se-editor"><header className="se-editor-header"><div className="se-editor-brand"><button className="se-icon" disabled={blocked || !!recorder} aria-label="Voltar aos projetos" onClick={() => void close()}><ArrowLeft size={18} /></button><img src="/brand/classfy-simbolo-vermelho.svg" alt="Classfy" /><span>Studio</span><span className="se-header-divider" /><button className="se-project-title" disabled={blocked} onClick={() => { setTitle(project.title); setRename(true); }}>{project.title || 'Projeto sem título'}<ChevronDown size={13} /></button></div><div className="se-editor-actions"><span className={`se-save-state ${workspace.error ? 'error' : ''}`}>{workspace.saving ? <Loader2 size={12} className="se-spin" /> : <Check size={12} />}{workspace.error ? 'Falha ao salvar' : workspace.saving ? 'Salvando…' : 'Salvo neste navegador'}</span><button className="se-icon" disabled={!workspace.canUndo || blocked} aria-label="Desfazer" onClick={() => { if (confirmation.current) return; settle(); workspace.undo(); }}><Undo2 size={18} /></button><button className="se-icon" disabled={!workspace.canRedo || blocked} aria-label="Refazer" onClick={() => { if (confirmation.current) return; settle(); workspace.redo(); }}><Redo2 size={18} /></button><button className="se-button se-primary" disabled={blocked || !!recorder || !project.editing!.main.length} onClick={() => setExportMenu(!exportMenu)}><Upload size={15} /> Exportar<ChevronDown size={12} /></button></div>
      {exportMenu && <div className="se-export-menu"><p>{recipe.output.width} × {recipe.output.height} · {Number((recipe.output.frameRateNumerator / recipe.output.frameRateDenominator).toFixed(2))} FPS · SDR</p>
        <label className="se-field">Resolução<select aria-label="Resolução de exportação" disabled={blocked || !capabilities} value={project.editing!.output.selection?.resolution ?? 'original'} onChange={e => chooseOutput({ resolution: e.target.value as StudioOutputSelection['resolution'] })}><option value="original">Original</option>{(['720p', 'hd', '2k', '4k'] as const).map(value => <option key={value} value={value} disabled={!capabilities?.profiles.some(profile => profile.resolution === value)}>{value === 'hd' ? '1080p' : value === '720p' ? '720p' : value === '2k' ? '2K · 1440p' : '4K · 2160p'}</option>)}</select></label>
        <label className="se-field">Cadência<select aria-label="FPS de exportação" disabled={blocked || !capabilities} value={project.editing!.output.selection?.frameRate ?? 30} onChange={e => chooseOutput({ frameRate: e.target.value === 'original' ? 'original' : +e.target.value as 24 | 30 | 60 })}><option value="original">Original</option>{([24, 30, 60] as const).map(value => <option key={value} value={value} disabled={!capabilities?.profiles.some(profile => profile.frameRate === value)}>{value} FPS</option>)}</select></label>
        {capabilities?.reason && <p role="status">{capabilities.reason}</p>}<button disabled={!capabilities?.available && project.kind !== 'podcast'} onClick={() => exportFile(false)}><Download size={16} />Baixar arquivo</button><button disabled={!capabilities?.available && project.kind !== 'podcast'} onClick={() => exportFile(true)}><Upload size={16} />Preparar publicação</button></div>}
    </header>
    {(error || workspace.error) && <div className="se-editor-error" role="alert"><span>{workspace.error || error}</span>{workspace.error && <button onClick={() => void workspace.flush().catch(recordError)}>Tentar salvar</button>}<button className="se-icon" aria-label="Fechar mensagem" onClick={() => setError(null)}><X size={13} /></button></div>}
    <ResizablePanelGroup direction="vertical" className="se-workspace-panels"><ResizablePanel defaultSize={67} minSize={35}><ResizablePanelGroup direction="horizontal">
      <ResizablePanel defaultSize={23} minSize={15} maxSize={35}><aside className="se-library"><nav aria-label="Ferramentas do editor">{([{ id: 'media', label: 'Mídia', Icon: Film }, { id: 'text', label: 'Texto', Icon: Type }, { id: 'captions', label: 'Legendas', Icon: Subtitles }, { id: 'audio', label: 'Áudio', Icon: Music2 }] as const).map(({ id, label, Icon }) => <button key={id} aria-pressed={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={18} /><span>{label}</span></button>)}</nav><div className="se-library-content">
        {tab === 'media' && <><h2>Biblioteca</h2><button className="se-button se-primary se-wide" disabled={blocked || !!recorder} onClick={() => openImport('main')}><Plus size={16} />Importar arquivos</button><div className="se-capture-buttons"><button className="se-button" disabled={blocked} onClick={() => openRecorder('camera')}><Video size={16} />Câmera</button><button className="se-button" disabled={blocked} onClick={() => openRecorder('screen')}><Monitor size={16} />Tela</button></div><div className="se-asset-grid">{project.editing!.assets.filter(a => a.kind !== 'audio').map(asset => <article key={asset.id}><button className="se-asset-thumb" disabled={blocked} aria-label={`Adicionar ${asset.name} à montagem`} onClick={() => reuse(asset, 'main')}>{thumbnails[asset.id] ? <img src={thumbnails[asset.id]} alt="" /> : <Film size={23} />}<span>{asset.kind === 'image' ? 'Imagem' : formatStudioEditorTime(studioSeconds(asset.durationTicks))}</span></button><p title={asset.name}>{asset.name}</p><button className="se-asset-overlay" disabled={blocked || !duration} onClick={() => reuse(asset, 'layer')}>Sobrepor <Plus size={12} /></button></article>)}</div>{!project.editing!.assets.length && <p className="se-muted se-library-empty">Arraste arquivos para a prévia ou importe seus originais.</p>}</>}
        {tab === 'text' && <><h2>Texto</h2><button className="se-button se-primary se-wide" disabled={blocked || !duration} onClick={() => makeText()}><Type size={17} />Adicionar texto</button><div className="se-text-examples"><span>Aa</span><p>Títulos, tópicos e destaques editáveis.</p></div></>}
        {tab === 'captions' && <><h2>Legendas</h2><button className="se-button se-primary se-wide" disabled={blocked || !duration} onClick={() => void openPicker('captions', 'layer')}><Subtitles size={17} />Importar arquivo SRT</button><button className="se-button se-wide" disabled={blocked || !duration} onClick={() => makeText(true)}>Adicionar legenda</button><p className="se-muted">Revise os intervalos na montagem e edite o texto na prévia.</p></>}
        {tab === 'audio' && <><h2>Áudio</h2><button className="se-button se-primary se-wide" disabled={blocked} onClick={() => openImport('layer', 'audio/*')}><Music2 size={17} />Importar áudio</button><button className="se-button se-wide" disabled={blocked || !duration} onClick={() => openRecorder('audio')}><Mic size={17} />Gravar narração</button><div className="se-audio-library">{project.editing!.assets.filter(a => a.kind === 'audio').map(asset => <button key={asset.id} disabled={blocked} onClick={() => reuse(asset, 'layer')}><Mic size={19} /><span>{asset.name}<small>{formatStudioEditorTime(studioSeconds(asset.durationTicks))}</small></span><Plus size={14} /></button>)}</div></>}
      </div></aside></ResizablePanel><ResizableHandle className="se-resize-handle" />
      <ResizablePanel defaultSize={54} minSize={25}><main className="se-preview-area" onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (!locked.current && !confirmation.current && e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files), 'main'); }}><div className="se-preview-label"><span>{comparing ? 'Original · trecho selecionado' : 'Prévia'}</span><span>{project.kind === 'short' ? '9:16' : project.kind === 'podcast' ? 'Áudio' : '16:9'}</span></div>
        <StudioDesktopCanvas project={effective} selectedId={selected} position={position} disabled={blocked || !!recorder} canvasRef={canvas} onSelect={select} onEditText={id => { select(id); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-studio-text-input]')?.focus()); }} onBegin={() => { if (confirmation.current) return; settle(); engine.current?.pause(); }} onPreview={value => { if (!confirmation.current) setPreview(value); }} onCommit={apply} />
        {renderLoading && <div className="se-preview-loading"><Loader2 size={20} className="se-spin" /></div>}
        {!duration && <div className="se-first-media"><Film size={31} strokeWidth={1} /><p>Comece com seu primeiro arquivo</p><button className="se-button" onClick={() => openImport('main')}>Importar mídia</button></div>}
        <div className="se-transport"><button className="se-icon" aria-label={playing ? 'Pausar montagem' : 'Reproduzir montagem'} disabled={blocked || !!recorder || !duration} onClick={toggle}>{playing ? <Pause size={20} /> : <Play size={20} />}</button><span>{formatStudioEditorTime(position)}<i>/</i>{formatStudioEditorTime(duration)}</span><button className="se-icon" aria-label="Dividir no cursor" disabled={!canSplit || blocked} onClick={split}><Scissors size={17} /></button></div>
      </main></ResizablePanel><ResizableHandle className="se-resize-handle" /><ResizablePanel defaultSize={23} minSize={18} maxSize={35}><StudioDesktopInspector comparing={comparing} onCompare={() => { try { settle(); engine.current?.pause(); setComparing(value => !value); } catch { /* Preserve draft on save failure. */ } }} onEnhance={improveScene} onPortrait={enablePortrait} clip={selectedClip} disabled={blocked || !!recorder} canSplit={canSplit} outputHeight={recipe.output.height} onDraft={draftPatch} onCommit={() => { try { settle(); } catch { /* keep error visible */ } }} onDuplicate={() => { if (selected) { settle(); apply(value => duplicateClip(value, selected)); } }} onRemove={remove} onSplit={split} /></ResizablePanel>
    </ResizablePanelGroup></ResizablePanel><ResizableHandle className="se-resize-handle" /><ResizablePanel defaultSize={33} minSize={20} maxSize={65}><StudioDesktopTimeline project={effective} position={position} playing={playing} selectedId={selected} disabled={blocked || !!recorder} thumbnails={thumbnails} onSelect={select} onSeek={value => void seek(value)} onPreview={value => { if (confirmation.current) return; engine.current?.pause(); setPreview(value); }} onCommit={apply} onAdd={() => openImport('main')} onMainMute={() => apply(value => setMainMuted(value, !value.editing!.mainMuted))} onLayerHide={id => apply(value => setLayerHidden(value, id, !value.editing!.layers.find(l => l.id === id)?.hidden))} onLayerMute={id => apply(value => setLayerMuted(value, id, !value.editing!.layers.find(l => l.id === id)?.muted))} /></ResizablePanel></ResizablePanelGroup>
    <input ref={input} className="se-sr" tabIndex={-1} type="file" multiple onChange={e => { const files = Array.from(e.target.files ?? []), pending = picker.current; e.currentTarget.value = ''; cancelPicker(); if (!confirmation.current && files.length && pending?.type === 'media' && scope(pending.token)) void importFiles(files, pending.target, pending.at); }} />
    <input ref={captionsInput} className="se-sr" tabIndex={-1} type="file" accept=".srt,text/plain" onChange={e => { const file = e.target.files?.[0], pending = picker.current; e.currentTarget.value = ''; cancelPicker(); if (!confirmation.current && file && pending?.type === 'captions' && scope(pending.token)) void external('Importando legendas', async (token, signal) => { const cues = parseDesktopCaptions(await file.text()); if (!scope(token) || signal.aborted) return; const current = workspace.current.current!, length = studioSeconds(compileStudioRecipe(current).durationTicks); if (cues.some(c => c.start >= length || c.end > length + .01)) throw new Error('Uma legenda ultrapassa a duração da montagem. Revise o arquivo SRT.'); const layerId = `captions:${crypto.randomUUID()}`; workspace.apply(value => cues.reduce((next, cue) => addCaption(next, cue.text, cue.start, cue.end - cue.start, { layerId }), value)); await workspace.flush(); }); }} />
    {busy && <div className="se-modal-backdrop"><section className="se-progress-modal" role="dialog" aria-modal="true" aria-label={busy}><Loader2 size={23} className="se-spin" /><h2>{busy}</h2>{busy !== 'Escolhendo arquivo' && !busy.startsWith('Preparando') && <><progress max={1} value={progress} /><p>{Math.round(progress * 100)}%{busy.startsWith('Exportando') && ' · Mantenha esta aba aberta'}</p></>}<button className="se-button" onClick={() => { if (picker.current) cancelPicker(); else controller.current?.abort(); }}>Cancelar</button></section></div>}
    {recorder && <div className="se-modal-backdrop"><StudioRecorder key={`${owner}:${projectId}`} scopeKey={`${owner}:${projectId}`} mode={recorder} aspectRatio={project.kind==='short'?'9:16':'16:9'} disabled={blocked} onClose={() => { const entry = recorderEntry.current; if (entry && scope(entry.token)) { recorderEntry.current = null; setRecorder(null); } }} onRecorded={async file => { const entry = recorderEntry.current; if (!entry || !scope(entry.token)) throw new DOMException('Gravação cancelada.', 'AbortError'); const saved = await importFiles([file], entry.mode === 'audio' ? 'layer' : 'main', entry.at, true); if (!saved || !scope(entry.token)) throw new DOMException('A gravação permanece disponível para tentar novamente.', 'AbortError'); }} /></div>}
    {rename && <div className="se-modal-backdrop"><section className="se-modal" role="dialog" aria-modal="true" aria-label="Nome do projeto"><header><h2>Nome do projeto</h2><button className="se-icon" aria-label="Fechar nome" onClick={() => setRename(false)}><X size={17} /></button></header><input autoFocus value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /><button className="se-button se-primary se-wide" disabled={!title.trim()} onClick={() => { apply(value => withStudioTakes({ ...value, editing: value.editing!, title: title.trim() })); setRename(false); }}>Salvar nome</button></section></div>}
    {dialog}
    {exportReady && !busy && <div className="se-toast" role="status"><Check size={15} />Arquivo preparado</div>}
  </div>;
}
