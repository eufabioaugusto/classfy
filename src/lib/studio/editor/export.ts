import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality, StreamTarget, canEncodeAudio, canEncodeVideo, type Target } from 'mediabunny';
import { compileStudioRecipe, validateStudioRecipe, type StudioProject, type StudioRenderRecipe } from '../../../../shared/studio';
import { assertStudioActive, inspectStudioMedia, studioCanvas, type StudioAssetResolver } from './media';
import { StudioRenderKernel, studioBrowserFont } from './renderer';
import { getStudioAACDelay, StudioAACSource } from './exportAudio';

export type StudioBrowserExportCapabilities = {
  available: boolean; reason?: string; audio: boolean; colorSpace: 'rec709';
  profiles: { resolution: '720p' | 'hd' | '2k' | '4k'; width: number; height: number; frameRate: 24 | 30 | 60 }[];
};
const cleanup = new WeakMap<File, () => Promise<void>>();
let capabilities: Promise<StudioBrowserExportCapabilities> | null = null;
const audioQuality = new Quality({ bitrate: 192000 });
export function studioExportBitrate(width: number, height: number, fps: number) { return Math.max(2500000, Math.min(50000000, Math.round(width * height * fps * .11))); }
/** A support probe, not a promise that a thermally constrained encoder will complete. */
export function getStudioExportCapabilities(): Promise<StudioBrowserExportCapabilities> {
  return capabilities ??= (async () => {
    const audio = await canEncodeAudio('aac', { numberOfChannels:2, sampleRate:48000, quality:audioQuality }).catch(() => false);
    const profiles: StudioBrowserExportCapabilities['profiles'] = [];
    for (const [resolution,width,height] of [['720p',1280,720],['hd',1920,1080],['2k',2560,1440],['4k',3840,2160]] as const) for (const frameRate of [24,30,60] as const) {
      if (await canEncodeVideo('avc', { width,height,frameRate,quality:new Quality({bitrate:studioExportBitrate(width,height,frameRate)}) }).catch(() => false)) profiles.push({resolution,width,height,frameRate});
    }
    return { available: profiles.length > 0, audio, colorSpace:'rec709', profiles, ...(!profiles.length ? {reason:'Este navegador não oferece encoder H.264 para exportar MP4. Use Chrome, Edge ou Safari atualizado.'} : {}) };
  })();
}
export async function releaseStudioExport(file: File) { const release = cleanup.get(file); if (release) { cleanup.delete(file); await release(); } }

type ExportTarget = { target: Target; file(name:string,mime:string):Promise<File>; release():Promise<void> };
async function createExportTarget(estimatedBytes: number): Promise<ExportTarget> {
  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory(), directory = await root.getDirectoryHandle('classfy-studio-export', {create:true});
    const name = `${crypto.randomUUID()}.mp4`, handle = await directory.getFileHandle(name,{create:true});
    let writer: FileSystemWritableFileStream;
    try { writer = await handle.createWritable(); } catch (error) { await directory.removeEntry(name).catch(() => {}); throw error; }
    const target = new StreamTarget(new WritableStream({
      write(chunk) { return writer.write({type:'write',position:chunk.position,data:chunk.data}); },
      close() { return writer.close(); }, abort(reason) { return writer.abort(reason); },
    }), {chunked:true,chunkSize:1024*1024});
    return { target, async file(fileName,mime) { return new File([await handle.getFile()],fileName,{type:mime}); }, async release() { await directory.removeEntry(name).catch(() => {}); } };
  }
  if (estimatedBytes > 100 * 1024 * 1024) throw new Error('Esta exportação exige armazenamento temporário em disco. Use Chrome ou Edge atualizado para exportar aulas longas.');
  const target = new BufferTarget();
  return {target, async file(name,mime) { if (!target.buffer) throw new Error('O encoder não produziu um arquivo.'); return new File([target.buffer],name,{type:mime}); },async release(){}};
}
export type StudioExportKernel = Pick<StudioRenderKernel, 'draw' | 'mixAudio' | 'dispose'>;
export type StudioExportOptions = { signal?:AbortSignal; onProgress?:(value:number)=>void; kernelFactory?:(recipe:StudioRenderRecipe, resolver:StudioAssetResolver, signal?:AbortSignal)=>StudioExportKernel };
/** Offline encoding: encoder backpressure + bounded frame/audio decoding, no realtime recorder. */
export async function exportStudioProject(project: StudioProject, resolveAsset: StudioAssetResolver, options: StudioExportOptions = {}): Promise<File> {
  return exportStudioRecipe(compileStudioRecipe(structuredClone(project)),resolveAsset,{...options,name:project.title});
}
export async function exportStudioRecipe(inputRecipe: StudioRenderRecipe, resolveAsset: StudioAssetResolver, {signal,onProgress,name='Montagem Classfy',kernelFactory}: StudioExportOptions & {name?:string} = {}): Promise<File> {
  // The immutable snapshot is taken before the first await, including source trim/rate/grade.
  const recipe = structuredClone(inputRecipe), issues = validateStudioRecipe(recipe); if (issues.length) throw new Error(issues[0]); assertStudioActive(signal);
  const duration = recipe.durationTicks / recipe.timebase, fps = recipe.output.frameRateNumerator / recipe.output.frameRateDenominator;
  if (!duration || !Number.isFinite(duration)) throw new Error('Adicione conteúdo antes de exportar.');
  const hasAudio = recipe.mediaType === 'audio' || recipe.clips.some(c => c.kind === 'audio' || c.kind === 'video' && recipe.assets.find(a => a.id === c.assetId)?.hasAudio !== false);
  const bitrate = studioExportBitrate(recipe.output.width,recipe.output.height,fps), quality = new Quality({bitrate});
  if (recipe.mediaType === 'video' && !await canEncodeVideo('avc',{width:recipe.output.width,height:recipe.output.height,frameRate:fps,quality})) throw new Error('O encoder deste navegador não suporta esta resolução e cadência. Escolha HD a30fps ou outro navegador.');
  if (hasAudio && !await canEncodeAudio('aac',{numberOfChannels:2,sampleRate:48000,quality:audioQuality})) throw new Error('Este navegador não oferece encoder AAC para o áudio da montagem. Use Chrome, Edge ou Safari atualizado.');
  const audioDelay = hasAudio ? await getStudioAACDelay(signal) : 0;
  assertStudioActive(signal); const storage = await createExportTarget(duration * ((recipe.mediaType === 'video' ? bitrate : 0) + (hasAudio ? 192000 : 0)) / 8 * 1.2);
  const canvas = studioCanvas(recipe.output.width,recipe.output.height);
  let kernel: StudioExportKernel;
  try { kernel = kernelFactory ? kernelFactory(recipe,resolveAsset,signal) : new StudioRenderKernel(recipe,resolveAsset,signal); }
  catch (error) { canvas.width=1; canvas.height=1; await storage.release(); throw error; }
  const output = new Output({format:new Mp4OutputFormat({fastStart:false}),target:storage.target});
  const video = recipe.mediaType === 'video' ? new CanvasSource(canvas,{codec:'avc',quality,keyFrameInterval:2,latencyMode:'quality'}) : null;
  const audio = hasAudio ? new StudioAACSource(duration,audioDelay,signal) : null;
  if (video) output.addVideoTrack(video,{frameRate:fps}); if (audio) output.addAudioTrack(audio.source);
  const abort = () => { void output.cancel().catch(() => {}); }; signal?.addEventListener('abort',abort,{once:true});
  let success = false;
  try {
    await Promise.all(recipe.clips.filter(c => c.text).map(c => document.fonts?.load(`16px ${studioBrowserFont(c.text!.fontFamily)}`).catch(() => [])));
    assertStudioActive(signal); onProgress?.(0); await output.start();
    let audioAt = 0, frame = 0; const totalFrames = video ? Math.ceil(duration * fps) : 0;
    // Advance both encoders together so the muxer cannot retain an entire encoded track.
    while (frame < totalFrames || audio && audioAt < duration - .000001) {
      assertStudioActive(signal);
      const videoAt = frame / fps;
      if (video && frame < totalFrames && (!audio || videoAt <= audioAt)) {
        await kernel.draw(canvas,videoAt); assertStudioActive(signal);
        await video.add(videoAt,Math.min(1/fps,duration-videoAt)); frame++;
      } else if (audio && audioAt < duration - .000001) {
        const length = Math.min(.25,duration-audioAt), samples = await kernel.mixAudio(audioAt,length,48000); assertStudioActive(signal);
        await audio.add(samples); audioAt += samples[0].length / 48000;
      }
      onProgress?.(Math.min(.97, Math.min(video ? frame/fps : duration,audio ? audioAt : duration) / duration * .97));
    }
    video?.close(); await audio?.close(); assertStudioActive(signal); await output.finalize(); assertStudioActive(signal);
    const base = name.replace(/[\\/:*?"<>|]/g,' ').trim().slice(0,100) || 'Montagem Classfy';
    const file = await storage.file(`${base}.${video ? 'mp4' : 'm4a'}`,video ? 'video/mp4' : 'audio/mp4'); assertStudioActive(signal);
    const metadata = await inspectStudioMedia(file,{signal});
    if (Math.abs(metadata.duration-duration) > Math.max(.15,2/fps) || video && (metadata.width !== recipe.output.width || metadata.height !== recipe.output.height || metadata.frameRate !== undefined && Math.abs(metadata.frameRate-fps) > Math.max(.02,fps*.001)) || hasAudio && !metadata.hasAudio) throw new Error('O encoder não preservou a duração, o quadro, a cadência ou o áudio solicitado. O arquivo incompleto foi descartado.');
    success=true; cleanup.set(file,storage.release); onProgress?.(1); return file;
  } finally {
    signal?.removeEventListener('abort',abort); audio?.dispose(); kernel.dispose(); canvas.width=1; canvas.height=1;
    if (!success) { await output.cancel().catch(() => {}); await storage.release(); }
  }
}
