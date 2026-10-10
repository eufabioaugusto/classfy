import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import babel, { transformFileSync } from '@babel/core';
import * as model from './model.ts';
import * as geometry from './canvasGeometry.ts';
import * as layout from './timelineLayout.ts';
import * as motionHelpers from './timelineMotion.ts';
import * as snapHelpers from './timelineSnap.ts';
import * as playbackHelpers from './timelinePlayback.ts';
import { initialStudioCanvasTransformChannel } from './canvasTransformChannel.ts';

const compiled = new Map();
export function loadJourneyModule(file, dependencies = {}) {
  const location = new URL(file, import.meta.url);
  if (!compiled.has(location.href)) compiled.set(location.href, ts.transpileModule(readFileSync(location, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.get(location.href))(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unconfigured journey boundary: ${file} -> ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}

// Reuse the established controlled React/native runtimes without importing
// their node:test registrations or editing tests owned by another agent.
// Domain components and their handlers are compiled from production files.
const factories = new Map();
let sharedUIDepth = 0;
const enterSharedUI = () => { sharedUIDepth++; return () => { sharedUIDepth--; }; };
const isSharedUI = () => sharedUIDepth > 0;
function linkUIRuntime(source) {
  // The three established runtimes model UI locally. In one real app they
  // share the same Reanimated runtime: a Canvas worklet's channel write must
  // already be visible to Preview/Timeline, not become another JS microtask.
  return source
    .replaceAll("runtime = 'ui'; try { return callback(...args); } finally { runtime = before; }", "runtime = 'ui'; const leaveUI = enterSharedUI(); try { return callback(...args); } finally { runtime = before; leaveUI(); }")
    .replaceAll("const previous = uiRuntime; uiRuntime = true;\n      try { return callback(...args); } finally { uiRuntime = previous; }", "const previous = uiRuntime; uiRuntime = true; const leaveUI = enterSharedUI();\n      try { return callback(...args); } finally { uiRuntime = previous; leaveUI(); }")
    .replaceAll("const previous = uiRuntime; uiRuntime = true;\n    try { return callback(...args); } finally { uiRuntime = previous; }", "const previous = uiRuntime; uiRuntime = true; const leaveUI = enterSharedUI();\n    try { return callback(...args); } finally { uiRuntime = previous; leaveUI(); }")
    .replaceAll("options.asyncShared && runtime === 'js'", 'options.asyncShared && !isSharedUI()')
    .replaceAll('nativeSharedValues && !uiRuntime', 'nativeSharedValues && !isSharedUI()')
    .replaceAll('nativeRuntime && !uiRuntime', 'nativeRuntime && !isSharedUI()');
}
function existingRuntime(file, dependencies, transform = source => source) {
  if (!factories.has(file)) {
    const location = new URL(file, import.meta.url);
    const text = readFileSync(location, 'utf8');
    const end = text.indexOf("\ntest('");
    assert.ok(end > 0, `Missing runtime boundary in ${file}`);
    const prefix = transform(linkUIRuntime(text.slice(0, end).replace(/^import[\s\S]*?;\n/gm, '')
      .replaceAll('import.meta.url', JSON.stringify(location.href))));
    const linked = { ...dependencies, enterSharedUI, isSharedUI };
    factories.set(file, new Function(...Object.keys(linked), `${prefix}\nreturn harness;`)(...Object.values(linked)));
  }
  return factories.get(file);
}

function actualFilmstrip(hooks) {
  return loadJourneyModule('./useStudioFilmstrip.ts', {
    react: hooks,
    'expo-file-system/legacy': { cacheDirectory: null },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digestStringAsync: async () => 'unused', randomUUID: () => 'unused' },
    '../../../modules/classfy-studio-media': { isStudioMediaAvailable: () => false, generateThumbnailAsync: async () => { throw new Error('Thumbnail decoding is outside this journey'); } },
    './studioFilmstripCache': loadJourneyModule('./studioFilmstripCache.ts'),
  });
}
function actualLegacyPreview(hooks, nativeBoundary) {
  const timeline = loadJourneyModule('./timeline.ts');
  return loadJourneyModule('./StudioPreview.tsx', {
    react: hooks, 'react/jsx-runtime': nativeBoundary['react/jsx-runtime'],
    'react-native': nativeBoundary['react-native'],
    'expo-router': { useFocusEffect: hooks.useEffect },
    'expo-video': { VideoView: 'expo-video-view', useVideoPlayer: () => { throw new Error('This journey requires the production native composition branch'); } },
    'lucide-react-native': {}, '@/theme/colors': { colors: {} }, './model': model, './timeline': timeline,
    './editorInteraction': loadJourneyModule('./editorInteraction.ts', { './timeline': timeline }),
    './videoSourceReady': loadJourneyModule('./videoSourceReady.ts'),
  });
}

export const journeyCanvas = options => existingRuntime('./canvasInteraction.test.mjs', {
  assert, readFileSync, fileURLToPath, ts, babel, geometry, initialStudioCanvasTransformChannel,
  ...model,
})(options);
export const journeyTimeline = options => existingRuntime('./timelineInteraction.test.mjs', {
  assert, readFileSync, createRequire, dirname, join, fileURLToPath, transformFileSync, ts, model, layout, motionHelpers, snapHelpers, playbackHelpers, actualFilmstrip,
}, source => {
  const old = "'./useStudioFilmstrip': { useStudioFilmstrip: (take, samples) => { filmstripRequests.push({ take, samples }); return {}; } }";
  assert.ok(source.includes(old), 'Update journey runtime integration when the thumbnail boundary changes');
  return source.replace(old, "'./useStudioFilmstrip': actualFilmstrip(hooks)");
})(options);
export const journeyPreview = options => existingRuntime('./compositionPreview.test.mjs', {
  assert, readFileSync, createRequire, dirname, join, fileURLToPath, transformFileSync, ts, model, initialStudioCanvasTransformChannel, actualLegacyPreview,
}, source => {
  const old = "'./StudioPreview': { StudioPreview: 'legacy-preview' }";
  assert.ok(source.includes(old), 'Update journey runtime integration when the native preview boundary changes');
  return source.replace(old, "'./StudioPreview': null")
    .replace("const code = nativeRuntime", "dependencies['./StudioPreview'] = actualLegacyPreview(hooks, dependencies);\n  const code = nativeRuntime");
})(options);

export const plain = value => JSON.parse(JSON.stringify(value));
let runtimeSequence = 0;

// Only external effects are controlled here: auth session, pickers, original
// file metadata/copies, AsyncStorage completion and native encoding commands.
// Every mutation, journal, recovery, validation and export dispatch is real.
export function createJourneyRuntime(options = {}) {
  const data = options.data ?? new Map(), disk = options.disk ?? new Map();
  let owner = options.owner ?? 'journey-owner', sequence = 0, nextWrite, nextCopy, nextMetadata;
  const writes = [], picks = [], exports = [], alerts = [];
  const directory = options.directory ?? 'file:///journey/Documents/';
  const storage = {
    getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => {
      const gate = nextWrite; nextWrite = undefined;
      if (gate) { gate.started(); await gate.promise; }
      data.set(key, value); writes.push({ key, value });
    },
  };
  const fs = {
    documentDirectory: directory,
    makeDirectoryAsync: async () => {},
    copyAsync: async ({ from, to }) => {
      assert.ok(disk.has(from), `Missing local fixture ${from}`);
      disk.set(to, { ...disk.get(from) });
      const callback = nextCopy; nextCopy = undefined; await callback?.();
    },
    getInfoAsync: async uri => ({ exists: disk.has(uri), isDirectory: false, size: disk.get(uri)?.fileSize ?? 0 }),
  };
  const runtimeId = ++runtimeSequence;
  const crypto = { randomUUID: () => `journey-${runtimeId}-${++sequence}` };
  const store = loadJourneyModule('./store.ts', {
    '@react-native-async-storage/async-storage': storage, 'expo-file-system/legacy': fs, 'expo-crypto': crypto, './model': model,
  });
  const native = {
    isStudioMediaAvailable: () => true, isStudioCompositionAvailable: () => true,
    getStudioExportCapabilitiesAsync: async () => ({ version: 2, available: true, colorSpace: 'rec709', minimumDimension: 64, maximumDimension: 3840, maximumShortDimension: 2160,
      maximumPixels: 8294400, arbitraryEvenDimensions: true, supportsHEVC: true, resolutions: [
        { id: 'hd', width: 1920, height: 1080, codec: 'h264' }, { id: '2k', width: 2560, height: 1440, codec: 'hevc' }, { id: '4k', width: 3840, height: 2160, codec: 'hevc' },
      ], frameRates: [24,25,30,50,60].map(numerator => ({ numerator, denominator: 1 })).concat([24000,30000,60000].map(numerator => ({ numerator, denominator: 1001 }))) }),
    getMediaInfoAsync: async uri => {
      const failure = nextMetadata; nextMetadata = undefined;
      if (failure) throw failure;
      const metadata = disk.get(uri); assert.ok(metadata, `Unknown media ${uri}`);
      return { ...metadata };
    },
    generateThumbnailAsync: async (_uri, outputUri) => { disk.set(outputUri, { fileSize: 512 }); return { uri: outputUri }; },
    exportRecipeAsync: async (request, progress) => {
      const recipe = JSON.parse(request.recipeJSON); exports.push({ ...request, recipe });
      progress?.(0); progress?.(0.5); progress?.(1);
      const duration = model.studioSeconds(recipe.durationTicks), fileSize = 8192;
      disk.set(request.outputUri, { duration, fileSize, width: recipe.output.width, height: recipe.output.height, frameRate: recipe.output.frameRateNumerator / recipe.output.frameRateDenominator, colorSpace: recipe.output.colorSpace, hasVideo: recipe.mediaType === 'video', hasAudio: true });
      return { uri: request.outputUri, duration, fileSize, mimeType: 'video/mp4' };
    },
    exportTimelineAsync: async () => { throw new Error('The multilayer journey must not fall back to legacy export'); },
    cancelExportAsync: async () => {},
  };
  const picker = async () => { assert.ok(picks.length, 'Picker needs a queued fixture or cancellation'); return picks.shift(); };
  const media = loadJourneyModule('./media.ts', {
    'expo-file-system/legacy': fs, 'expo-crypto': crypto,
    'react-native': { Alert: { alert: (...args) => alerts.push(args) } },
    'expo-image-picker': { UIImagePickerPreferredAssetRepresentationMode: { Current: 'current' }, launchImageLibraryAsync: picker },
    'expo-document-picker': { getDocumentAsync: picker },
    'expo-image-manipulator': { ImageManipulator: { manipulate: () => { throw new Error('Fixture dimensions should come from the original picker metadata'); } } },
    '@/lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: owner } } } }) } } },
    '../../../modules/classfy-studio-media': native, './model': model, './store': store,
  });
  const history = loadJourneyModule('./editingHistory.ts', { './model.ts': model, './model': model }).createStudioEditingHistory();
  return {
    store, media, model, history, data, disk, writes, exports, alerts,
    queuePicker: (...uris) => picks.push({ canceled: false, assets: uris.map(uri => ({ uri, fileName: uri.split('/').at(-1), name: uri.split('/').at(-1), ...disk.get(uri) })) }),
    cancelPicker: () => picks.push({ canceled: true, assets: [] }),
    fixture: (name, metadata = {}) => {
      const uri = `file:///fixtures/${name}`;
      disk.set(uri, { duration: 8, width: 1920, height: 1080, frameRate: 30, hasVideo: true, hasAudio: true, fileSize: 4096, ...metadata });
      return uri;
    },
    deferWrite: () => {
      let resolve, reject, started; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      const entered = new Promise(yes => { started = yes; });
      nextWrite = { promise, started };
      return { entered, resolve, reject };
    },
    onNextCopy: callback => { nextCopy = callback; },
    failMetadata: () => { nextMetadata = new Error('Original metadata temporarily unavailable'); },
    setOwner: value => { owner = value; },
    owner: () => owner,
  };
}

/**
 * Test orchestration, not an editor-route substitute or acceptance of its
 * navigation/panels. It connects the public component callbacks to production
 * mutations/helpers, then observes the store before and after real persistence.
 */
export async function createJourneyEditor(runtime, projectId) {
  const { store, history } = runtime;
  const owner = runtime.owner();
  const current = () => { const value = store.getStudioProject(owner, projectId); assert.ok(value); return value; };
  const timelineHelpers = loadJourneyModule('./timeline.ts');
  const anchors = loadJourneyModule('./editorInteraction.ts', { './timeline': timelineHelpers });
  const canvasEditing = loadJourneyModule('./canvasEditing.ts', { './model': model });
  const layerEditing = loadJourneyModule('./layerTimelineInteraction.ts', { './model': model });
  const events = [], saves = [], failures = [], selections = [], seeks = [], active = new Set();
  let selectedLayerId, selectedMainClipId = current().takes[0]?.id, position = 1;
  let playback = { position: 1, sourcePosition: current().takes[0]?.start + 1, takeId: current().takes[0]?.id, playing: false, loading: false };
  let canvas, timeline, preview, disposed = false;
  const recipe = () => model.compileStudioRecipe(current());
  const canvasProps = () => ({ editing: current().editing, recipe: recipe(), positionSeconds: position, selectedLayerId, selectedMainClipId });
  const timelineProps = () => ({ editing: current().editing, takes: current().takes, layers: recipe().clips.filter(value => value.zIndex > 0),
    activeTakeId: selectedMainClipId, selectedLayerId, position, playing: playback.playing, loading: playback.loading });
  function refresh() {
    history.sync(current(), owner);
    canvas?.update(canvasProps()); timeline?.update(timelineProps());
    preview?.update({ project: current(), activeTakeId: playback.takeId });
  }
  function selectLayer(id) { selectedLayerId = id; selectedMainClipId = undefined; selections.push(id); refresh(); }
  function selectMain(id) { selectedMainClipId = id; selectedLayerId = undefined; selections.push(id); refresh(); }
  const assertOwner = () => { assert.equal(runtime.owner(), owner, 'A changed session cannot mutate the old editor'); };
  async function save(change, { direction, restore = false } = {}) {
    const anchor = anchors.captureStudioPlaybackAnchor(current().takes, playback);
    let ticket;
    const pending = store.mutateStudioProject(owner, projectId, latest => {
      assertOwner();
      ticket = direction === 'undo' ? history.beginUndo(latest, owner) : direction === 'redo' ? history.beginRedo(latest, owner)
        : history.beginEditing(latest, change(latest.editing), owner);
      return ticket?.editing ? { editing: ticket.editing } : {};
    });
    active.add(pending);
    try {
      const saved = await pending;
      if (ticket) { assert.equal(history.commit(ticket, saved), true); saves.push({ direction: ticket.direction, revision: saved.revision }); }
      refresh();
      if (restore) {
        const restored = anchors.restoreStudioPlaybackAnchor(saved.takes, anchor);
        if (restored) preview.ref.current.seek(restored.position, restored.source);
      }
      return saved;
    } catch (cause) { history.abort(ticket); failures.push(cause); throw cause; }
    finally { active.delete(pending); }
  }
  preview = journeyPreview({ initialProject: current(), playbackChannel: true, nativeRuntime: true, interactive: true });
  preview.update({ onPlaybackState: value => {
    playback = value; position = value.position;
    canvas?.update(canvasProps()); timeline?.update(timelineProps());
  } });
  await preview.pump();
  canvas = journeyCanvas({ worklets: true, asyncShared: true, interactive: true, props: {
    ...canvasProps(), canvasTransformChannel: preview.transformChannel,
    onSelectLayer: selectLayer, onSelectMainClip: selectMain,
    onPreviewRect: (id, transform) => events.push({ kind: 'canvas-preview', id, transform }),
    onCommitRect: (id, transform) => save(value => canvasEditing.patchStudioCanvasTransform(value, id, transform)),
    onInteractionStart: () => events.push({ kind: 'canvas-start' }), onInteractionEnd: () => events.push({ kind: 'canvas-end' }),
    onEditText: id => events.push({ kind: 'edit-text', id }),
    onCanvasPress: () => preview.ref.current.togglePlayback(),
  } });
  timeline = journeyTimeline({ ...timelineProps(), nativeWorklets: true, nativeSharedValues: true, playbackChannel: preview.channel,
    onSelect: take => selectMain(take.id), onSelectLayer: selectLayer,
    onSeek: seconds => { seeks.push(seconds); preview.ref.current.seek(seconds); },
    onScrubStart: () => preview.ref.current.pause(),
    onTrimChange: range => events.push({ kind: 'main-trim-preview', range }),
    onTrimCancel: () => events.push({ kind: 'main-trim-cancel' }),
    onTrimCommit: range => save(editing => model.reconcileStudioTakes(current(), current().takes.map(take => take.id === range.takeId
      ? { ...take, start: range.start, end: range.end } : take)), { restore: true }),
    onLayerTrimPreview: (id, range) => events.push({ kind: 'layer-trim-preview', id, range }),
    onLayerTrimCommit: (id, range) => save(value => layerEditing.applyStudioLayerTimelineRange(value, id, range)),
    onMoveLayer: (id, delta, targetZIndex) => save(value => {
      const ordered = targetZIndex === undefined ? value : model.moveStudioLayerItemToLane(value, id, targetZIndex);
      const frozen = layerEditing.freezeStudioLayerTimeline(ordered, id);
      return layerEditing.applyStudioLayerTimelineRange(ordered, id, { startSeconds: frozen.startSeconds + delta, endSeconds: frozen.endSeconds + delta }, 'move');
    }),
    onLayerInteractionStart: () => events.push({ kind: 'layer-start' }), onLayerInteractionEnd: () => events.push({ kind: 'layer-end' }),
    onToggleLaneVisibility: zIndex => save(value => { const layer = value.layers[zIndex - 1]; return model.setStudioLayerHidden(value, layer.id, !layer.hidden); }),
    onToggleLaneMute: zIndex => save(value => { const layer = value.layers[zIndex - 1]; return model.setStudioLayerMuted(value, layer.id, !layer.muted); }),
    onToggleMainMute: () => save(value => model.setStudioMainMuted(value, !value.mainMuted)),
  });
  const unsubscribe = store.subscribeStudio(refresh);
  refresh();
  const pump = async () => { await preview.pump(); await canvas.pump(); await timeline.pump(); await preview.pump(); };
  async function sample(seconds, playing = false) {
    const location = timelineHelpers.locateStudioTime(current().takes, seconds);
    preview.emit({ positionSeconds: seconds, sourcePositionSeconds: location.sourceSeconds, clipId: location.takeId, playing, loading: false });
    await pump(); timeline.reactions();
  }
  async function confirmSeek() {
    await pump();
    const command = preview.calls.at(-1);
    assert.ok(command, 'Production preview must issue a native seek/source command');
    const seconds = command.kind === 'seek' ? command.args[1] : position;
    const location = timelineHelpers.locateStudioTime(current().takes, seconds);
    command.resolve(preview.state({ positionSeconds: seconds, sourcePositionSeconds: location.sourceSeconds, clipId: location.takeId, playing: false }));
    await sample(seconds);
  }
  return {
    runtime, current, recipe, canvas, timeline, preview, events, saves, failures, selections, seeks, history,
    selectLayer, selectMain, save, pump, sample, confirmSeek,
    position: () => position, playbackState: () => ({ ...playback }), selected: () => ({ selectedLayerId, selectedMainClipId }),
    setPosition: async seconds => { preview.ref.current.seek(seconds); await confirmSeek(); },
    undo: () => save(undefined, { direction: 'undo', restore: true }), redo: () => save(undefined, { direction: 'redo', restore: true }),
    drain: async () => { await Promise.allSettled([...active]); await pump(); },
    dispose: () => { if (disposed) return; disposed = true; unsubscribe(); canvas.dispose(); timeline.dispose(); preview.dispose(); },
  };
}
