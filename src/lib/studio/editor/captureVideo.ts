import { studioGrade, validateStudioGrade, type StudioGrade } from '../../../../shared/studio/model';

export type StudioCaptureVideoControls = {
  busy: boolean; processed: boolean; effects: boolean; grade: StudioGrade;
  zoom: { mode: 'hardware' | 'digital' | 'none'; min: number; max: number; step: number; value: number };
  resolutions: { width: number; height: number; label: string }[]; frameRates: number[];
};
export type StudioCaptureVideoPatch = { zoom?: number; grade?: Partial<StudioGrade>; width?: number; height?: number; frameRate?: number };
type ZoomCapabilities = MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number } };
export function studioCaptureGrade(previous: StudioGrade, patch?: Partial<StudioGrade>): StudioGrade {
  const next = { ...previous, ...patch }; if (validateStudioGrade(next).length) throw new Error('Os ajustes de imagem estão fora dos limites.'); return next;
}
export function studioCaptureIdentityGrade(grade: StudioGrade) { return grade.intensity === 0 || grade.preset === 'natural' && grade.exposure === 0 && grade.contrast === 0 && grade.saturation === 0 && grade.temperature === 0; }
export function studioCaptureVideoControls(track: MediaStreamTrack, processor: StudioCaptureVideoProcessor | null, grade = studioGrade(), digitalZoom = 1): StudioCaptureVideoControls {
  const settings = track.getSettings() as MediaTrackSettings & { zoom?: number }; let caps: ZoomCapabilities = {};
  try { caps = track.getCapabilities?.() ?? {}; } catch { /* Only expose the confirmed current profile when capabilities are unavailable. */ }
  const inRange = (value: number, range?: { min?: number; max?: number }) => !!range && Number.isFinite(range.min) && Number.isFinite(range.max) && value >= range.min! && value <= range.max!;
  const resolutions = [{ width: 1280, height: 720, label: '720p' }, { width: 1920, height: 1080, label: '1080p' }, { width: 2560, height: 1440, label: '2K' }, { width: 3840, height: 2160, label: '4K' }].filter(value => inRange(value.width, caps.width) && inRange(value.height, caps.height));
  if (settings.width && settings.height && !resolutions.some(value => value.width === settings.width && value.height === settings.height)) resolutions.unshift({ width: settings.width, height: settings.height, label: `${settings.width} × ${settings.height}` });
  const frameRates = [24, 30, 60].filter(value => inRange(value, caps.frameRate));
  if (settings.frameRate && !frameRates.some(value => Math.abs(value - settings.frameRate!) < .01)) frameRates.unshift(settings.frameRate);
  const hardware = caps.zoom && Number.isFinite(settings.zoom) && Number.isFinite(caps.zoom.min) && Number.isFinite(caps.zoom.max) && caps.zoom.min > 0 && caps.zoom.max > caps.zoom.min;
  return { busy: false, processed: !!processor, effects: !!processor?.effects, grade: { ...grade }, resolutions, frameRates,
    zoom: hardware ? { mode: 'hardware', min: caps.zoom!.min, max: caps.zoom!.max, step: caps.zoom!.step || .01, value: settings.zoom! }
      : processor ? { mode: 'digital', min: 1, max: 4, step: .01, value: digitalZoom } : { mode: 'none', min: 1, max: 1, step: 1, value: 1 } };
}

export function studioCaptureCrop(width: number, height: number, zoom: number) {
  const ratio = Math.max(1, zoom); return { x: width * (1 - 1 / ratio) / 2, y: height * (1 - 1 / ratio) / 2, width: width / ratio, height: height / ratio };
}
export type StudioCaptureVideoProcessor = {
  readonly stream: MediaStream; readonly effects: boolean;
  prepare(): Promise<void>; configure(grade: StudioGrade, zoom: number): void;
  setVisible(visible: boolean): void; dispose(): void;
};
/** A private video feeds one bounded GPU surface; the exact output track is used by both preview and MediaRecorder. */
export function createStudioCaptureVideoProcessor(track: MediaStreamTrack, grade: StudioGrade, zoom: number, onError: (error: Error) => void): StudioCaptureVideoProcessor | null {
  if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const settings = track.getSettings(), canvas = document.createElement('canvas');
  canvas.width = settings.width || 1920; canvas.height = settings.height || 1080;
  const video = document.createElement('video'); video.muted = true; video.playsInline = true; video.autoplay = true;
  video.setAttribute('aria-hidden', 'true'); video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
  video.srcObject = new MediaStream([track]); document.body.appendChild(video);
  let gl: WebGLRenderingContext | null = null, program: WebGLProgram | null = null, texture: WebGLTexture | null = null, vertices: WebGLBuffer | null = null;
  const shaders: WebGLShader[] = [];
  try {
    gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
    if (gl) {
      const compile = (type: number, source: string) => { const shader = gl!.createShader(type); if (!shader) throw new Error('GPU indisponível.'); shaders.push(shader); gl!.shaderSource(shader, source); gl!.compileShader(shader); if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) throw new Error('O navegador não compilou o tratamento de imagem.'); return shader; };
      program = gl.createProgram(); if (!program) throw new Error('GPU indisponível.');
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision highp float; varying vec2 uv; uniform sampler2D image; uniform float zoom,intensity,exposure,contrast,saturation,temperature,preset;
        float tone(float v){float t=clamp(v,0.,1.)*4.;float i=floor(min(3.,t));vec4 a=vec4(0.,.25,.5,.75);vec4 b=vec4(.25,.5,.75,1.);
        if(preset>1.5){a=vec4(.012,.235,.495,.745);b=vec4(.235,.495,.745,.985);}else if(preset>.5){a=vec4(0.,.235,.505,.765);b=vec4(.235,.505,.765,1.);}
        float lo=i<.5?a.x:i<1.5?a.y:i<2.5?a.z:a.w;float hi=i<.5?b.x:i<1.5?b.y:i<2.5?b.z:b.w;return mix(lo,hi,t-i);}
        void main(){vec4 c=texture2D(image,(uv-.5)/zoom+.5);vec3 e=c.rgb*pow(2.,exposure)*vec3(1.+temperature*.08,1.,1.-temperature*.08);e=vec3(tone(e.r),tone(e.g),tone(e.b));float l=dot(e,vec3(.2126,.7152,.0722));e=vec3(l)+(e-vec3(l))*((preset>1.5?.96:1.)+saturation*.4);e=(e-.5)*(1.+contrast*.25)+.5;gl_FragColor=vec4(clamp(mix(c.rgb,e,intensity),0.,1.),1.);}`));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('GPU indisponível.'); gl.useProgram(program);
      vertices = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const p = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
      texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  } catch {
    if (gl) { shaders.forEach(shader => gl!.deleteShader(shader)); if (program) gl.deleteProgram(program); if (texture) gl.deleteTexture(texture); if (vertices) gl.deleteBuffer(vertices); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    gl = null; program = null;
  }
  // A failed WebGL canvas cannot become 2D. Replace it for a truthful zoom-only fallback.
  const surface = gl ? canvas : document.createElement('canvas'); surface.width = canvas.width; surface.height = canvas.height;
  const context = gl ? null : surface.getContext('2d');
  if (!gl && !context) { video.srcObject = null; video.remove(); return null; }
  let stream: MediaStream;
  try { stream = surface.captureStream(Math.max(1, Math.min(60, settings.frameRate || 30))); }
  catch (error) { video.srcObject = null; video.remove(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); throw error; }
  let disposed = false, visible = document.visibilityState !== 'hidden', raf: number | null = null, videoFrame: number | null = null, lastFrame = -Infinity, failure = false;
  let currentGrade = { ...grade }, currentZoom = zoom, firstResolve: (() => void) | null = null, firstReject: ((error: Error) => void) | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const waitForVisibleFrame = () => {
    if (timeout) clearTimeout(timeout); timeout = null;
    if (disposed || !visible || !firstReject) return;
    timeout = setTimeout(() => { timeout = null; firstReject?.(new Error('A câmera não entregou imagem. Ative a entrada novamente.')); firstResolve = null; firstReject = null; }, 8000);
  };
  const effects = !!gl && !!program;
  const assertGrade = (value: StudioGrade) => { if (validateStudioGrade(value).length) throw new Error('Revise os ajustes de imagem.'); if (!effects && !studioCaptureIdentityGrade(value)) throw new Error('Este navegador não oferece processamento de cor na câmera.'); };
  const draw = () => {
    if (disposed || video.readyState < 2) return false;
    if (gl && program) {
      gl.viewport(0, 0, surface.width, surface.height); gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      for (const [name, value] of Object.entries({ zoom: currentZoom, intensity: currentGrade.intensity, exposure: currentGrade.exposure, contrast: currentGrade.contrast, saturation: currentGrade.saturation, temperature: currentGrade.temperature, preset: currentGrade.preset === 'cinematic' ? 2 : currentGrade.preset === 'studio' ? 1 : 0 })) gl.uniform1f(gl.getUniformLocation(program, name), value);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); if (gl.isContextLost()) throw new Error('O processamento da câmera foi interrompido. O trecho capturado será preservado.');
    } else {
      const crop = studioCaptureCrop(video.videoWidth || surface.width, video.videoHeight || surface.height, currentZoom); context!.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, surface.width, surface.height);
    }
    (stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined)?.requestFrame?.();
    firstResolve?.(); firstResolve = null; firstReject = null; if (timeout) clearTimeout(timeout); timeout = null; return true;
  };
  const schedule = () => {
    if (disposed || failure || !visible) return;
    const tick = (now: number) => {
      raf = null; videoFrame = null; if (disposed || !visible) return;
      try { if (now - lastFrame >= 1000 / Math.min(60, settings.frameRate || 30) - 1 && draw()) lastFrame = now; }
      catch (error) { failure = true; const value = error instanceof Error ? error : new Error('O processamento da câmera falhou.'); firstReject?.(value); firstResolve = null; firstReject = null; onError(value); return; }
      schedule();
    };
    if (video.requestVideoFrameCallback) videoFrame = video.requestVideoFrameCallback(tick); else raf = requestAnimationFrame(tick);
  };
  const unschedule = () => { if (raf !== null) cancelAnimationFrame(raf); if (videoFrame !== null) video.cancelVideoFrameCallback?.(videoFrame); raf = null; videoFrame = null; };
  return {
    stream, effects,
    async prepare() {
      assertGrade(currentGrade); if (disposed) throw new DOMException('Captura cancelada.', 'AbortError');
      await video.play(); if (disposed) throw new DOMException('Captura cancelada.', 'AbortError');
      const first = new Promise<void>((resolve, reject) => { firstResolve = resolve; firstReject = reject; waitForVisibleFrame(); });
      try { draw(); schedule(); } catch (error) { firstReject?.(error instanceof Error ? error : new Error('O processamento da câmera falhou.')); firstResolve = null; firstReject = null; }
      await first;
    },
    configure(next, value) { if (disposed || failure) throw new Error('O processamento da câmera não está disponível.'); assertGrade(next); const oldGrade = currentGrade, oldZoom = currentZoom; currentGrade = { ...next }; currentZoom = value; try { if (!draw()) throw new Error('Aguarde a imagem da câmera antes de aplicar o ajuste.'); } catch (error) { currentGrade = oldGrade; currentZoom = oldZoom; throw error; } },
    setVisible(value) { if (disposed || visible === value) return; visible = value; unschedule(); waitForVisibleFrame(); if (visible) { void video.play().then(() => { if (!disposed && visible) schedule(); }).catch(error => { if (!disposed) onError(error); }); } },
    dispose() { if (disposed) return; disposed = true; unschedule(); if (timeout) clearTimeout(timeout); firstReject?.(new DOMException('Captura cancelada.', 'AbortError')); firstResolve = null; firstReject = null; video.pause(); video.srcObject = null; video.remove(); shaders.forEach(shader => gl?.deleteShader(shader)); if (program) gl?.deleteProgram(program); if (texture) gl?.deleteTexture(texture); if (vertices) gl?.deleteBuffer(vertices); gl?.getExtension('WEBGL_lose_context')?.loseContext(); surface.width = 1; surface.height = 1; },
  };
}
