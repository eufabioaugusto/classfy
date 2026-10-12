import { studioGrade, type StudioGrade } from '../../../../shared/studio/model';
import { createStudioSceneCameraSurface, drawStudioScene } from './sceneCompositionRender';
import { studioDefaultSceneConfiguration, type StudioCaptureScene, type StudioSceneConfiguration } from './sceneTypes';

type Source = { name: 'camera' | 'screen'; id: number; reader: ReadableStreamDefaultReader<VideoFrame>; frame: VideoFrame | null; received: number; ended: boolean };
type Command = { type: string; width?: number; height?: number; fps?: number; writable?: WritableStream<VideoFrame>; outputReadable?: ReadableStream<VideoFrame>; source?: 'camera' | 'screen'; id?: number; readable?: ReadableStream<VideoFrame>; selected?: StudioCaptureScene; config?: StudioSceneConfiguration; grade?: StudioGrade; zoom?: number; request?: number };
type Scope = { onmessage: ((event: MessageEvent<Command>) => void) | null; postMessage(message: unknown): void };
const scope = globalThis as unknown as Scope;
let disposed = false, writer: WritableStreamDefaultWriter<VideoFrame> | null = null, canvas: OffscreenCanvas, context: OffscreenCanvasRenderingContext2D;
let previous: OffscreenCanvas, previousContext: OffscreenCanvasRenderingContext2D, cameraSurface: ReturnType<typeof createStudioSceneCameraSurface>;
let width = 1920, height = 1080, fps = 30, selected: StudioCaptureScene = 'camera', config = studioDefaultSceneConfiguration(), grade = studioGrade(), zoom = 1;
let revision = 0, renderRequested = false, rendering = false, lastFrame = -Infinity, timestamp = 0, fadeStart = -Infinity;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let observer: ReadableStreamDefaultReader<VideoFrame> | null = null, inFlight: VideoFrame | null = null;
type Delivery = { timestamp: number; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
let delivery: Delivery | null = null;
const sources: Partial<Record<'camera' | 'screen', Source>> = {}, candidates = new Map<number, Source>(), requests = new Map<number, number>();
const desired: Partial<Record<'camera' | 'screen', number>> = {};
const output = (message: unknown) => { if (!disposed) scope.postMessage(message); };
const closeSource = (source?: Source) => { if (!source) return; source.ended = true; source.frame?.close(); source.frame = null; void source.reader.cancel().catch(() => undefined); };
const fail = (error: unknown) => { output({ type: 'error', message: error instanceof Error ? error.message : 'A composição das cenas foi interrompida.' }); dispose(); };
const settleDelivery = (error?: Error) => { const pending = delivery; if (!pending) return; delivery = null; clearTimeout(pending.timer); if (error) pending.reject(error); else pending.resolve(); };
const closeOutput = () => { inFlight?.close(); inFlight = null; };
function dispose() {
  if (disposed) return; disposed = true; if (heartbeat) clearInterval(heartbeat); heartbeat = null;
  settleDelivery(new DOMException('Captura cancelada.', 'AbortError')); closeOutput(); Object.values(sources).forEach(closeSource); candidates.forEach(closeSource); candidates.clear();
  void observer?.cancel().catch(() => undefined); cameraSurface?.dispose(); if (canvas) { canvas.width = 1; canvas.height = 1; } if (previous) { previous.width = 1; previous.height = 1; } void writer?.abort().catch(() => undefined);
  scope.postMessage({ type: 'disposed' });
}
async function observeProgram(reader: ReadableStreamDefaultReader<VideoFrame>) {
  try {
    while (!disposed) {
      const { value: frame, done } = await reader.read();
      if (frame) {
        try {
          const pending = delivery;
          if (!disposed && pending && frame.timestamp >= pending.timestamp) {
            if (frame.timestamp !== pending.timestamp || frame.displayWidth !== width || frame.displayHeight !== height) throw new Error('A saída das cenas não confirmou o quadro e a resolução solicitados.');
            settleDelivery();
          }
        } finally { frame.close(); }
      }
      if (done) { if (!disposed) throw new Error('A saída das cenas foi interrompida. O trecho capturado será preservado.'); break; }
    }
  } catch (error) { if (!disposed) fail(error); }
  finally { reader.releaseLock(); }
}
function waitForDelivery(expectedTimestamp: number) {
  const pending = new Promise<void>((resolve, reject) => { delivery = { timestamp: expectedTimestamp, resolve, reject,
    timer: setTimeout(() => settleDelivery(new Error('A saída das cenas não entregou imagem. Ative a captura novamente.')), 8000) }; });
  void pending.catch(() => undefined); return pending;
}
function requestRender() { if (disposed || !writer) return; renderRequested = true; if (!rendering) void render(); }
async function render() {
  rendering = true;
  try {
    while (renderRequested && !disposed && writer) {
      renderRequested = false;
      const now = performance.now(); if (now - lastFrame < 1000 / fps - 1 && !requests.size) continue;
      await writer.ready; if (disposed) break;
      const cam = sources.camera?.frame, screen = sources.screen?.frame;
      if (selected === 'camera' && !cam || selected !== 'camera' && !screen || selected === 'screen-camera' && !cam) continue;
      const renderedRevision = revision;
      const identity = grade.intensity === 0 || grade.preset === 'natural' && grade.exposure === 0 && grade.contrast === 0 && grade.saturation === 0 && grade.temperature === 0;
      // Raw frames need no extra GPU surface when the camera is hidden or its treatment is neutral.
      const processed = cam && selected !== 'screen' ? identity && zoom === 1 ? cam : cameraSurface.draw(cam, grade, zoom) : null;
      drawStudioScene(context, width, height, selected, config, processed, screen ?? null);
      const progress = Math.min(1, (now - fadeStart) / 220);
      if (progress < 1) { context.save(); context.globalAlpha = 1 - Math.max(0, progress); context.drawImage(previous, 0, 0); context.restore(); }
      // A single monotonic clock is used for both inputs: switching source never restarts the Program timeline.
      timestamp = Math.max(timestamp + 1, Math.round(performance.now() * 1000));
      const frame = new VideoFrame(canvas, { timestamp, duration: Math.round(1000000 / fps) });
      inFlight = frame;
      // Writable acceptance only schedules native delivery. Wait for the actual Program track before generating another 4K frame.
      const delivered = waitForDelivery(timestamp);
      try { await Promise.all([writer.write(frame), delivered]); } finally { settleDelivery(new DOMException('Quadro encerrado.', 'AbortError')); closeOutput(); }
      if (disposed) break;
      lastFrame = now; output({ type: 'frame', timestamp, revision: renderedRevision });
      for (const [request, expectedRevision] of requests) if (expectedRevision <= renderedRevision) { output({ type: 'ack', request, effects: cameraSurface.effects, revision: renderedRevision }); requests.delete(request); }
    }
  } catch (error) { if (!disposed) fail(error); }
  finally { rendering = false; }
}
async function readSource(name: 'camera' | 'screen', id: number, readable: ReadableStream<VideoFrame>) {
  const source: Source = { name, id, reader: readable.getReader(), frame: null, received: performance.now(), ended: false }; candidates.set(id, source);
  try {
    while (!disposed && !source.ended) {
      const { value: frame, done } = await source.reader.read(); if (done) break;
      if (disposed || source.ended) { frame?.close(); break; } if (!frame) continue;
      if (candidates.has(id)) {
        if (desired[name] !== id) { frame.close(); output({ type: 'source-cancelled', source: name, id }); break; }
        candidates.delete(id); closeSource(sources[name]); sources[name] = source;
        output({ type: 'source-ready', source: name, id });
      }
      source.frame?.close(); source.frame = frame; source.received = performance.now(); requestRender();
    }
    if (!disposed && !source.ended && sources[name] === source) { delete sources[name]; output({ type: 'source-lost', source: name, id }); }
  } catch (error) { if (!disposed && !source.ended) output({ type: 'source-error', source: name, id, message: error instanceof Error ? error.message : 'Esta entrada não entregou imagem.' }); }
  finally { candidates.delete(id); closeSource(source); }
}
scope.onmessage = ({ data }) => {
  if (disposed) return;
  try {
    if (data.type === 'init') {
      width = data.width!; height = data.height!; fps = data.fps!; writer = data.writable!.getWriter();
      if (!data.outputReadable) throw new Error('O navegador não permite confirmar a saída das cenas.');
      observer = data.outputReadable.getReader(); void observeProgram(observer);
      canvas = new OffscreenCanvas(width, height); context = canvas.getContext('2d', { alpha: false })!;
      previous = new OffscreenCanvas(width, height); previousContext = previous.getContext('2d', { alpha: false })!;
      if (!context || !previousContext) throw new Error('A composição de cenas não está disponível neste navegador.');
      cameraSurface = createStudioSceneCameraSurface(); output({ type: 'ready', effects: cameraSurface.effects });
      heartbeat = setInterval(() => {
        const camera = sources.camera;
        if (camera && performance.now() - camera.received > 6000) { delete sources.camera; closeSource(camera); output({ type: 'source-lost', source: 'camera', id: camera.id }); }
        requestRender();
      }, 1000 / fps);
    } else if (data.type === 'source') {
      desired[data.source!] = data.id!;
      candidates.forEach(source => { if (source.name === data.source) { closeSource(source); candidates.delete(source.id); output({ type: 'source-cancelled', source: source.name, id: source.id }); } });
      void readSource(data.source!, data.id!, data.readable!);
    }
    else if (data.type === 'remove') {
      const active = sources[data.source!]; if (active?.id === data.id || data.id === undefined) { closeSource(active); delete sources[data.source!]; }
      candidates.forEach(source => { if (source.name === data.source && (data.id === undefined || source.id === data.id)) { closeSource(source); candidates.delete(source.id); output({ type: 'source-cancelled', source: source.name, id: source.id }); } });
      if (data.id === undefined || desired[data.source!] === data.id) delete desired[data.source!];
    } else if (data.type === 'configure') {
      if (data.selected && data.selected !== selected) {
        if (data.config?.transition === 'fade') { previousContext.drawImage(canvas, 0, 0); fadeStart = performance.now(); } else fadeStart = -Infinity;
        selected = data.selected;
      }
      if (data.config) config = data.config; if (data.grade) grade = data.grade; if (data.zoom !== undefined) zoom = data.zoom;
      revision++; if (data.request !== undefined) requests.set(data.request, revision); requestRender();
    } else if (data.type === 'dispose') dispose();
  } catch (error) { fail(error); }
};
