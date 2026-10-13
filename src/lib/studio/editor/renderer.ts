import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny';
import { assertStudioRenderFeatures, studioGrade, validateStudioRecipe, type StudioEnhancement, type StudioGrade, type StudioRecipeClip, type StudioRenderRecipe } from '../../../../shared/studio';
import { studioEnhancementPixel } from '../../../../shared/studio/autoEnhance';
import { createStudioPortraitSurface, type StudioPortraitSurface } from './portraitRender';
import { assertStudioActive, studioCanvas, type StudioAssetResolver } from './media';

export type StudioRendererState = { position: number; playing: boolean; loading: boolean; error: string | null };
export type StudioRenderer = {
  bindCanvas(canvas: HTMLCanvasElement | null): void;
  preparePortrait(signal?: AbortSignal): Promise<void>;
  draw(canvas: HTMLCanvasElement, seconds: number): Promise<void>;
  seek(seconds: number): Promise<void>; play(): Promise<void>; pause(): void;
  setRecipe(recipe: StudioRenderRecipe): Promise<void>; dispose(): void;
  subscribe(listener: (state: StudioRendererState) => void): () => void;
};
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
export const STUDIO_WEB_RENDER_FEATURES = ['enhancement-v1', 'portrait-v1'] as const;
export function studioClipEnvelope(clip: StudioRecipeClip, localTicks: number) {
  const fadeIn = clip.fadeInTicks ? clamp(localTicks / clip.fadeInTicks) : 1;
  const fadeOut = clip.fadeOutTicks ? clamp((clip.durationTicks - localTicks) / clip.fadeOutTicks) : 1;
  return Math.min(fadeIn, fadeOut);
}
export function studioClipSourceSeconds(clip: StudioRecipeClip, seconds: number, timebase: number) {
  return (clip.sourceStartTicks + (seconds * timebase - clip.startTicks) * (clip.playbackRate ?? 1)) / timebase;
}
export function studioClipPose(clip: StudioRecipeClip, localTicks: number, timebase: number) {
  const p = clamp((localTicks + (clip.animationOffsetTicks ?? 0)) / Math.max(1, clip.text?.animationDurationTicks ?? Math.min(48000, clip.durationTicks)));
  const ease = 1 - Math.pow(1 - p, 3);
  let scale = 1, x = 0, y = 0, alpha = 1;
  switch (clip.text?.animation) {
    case 'pop': { const q = p - 1; scale = .45 + .55 * (1 + 2.70158 * q ** 3 + 1.70158 * q ** 2); alpha = Math.min(1, p * 5); break; }
    case 'bounce': scale = p >= 1 ? 1 : Math.max(.05, 1 - .45 * Math.exp(-6 * p) * Math.cos(3 * Math.PI * p)); y = p >= 1 ? 0 : .12 * Math.exp(-6 * p) * Math.sin(3 * Math.PI * p); alpha = Math.min(1, p * 5); break;
    case 'fade': alpha = p; break;
    case 'zoom': scale = .6 + .4 * ease; alpha = Math.min(1, p * 4); break;
    case 'slide-right': x = -.85 * (1 - ease); alpha = Math.min(1, p * 4); break;
  }
  const ticks = localTicks + (clip.motionOffsetTicks ?? 0), span = Math.max(1, clip.motionDurationTicks ?? clip.durationTicks);
  switch (clip.motion) {
    case 'fade-in': alpha *= clamp(ticks / Math.min(48000, span)); break;
    case 'fade-out': alpha *= clamp((span - ticks) / Math.min(48000, span)); break;
    case 'zoom-in': scale *= 1 + .12 * clamp(ticks / span); break;
    case 'pulse': scale *= 1 + .035 * Math.sin(ticks / timebase * 2 * Math.PI); break;
    case 'blink': alpha *= Math.cos(ticks / timebase * 4 * Math.PI) >= 0 ? 1 : .15; break;
  }
  return { scale, x, y, alpha: alpha * clip.opacity * studioClipEnvelope(clip, localTicks), progress: p };
}
export function studioFitRect(sw: number, sh: number, width: number, height: number, fit: 'contain' | 'cover') {
  const ratio = fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh);
  return { x: (width - sw * ratio) / 2, y: (height - sh * ratio) / 2, width: sw * ratio, height: sh * ratio };
}

/** Shared tonal math. The web Studio preset is global color, without face/depth retouch. */
export function studioGradePixel(rgb: readonly number[], grade: StudioGrade): number[] {
  if (grade.intensity === 0) return [...rgb];
  const points = grade.preset === 'cinematic' ? [.012, .235, .495, .745, .985] : grade.preset === 'studio' ? [0, .235, .505, .765, 1] : [0, .25, .5, .75, 1];
  const tone = (v: number) => { const t = clamp(v) * 4, i = Math.min(3, Math.floor(t)); return points[i] + (points[i + 1] - points[i]) * (t - i); };
  const exposed = rgb.map((v, i) => tone(v * 2 ** grade.exposure * (i === 0 ? 1 + grade.temperature * .08 : i === 2 ? 1 - grade.temperature * .08 : 1)));
  const luma = exposed[0] * .2126 + exposed[1] * .7152 + exposed[2] * .0722;
  const saturation = (grade.preset === 'cinematic' ? .96 : 1) + grade.saturation * .4;
  return exposed.map((v, i) => clamp(rgb[i] + ((((luma + (v - luma) * saturation) - .5) * (1 + grade.contrast * .25) + .5) - rgb[i]) * grade.intensity));
}

class StudioGradeSurface {
  readonly canvas = studioCanvas(1, 1);
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private fallback: HTMLCanvasElement | null = null;
  constructor() {
    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    const gl = this.gl; if (!gl) return;
    const compile = (type: number, source: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader de cor indisponível.'); return s; };
    try {
      const program = gl.createProgram()!;
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.0)*.5,(1.0-p.y)*.5);gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision highp float; varying vec2 uv; uniform sampler2D image; uniform float intensity,exposure,contrast,saturation,temperature,preset;
        uniform float autoStrength,autoExposure,autoContrast,autoSaturation,autoTemperature,autoTint,autoShadows,autoHighlights;
        vec3 enhance(vec3 c){vec3 e=c*pow(2.,autoExposure)*vec3(1.+autoTemperature*.08,1.+autoTint*.06,1.-autoTemperature*.08);float y=dot(e,vec3(.2126,.7152,.0722));float lift=autoShadows*.14*(1.-smoothstep(.05,.65,y))+autoHighlights*.14*smoothstep(.5,1.,y);e=(e+lift-.42)*(1.+autoContrast*.25)+.42;float l=dot(e,vec3(.2126,.7152,.0722));return clamp(mix(c,vec3(l)+(e-vec3(l))*(1.+autoSaturation*.4),autoStrength),0.,1.);}
        float tone(float v){ float t=clamp(v,0.,1.)*4.; float i=floor(min(3.,t)); vec4 a=vec4(0.,.25,.5,.75);vec4 b=vec4(.25,.5,.75,1.);
        if(preset>1.5){a=vec4(.012,.235,.495,.745);b=vec4(.235,.495,.745,.985);}else if(preset>.5){a=vec4(0.,.235,.505,.765);b=vec4(.235,.505,.765,1.);}
        float lo=i<.5?a.x:i<1.5?a.y:i<2.5?a.z:a.w;float hi=i<.5?b.x:i<1.5?b.y:i<2.5?b.z:b.w;return mix(lo,hi,t-i);}
        void main(){vec4 c=texture2D(image,uv);c.rgb=enhance(c.rgb);vec3 e=c.rgb*pow(2.,exposure)*vec3(1.+temperature*.08,1.,1.-temperature*.08);e=vec3(tone(e.r),tone(e.g),tone(e.b));float l=dot(e,vec3(.2126,.7152,.0722));e=vec3(l)+(e-vec3(l))*((preset>1.5?.96:1.)+saturation*.4);e=(e-.5)*(1.+contrast*.25)+.5;gl_FragColor=vec4(clamp(mix(c.rgb,e,intensity),0.,1.),c.a);}`));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader indisponível.');
      gl.useProgram(program); this.program = program;
      const vertices = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const p = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
      this.texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } catch { gl.getExtension('WEBGL_lose_context')?.loseContext(); this.gl = null; }
  }
  render(source: CanvasImageSource, width: number, height: number, grade: StudioGrade, enhancement?: StudioEnhancement): CanvasImageSource {
    const gl = this.gl;
    if (gl && this.program) {
      if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
      gl.viewport(0, 0, width, height); gl.useProgram(this.program); gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
      for (const [name, value] of Object.entries({ intensity: grade.intensity, exposure: grade.exposure, contrast: grade.contrast, saturation: grade.saturation, temperature: grade.temperature, preset: grade.preset === 'cinematic' ? 2 : grade.preset === 'studio' ? 1 : 0 })) gl.uniform1f(gl.getUniformLocation(this.program, name), value);
      for (const [name, value] of Object.entries({ autoStrength: enhancement?.strength ?? 0, autoExposure: enhancement?.exposure ?? 0, autoContrast: enhancement?.contrast ?? 0, autoSaturation: enhancement?.saturation ?? 0, autoTemperature: enhancement?.temperature ?? 0, autoTint: enhancement?.tint ?? 0, autoShadows: enhancement?.shadows ?? 0, autoHighlights: enhancement?.highlights ?? 0 })) gl.uniform1f(gl.getUniformLocation(this.program, name), value);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return this.canvas;
    }
    const canvas = this.fallback ??= studioCanvas(width, height); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(source, 0, 0, width, height);
    const pixels = ctx.getImageData(0, 0, width, height);
    for (let i = 0; i < pixels.data.length; i += 4) { const rgb = studioGradePixel(studioEnhancementPixel([pixels.data[i]/255,pixels.data[i+1]/255,pixels.data[i+2]/255], enhancement), grade); for (let c = 0; c < 3; c++) pixels.data[i+c] = Math.round(rgb[c]*255); }
    ctx.putImageData(pixels, 0, 0); return canvas;
  }
  dispose() { this.gl?.getExtension('WEBGL_lose_context')?.loseContext(); this.canvas.width = 1; this.canvas.height = 1; this.fallback = null; }
}

type Resource = { input?: Input; image?: ImageBitmap; video?: CanvasSink; audio?: AudioBufferSink; width: number; height: number };
type VideoReader = { iterator: AsyncGenerator<WrappedCanvas, void, unknown>; current?: WrappedCanvas; next?: WrappedCanvas; last: number };
export class StudioRenderKernel {
  readonly recipe: StudioRenderRecipe;
  private resources = new Map<string, Promise<Resource>>();
  private readers = new Map<string, VideoReader>();
  private grades = new StudioGradeSurface();
  private textCache = new Map<string, HTMLCanvasElement>();
  private drawResources = new Set<string>();
  private audioResources = new Set<string>();
  private resourceUses = new Map<string, number>();
  private disposed = false;
  private portraits: StudioPortraitSurface;
  private ownsPortraits: boolean;
  constructor(recipe: StudioRenderRecipe, private resolveAsset: StudioAssetResolver, private signal?: AbortSignal, portraits?: StudioPortraitSurface) {
    this.recipe = structuredClone(recipe); const issues = validateStudioRecipe(this.recipe); if (issues.length) throw new Error(issues[0]);
    assertStudioRenderFeatures(this.recipe, STUDIO_WEB_RENDER_FEATURES);
    this.portraits = portraits ?? createStudioPortraitSurface(); this.ownsPortraits = !portraits;
  }
  private assert() { assertStudioActive(this.signal); if (this.disposed) throw new DOMException('Prévia encerrada.', 'AbortError'); }
  private windowResources(seconds: number) {
    return new Set(this.recipe.clips.filter(clip => clip.assetId && clip.startTicks / this.recipe.timebase <= seconds + 2 && (clip.startTicks + clip.durationTicks) / this.recipe.timebase >= seconds - 2).map(clip => clip.assetId!));
  }
  private holdResources(ids: Iterable<string>) {
    const owned = new Set(ids); for (const id of owned) this.resourceUses.set(id, (this.resourceUses.get(id) ?? 0) + 1);
    return () => { for (const id of owned) { const count = (this.resourceUses.get(id) ?? 0) - 1; if (count > 0) this.resourceUses.set(id, count); else this.resourceUses.delete(id); } };
  }
  private prune() {
    if (this.disposed) return;
    // Audio lookahead and rendering can await independently. Keep both recent
    // windows, active decoders, and in-flight leases before closing an Input.
    const retained = new Set([...this.drawResources, ...this.audioResources, ...this.resourceUses.keys()]);
    for (const id of this.readers.keys()) { const source = this.recipe.clips.find(clip => clip.id === id)?.assetId; if (source) retained.add(source); }
    for (const [id, resource] of this.resources) if (!retained.has(id)) {
      this.resources.delete(id); void resource.then(value => { value.input?.dispose(); value.image?.close(); }).catch(() => {});
    }
  }
  private resource(id: string): Promise<Resource> {
    let pending = this.resources.get(id);
    if (!pending) {
      pending = (async () => {
        this.assert(); const asset = this.recipe.assets.find(a => a.id === id); if (!asset) throw new Error('Original não encontrado.');
        const blob = await this.resolveAsset(id); this.assert(); if (!blob) throw new Error(`O original ${asset.name} não está salvo neste navegador.`);
        if (asset.kind === 'image') { const image = await createImageBitmap(blob); if (this.disposed || this.signal?.aborted) { image.close(); this.assert(); } return { image, width: image.width, height: image.height }; }
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
        try {
          const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]); this.assert();
          if (video && !await video.canDecode() || audio && !await audio.canDecode()) throw new Error('O codec de um original não pode ser decodificado neste navegador.');
          return { input, video: video ? new CanvasSink(video) : undefined, audio: audio ? new AudioBufferSink(audio) : undefined, width: video ? await video.getDisplayWidth() : 0, height: video ? await video.getDisplayHeight() : 0 };
        } catch (error) { input.dispose(); throw error; }
      })(); this.resources.set(id, pending); pending.catch(() => { if (this.resources.get(id) === pending) this.resources.delete(id); });
    }
    return pending;
  }
  private async frame(clip: StudioRecipeClip, seconds: number): Promise<CanvasImageSource> {
    const source = await this.resource(clip.assetId!); this.assert(); if (source.image) return source.image;
    if (!source.video) throw new Error('A faixa de vídeo do original está ausente.');
    const target = Math.max(0, Math.min(clip.sourceEndTicks / this.recipe.timebase - .000001, studioClipSourceSeconds(clip, seconds, this.recipe.timebase)));
    let reader = this.readers.get(clip.id);
    if (!reader || target < reader.last - .00001 || target - reader.last > 2) {
      if (reader) void reader.iterator.return();
      reader = { iterator: source.video.canvases(target), last: target }; this.readers.set(clip.id, reader);
    }
    if (!reader.current) { const value = await reader.iterator.next(); this.assert(); reader.current = value.value || undefined; }
    while (reader.current) {
      if (!reader.next) { const value = await reader.iterator.next(); this.assert(); reader.next = value.value || undefined; }
      if (!reader.next || reader.next.timestamp > target + .000001) break;
      reader.current = reader.next; reader.next = undefined;
    }
    reader.last = target;
    if (!reader.current) throw new Error('Não foi possível decodificar o quadro do original.');
    return reader.current.canvas;
  }
  private text(clip: StudioRecipeClip, width: number, height: number, progress: number): HTMLCanvasElement {
    const style = clip.text!; const content = style.animation === 'typewriter' ? graphemes(style.content).slice(0, Math.floor(graphemes(style.content).length * progress)).join('') : style.content;
    const key = JSON.stringify([style, width, height, content]); const cached = this.textCache.get(key); if (cached) return cached;
    const canvas = studioCanvas(width, height), ctx = canvas.getContext('2d')!;
    const fontSize = Math.max(1, style.fontSize * this.recipe.output.height * height / Math.max(1, Math.round(clip.rect.height * this.recipe.output.height)));
    const font = studioBrowserFont(style.fontFamily); ctx.font = `${fontSize}px ${font}`; ctx.textBaseline = 'middle';
    const inset = Math.min(8 * height / Math.max(1, clip.rect.height * this.recipe.output.height), width / 8, height / 8), available = Math.max(1, width - inset * 2);
    const lines = wrapStudioText(ctx, style.content, available), lineHeight = fontSize * 1.2;
    const top = (height - lines.length * lineHeight) / 2 + lineHeight / 2;
    const secondary = style.secondaryColor ?? '#000000', inverse = style.decoration?.endsWith('inverse');
    const fill = inverse ? secondary : style.color, decoration = inverse ? style.color : secondary;
    if (style.backgroundColor && style.backgroundColor !== '#00000000') { ctx.fillStyle = style.backgroundColor; ctx.fillRect(0, 0, width, height); }
    if (style.decoration?.startsWith('background')) { ctx.fillStyle = decoration; ctx.fillRect(0, 0, width, height); }
    let remaining = graphemes(content).length;
    lines.forEach((line, index) => {
      const clusters = graphemes(line); const visible = style.animation === 'typewriter' ? clusters.slice(0, Math.max(0, remaining)).join('') : line;
      remaining -= clusters.length; const fullWidth = ctx.measureText(line).width;
      const x = style.alignment === 'left' ? inset : style.alignment === 'right' ? width - inset - fullWidth : (width - fullWidth) / 2, y = top + index * lineHeight;
      ctx.fillStyle = fill;
      if (style.gradientColors) { const gradient = ctx.createLinearGradient(0, 0, width, 0); gradient.addColorStop(0, style.gradientColors[0]); gradient.addColorStop(1, style.gradientColors[1]); ctx.fillStyle = gradient; }
      const effect = style.visualEffect;
      if (effect && effect !== 'none') {
        ctx.save(); ctx.fillStyle = secondary; ctx.shadowColor = effect === 'neon' || effect === 'glow' || effect === 'halo' ? fill : secondary;
        ctx.shadowBlur = effect === 'shadow-soft' ? fontSize * .12 : effect === 'shadow-strong' ? fontSize * .05 : effect === 'block' ? 0 : effect === 'neon' ? fontSize * .10 : effect === 'halo' ? fontSize * .03 : fontSize * .25;
        ctx.shadowOffsetX = effect === 'block' || effect === 'shadow-strong' ? fontSize * .06 : 0; ctx.shadowOffsetY = effect.startsWith('shadow') || effect === 'block' ? fontSize * .06 : 0;
        if (effect === 'halo') { ctx.lineWidth = Math.max(1,fontSize*.16); ctx.strokeStyle = secondary; ctx.strokeText(visible,x,y); }
        else { ctx.fillText(visible,x,y); if (effect === 'neon') { ctx.lineWidth = Math.max(1,fontSize*.045); ctx.strokeStyle = fill; ctx.strokeText(visible,x,y); } }
        ctx.restore();
      }
      if (style.decoration?.startsWith('outline')) { ctx.strokeStyle = decoration; ctx.lineWidth = Math.max(1, fontSize * .08); ctx.lineJoin = 'round'; ctx.strokeText(visible, x, y); }
      ctx.fillText(visible, x, y);
    });
    // Typewriter has a finite, byte-bounded LRU. Long lessons never retain every raster.
    this.textCache.set(key, canvas); let bytes = [...this.textCache.values()].reduce((n, v) => n + v.width * v.height * 4, 0);
    while (this.textCache.size > 24 || bytes > 32 * 1024 * 1024) { const first = this.textCache.keys().next().value!; const old = this.textCache.get(first)!; bytes -= old.width * old.height * 4; this.textCache.delete(first); }
    return canvas;
  }
  async draw(canvas: HTMLCanvasElement, seconds: number): Promise<void> {
    this.assert(); this.drawResources = this.windowResources(seconds);
    const release = this.holdResources(this.drawResources);
    try { await this.drawFrame(canvas, seconds); } finally { release(); this.prune(); }
  }
  private async drawFrame(canvas: HTMLCanvasElement, seconds: number): Promise<void> {
    this.assert(); const ctx = canvas.getContext('2d', { alpha: false })!;
    ctx.fillStyle = this.recipe.canvas.backgroundColor; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const ticks = clamp(seconds, 0, this.recipe.durationTicks / this.recipe.timebase - .000001) * this.recipe.timebase;
    const visible = this.recipe.clips.filter(c => c.kind !== 'audio' && ticks >= c.startTicks && ticks < c.startTicks + c.durationTicks).sort((a,b) => a.zIndex - b.zIndex);
    const activeIds = new Set(visible.map(c => c.id)); for (const [id, reader] of this.readers) if (!activeIds.has(id)) { void reader.iterator.return(); this.readers.delete(id); }
    for (const clip of visible) {
      const local = ticks - clip.startTicks, pose = studioClipPose(clip, local, this.recipe.timebase); if (pose.alpha <= 0) continue;
      const width = Math.max(1, Math.round(clip.rect.width * canvas.width)), height = Math.max(1, Math.round(clip.rect.height * canvas.height));
      let source: CanvasImageSource; let sw: number, sh: number;
      if (clip.kind === 'text' || clip.kind === 'caption') { source = this.text(clip, width, height, pose.progress); sw = width; sh = height; }
      else {
        source = await this.frame(clip, seconds); this.assert(); const resource = await this.resource(clip.assetId!); sw = resource.width; sh = resource.height;
        const grade = clip.grade ?? studioGrade(clip.effect);
        if ((clip.portrait?.strength ?? 0) > 0 || (clip.enhancement?.strength ?? 0) > 0 || grade.intensity > 0 && (grade.preset !== 'natural' || grade.exposure || grade.contrast || grade.saturation || grade.temperature)) {
          const downscale = Math.min(1, Math.max(canvas.width, canvas.height) / Math.max(sw, sh));
          sw = Math.max(1, Math.round(sw * downscale)); sh = Math.max(1, Math.round(sh * downscale));
          if ((clip.portrait?.strength ?? 0) > 0) { source = await this.portraits.render(source, sw, sh, clip.portrait!.strength, this.signal); this.assert(); }
          source = this.grades.render(source, sw, sh, grade, clip.enhancement);
        }
      }
      const fit = studioFitRect(sw, sh, width, height, clip.fit);
      ctx.save(); ctx.globalAlpha = pose.alpha;
      ctx.translate((clip.rect.x + clip.rect.width / 2 + pose.x * clip.rect.width) * canvas.width, (clip.rect.y + clip.rect.height / 2 + pose.y * clip.rect.height) * canvas.height);
      ctx.rotate(clip.rotationDegrees * Math.PI / 180); ctx.scale(pose.scale * (clip.flipHorizontal ? -1 : 1), pose.scale * (clip.flipVertical ? -1 : 1));
      if (clip.fit === 'cover') { ctx.beginPath(); ctx.rect(-width / 2, -height / 2, width, height); ctx.clip(); }
      ctx.drawImage(source, fit.x - width / 2, fit.y - height / 2, fit.width, fit.height); ctx.restore();
    }
  }
  async mixAudio(start: number, duration: number, sampleRate = 48000): Promise<Float32Array[]> {
    this.assert(); this.audioResources = this.windowResources(start + duration / 2);
    const release = this.holdResources(this.recipe.clips.filter(clip => clip.assetId && clip.gain > 0 && (clip.kind === 'video' || clip.kind === 'audio') && clip.startTicks / this.recipe.timebase < start + duration && (clip.startTicks + clip.durationTicks) / this.recipe.timebase > start).map(clip => clip.assetId!));
    try { return await this.mixAudioBlock(start, duration, sampleRate); } finally { release(); this.prune(); }
  }
  private async mixAudioBlock(start: number, duration: number, sampleRate: number): Promise<Float32Array[]> {
    this.assert(); const count = Math.max(1, Math.round(duration * sampleRate)), result = [new Float32Array(count), new Float32Array(count)];
    const timebase = this.recipe.timebase;
    for (const clip of this.recipe.clips) {
      if (!clip.assetId || clip.gain <= 0 || clip.kind === 'image' || clip.kind === 'text' || clip.kind === 'caption') continue;
      const from = Math.max(start, clip.startTicks / timebase), end = Math.min(start + duration, (clip.startTicks + clip.durationTicks) / timebase); if (end <= from) continue;
      const resource = await this.resource(clip.assetId); this.assert();
      if (!resource.audio) {
        if (clip.kind === 'audio' || this.recipe.assets.find(asset => asset.id === clip.assetId)?.hasAudio === true) throw new Error('Uma faixa de áudio do original está ausente. Reimporte o arquivo para recuperar a montagem.');
        continue;
      }
      const rate = clip.playbackRate ?? 1, sourceFrom = studioClipSourceSeconds(clip, from, timebase), sourceEnd = studioClipSourceSeconds(clip, end, timebase);
      const iterator = resource.audio.buffers(Math.max(0, sourceFrom), sourceEnd + 1 / sampleRate);
      try { for await (const wrapped of iterator) {
        this.assert(); const buffer = wrapped.buffer;
        const first = Math.max(0, Math.ceil((from - start) * sampleRate), Math.ceil(((wrapped.timestamp - clip.sourceStartTicks / timebase) / rate + clip.startTicks / timebase - start) * sampleRate));
        const last = Math.min(count, Math.ceil((end - start) * sampleRate), Math.ceil(((wrapped.timestamp + wrapped.duration - clip.sourceStartTicks / timebase) / rate + clip.startTicks / timebase - start) * sampleRate));
        const channels = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))];
        for (let i = first; i < last; i++) {
          const seconds = start + i / sampleRate, sourceIndex = (studioClipSourceSeconds(clip, seconds, timebase) - wrapped.timestamp) * buffer.sampleRate;
          const index = Math.max(0, Math.min(buffer.length - 1, Math.floor(sourceIndex))), fraction = sourceIndex - Math.floor(sourceIndex), next = Math.min(buffer.length - 1, index + 1);
          const gain = clip.gain * studioClipEnvelope(clip, seconds * timebase - clip.startTicks);
          for (let c = 0; c < 2; c++) result[c][i] += (channels[c][index] * (1 - fraction) + channels[c][next] * fraction) * gain;
        }
      } } finally { await iterator.return(); }
    }
    for (const channel of result) for (let i = 0; i < channel.length; i++) channel[i] = clamp(channel[i], -1, 1);
    return result;
  }
  hasAudio() { return this.recipe.clips.some(c => (c.kind === 'audio' || c.kind === 'video' && this.recipe.assets.find(a => a.id === c.assetId)?.hasAudio !== false)); }
  dispose() { if (this.disposed) return; this.disposed = true; this.readers.forEach(reader => void reader.iterator.return()); this.readers.clear(); this.resources.forEach(p => p.then(r => { r.input?.dispose(); r.image?.close(); }).catch(() => {})); this.resources.clear(); this.resourceUses.clear(); this.drawResources.clear(); this.audioResources.clear(); this.textCache.clear(); this.grades.dispose(); if (this.ownsPortraits) this.portraits.dispose(); }
}

function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: string }) => { segment(value: string): Iterable<{ segment: string }> } }).Segmenter;
  return Segmenter ? [...new Segmenter('pt-BR', { granularity: 'grapheme' }).segment(text)].map(v => v.segment) : Array.from(text);
}
export function studioBrowserFont(font: string) {
  const aliases: Record<string, string> = { 'System': 'system-ui, sans-serif', 'HelveticaNeue': 'Arial, sans-serif', 'HelveticaNeue-Bold': 'Arial, sans-serif', 'TimesNewRomanPSMT': '"Times New Roman", serif', 'CourierNewPSMT': '"Courier New", monospace', 'Georgia': 'Georgia, serif' };
  return aliases[font] ?? `"${font.replace(/["\\]/g, '')}", sans-serif`;
}
export function wrapStudioText(ctx: Pick<CanvasRenderingContext2D, 'measureText'>, content: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of content.split('\n')) {
    let line = '';
    for (const cluster of graphemes(paragraph)) { const next = line + cluster; if (line && ctx.measureText(next).width > width) { lines.push(line); line = cluster; } else line = next; }
    lines.push(line);
  }
  return lines;
}

export async function createStudioRenderer(recipe: StudioRenderRecipe, resolveAsset: StudioAssetResolver, { canvas = null, maxDimension = 1080 }: { canvas?: HTMLCanvasElement | null; maxDimension?: number } = {}): Promise<StudioRenderer> {
  const staging = studioCanvas(1,1);
  const portraits = createStudioPortraitSurface();
  let kernel = new StudioRenderKernel(recipe, resolveAsset, undefined, portraits), bound = canvas, state: StudioRendererState = { position: 0, playing: false, loading: false, error: null };
  let epoch = 0, closed = false, raf = 0, context: AudioContext | null = null, anchorTime = 0, anchorPosition = 0, scheduled = 0, audioBusy = false, drawing = false;
  let drawWork: Promise<void> = Promise.resolve(), playWork: Promise<void> | null = null;
  let primedAudio: { start:number; samples:Float32Array[] } | null = null;
  const nodes = new Set<AudioBufferSourceNode>(), listeners = new Set<(state: StudioRendererState) => void>();
  const publish = (patch: Partial<StudioRendererState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener({ ...state })); };
  const duration = () => kernel.recipe.durationTicks / kernel.recipe.timebase;
  const position = () => state.playing ? clamp(anchorPosition + (context ? context.currentTime : performance.now()/1000) - anchorTime, 0, duration()) : state.position;
  const stopAudio = () => { nodes.forEach(node => { try { node.stop(); } catch {/* An ended source cannot be stopped again. */} node.disconnect(); }); nodes.clear(); };
  const draw = (target: HTMLCanvasElement, seconds: number) => {
    const generation = epoch, owned = kernel;
    const task = drawWork.catch(() => {}).then(async () => {
      if (closed || generation !== epoch) return;
      const scale = Math.min(1, maxDimension / Math.max(owned.recipe.output.width, owned.recipe.output.height));
      staging.width = Math.max(1, Math.round(owned.recipe.output.width * scale)); staging.height = Math.max(1, Math.round(owned.recipe.output.height * scale));
      try { await owned.draw(staging, clamp(seconds,0,owned.recipe.durationTicks/owned.recipe.timebase)); }
      catch (error) { if (closed || generation !== epoch) return; throw error; }
      if (closed || generation !== epoch) return;
      if (target.width !== staging.width || target.height !== staging.height) { target.width = staging.width; target.height = staging.height; }
      target.getContext('2d')!.drawImage(staging, 0, 0);
    });
    drawWork = task; return task;
  };
  const pause = () => { if (closed) return; const current = position(); epoch++; playWork = null; primedAudio = null; cancelAnimationFrame(raf); stopAudio(); publish({ position: current, playing: false, loading: false }); };
  const scheduleAudio = async () => {
    if (audioBusy || !context || !state.playing) return; audioBusy = true; const generation = epoch;
    try {
      while (scheduled < Math.min(duration(), position() + .6) && generation === epoch && !closed) {
        const start = scheduled, length = Math.min(.25, duration() - start);
        const samples = primedAudio?.start === start ? primedAudio.samples : await kernel.mixAudio(start, length); primedAudio = null;
        if (generation !== epoch || closed) break;
        const buffer = context.createBuffer(2, samples[0].length,48000); samples.forEach((channel,i) => buffer.copyToChannel(channel, i));
        const node = context.createBufferSource(); node.buffer = buffer; node.connect(context.destination); nodes.add(node); node.onended = () => { nodes.delete(node); node.disconnect(); };
        const when = anchorTime + start - anchorPosition, offset = Math.max(0, context.currentTime - when);
        if (offset < buffer.duration) node.start(Math.max(context.currentTime,when), offset); else { node.disconnect(); nodes.delete(node); }
        scheduled += length;
      }
    } catch (error) { if (generation === epoch && !closed) { pause(); publish({ error: error instanceof Error ? error.message : 'Não foi possível ouvir a montagem.' }); } }
    finally { audioBusy = false; }
  };
  const tick = () => {
    if (closed || !state.playing) return; const seconds = position(); publish({ position: seconds }); void scheduleAudio();
    if (bound && !drawing) { const generation = epoch; drawing = true; void draw(bound, seconds).catch(error => { if (generation === epoch && !closed) { pause(); publish({ error: String(error.message ?? error) }); } }).finally(() => { drawing = false; }); }
    if (seconds >= duration()) { pause(); publish({ position: duration() }); return; } raf = requestAnimationFrame(tick);
  };
  const seek = async (seconds: number) => { pause(); const generation = epoch; publish({ position: clamp(seconds,0,duration()), loading: true, error: null }); try { if (bound) await draw(bound,state.position); if (generation === epoch && !closed) publish({ loading:false }); } catch (error) { if (generation === epoch && !closed) publish({ loading:false,error: String(error.message ?? error) }); throw error; } };
  const visibility = () => { if (document.visibilityState !== 'visible') pause(); }; document.addEventListener('visibilitychange',visibility);
  const engine: StudioRenderer = {
    preparePortrait(signal) { return portraits.prepare(signal); },
    bindCanvas(target) { bound = target; if (target) void seek(state.position).catch(() => {}); }, draw,
    seek, pause,
    play() {
      if (closed || state.playing) return Promise.resolve(); if (playWork) return playWork;
      const generation = ++epoch; context ??= new AudioContext({ sampleRate:48000 });
      const resumed = context.resume();
      const task = (async () => {
        if (state.position >= duration() - .0001) { publish({position:0}); if (bound) await draw(bound,0); }
        await resumed; if (closed || generation !== epoch) return;
        publish({loading:true,error:null});
        const start = state.position, samples = await kernel.mixAudio(start,Math.min(.25,duration()-start));
        if (closed || generation !== epoch) return; primedAudio = {start,samples};
        anchorPosition = state.position; anchorTime = context!.currentTime + .08; scheduled = state.position;
        publish({playing:true,loading:false,error:null}); void scheduleAudio(); raf = requestAnimationFrame(tick);
      })().catch(error => { if (closed || generation !== epoch) return; publish({playing:false,loading:false,error:String(error.message ?? error)}); throw error; }).finally(() => { if (playWork === task) playWork = null; });
      playWork = task; return task;
    },
    async setRecipe(next) { const wasPlaying = state.playing, current = position(); pause(); const replacement = new StudioRenderKernel(next,resolveAsset,undefined,portraits); kernel.dispose(); kernel = replacement; const seeking = seek(Math.min(current,duration())), generation = epoch; await seeking; if (wasPlaying && !closed && generation === epoch) await engine.play(); },
    dispose() { if (closed) return; pause(); closed=true; epoch++; kernel.dispose(); portraits.dispose(); listeners.clear(); document.removeEventListener('visibilitychange',visibility); void context?.close(); staging.width=1; staging.height=1; },
    subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
  };
  try {
    // Font resolution is frozen before first frame. Preview and export use the same browser fallback.
    await Promise.all(kernel.recipe.clips.filter(c => c.text).map(c => document.fonts?.load(`16px ${studioBrowserFont(c.text!.fontFamily)}`).catch(() => [])));
    if (bound) await seek(0); return engine;
  } catch (error) { engine.dispose(); throw error; }
}
