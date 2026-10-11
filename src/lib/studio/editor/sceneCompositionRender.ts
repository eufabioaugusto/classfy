import type { StudioGrade } from '../../../../shared/studio/model';
import type { StudioCaptureScene, StudioSceneConfiguration } from './sceneTypes';

export function studioSceneSourceRect(width: number, height: number, targetWidth: number, targetHeight: number, fit: 'cover' | 'contain', zoom = 1) {
  const factor = Math.max(1, zoom), sw = width / factor, sh = height / factor;
  const scale = fit === 'cover' ? Math.max(targetWidth / sw, targetHeight / sh) : Math.min(targetWidth / sw, targetHeight / sh);
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh, dx: (targetWidth - sw * scale) / 2, dy: (targetHeight - sh * scale) / 2, dw: sw * scale, dh: sh * scale };
}
/** Pure canvas geometry is shared by worker composition and its acceptance tests. */
export function drawStudioScene(context: OffscreenCanvasRenderingContext2D, width: number, height: number, scene: StudioCaptureScene, config: StudioSceneConfiguration, camera: CanvasImageSource | null, screen: CanvasImageSource | null) {
  context.save(); context.clearRect(0, 0, width, height); context.fillStyle = '#000'; context.fillRect(0, 0, width, height);
  const dimensions = (source: CanvasImageSource) => {
    const value = source as { width?: number; height?: number; displayWidth?: number; displayHeight?: number };
    return { width: value.displayWidth || value.width || width, height: value.displayHeight || value.height || height };
  };
  const draw = (source: CanvasImageSource, tw: number, th: number, fit: 'cover' | 'contain') => {
    const size = dimensions(source), r = studioSceneSourceRect(size.width, size.height, tw, th, fit);
    context.drawImage(source, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  };
  if (scene === 'camera' && camera) draw(camera, width, height, 'cover');
  if (scene !== 'camera' && screen) draw(screen, width, height, 'contain');
  if (scene === 'screen-camera' && camera) {
    const diameter = Math.min(width, height) * config.size, radius = diameter / 2, cx = config.position.x * width, cy = config.position.y * height;
    context.save(); context.beginPath(); context.arc(cx, cy, radius, 0, Math.PI * 2); context.clip(); context.translate(cx - radius, cy - radius); draw(camera, diameter, diameter, 'cover'); context.restore();
    context.beginPath(); context.arc(cx, cy, radius - 1, 0, Math.PI * 2); context.strokeStyle = 'rgba(255,255,255,.85)'; context.lineWidth = Math.max(2, Math.min(width, height) / 360); context.stroke();
  }
  context.restore();
}

/** Same tonal math as captureVideo; it changes the camera pixels before scene composition, never the screen. */
export function createStudioSceneCameraSurface() {
  const canvas = new OffscreenCanvas(2, 2), gl = canvas.getContext('webgl', { alpha: false, preserveDrawingBuffer: true });
  const surface = gl ? null : new OffscreenCanvas(2, 2), ctx = surface?.getContext('2d');
  if (!gl) return { effects: false, draw(source: VideoFrame, _grade: StudioGrade, zoom: number): CanvasImageSource {
    if (!surface || !ctx) throw new Error('A câmera não pode ser composta neste navegador.');
    if (surface.width !== source.displayWidth || surface.height !== source.displayHeight) { surface.width = source.displayWidth; surface.height = source.displayHeight; }
    const r = studioSceneSourceRect(source.displayWidth, source.displayHeight, surface.width, surface.height, 'cover', zoom);
    ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, 0, 0, surface.width, surface.height); return surface;
  }, dispose() {} };
  const shaders: WebGLShader[] = [];
  const compile = (type: number, code: string) => { const shader = gl.createShader(type)!; shaders.push(shader); gl.shaderSource(shader, code); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('O tratamento da câmera não pôde ser preparado.'); return shader; };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision highp float;varying vec2 uv;uniform sampler2D image;uniform float zoom,intensity,exposure,contrast,saturation,temperature,preset;
    float tone(float v){float t=clamp(v,0.,1.)*4.;float i=floor(min(3.,t));vec4 a=vec4(0.,.25,.5,.75);vec4 b=vec4(.25,.5,.75,1.);if(preset>1.5){a=vec4(.012,.235,.495,.745);b=vec4(.235,.495,.745,.985);}else if(preset>.5){a=vec4(0.,.235,.505,.765);b=vec4(.235,.505,.765,1.);}float lo=i<.5?a.x:i<1.5?a.y:i<2.5?a.z:a.w;float hi=i<.5?b.x:i<1.5?b.y:i<2.5?b.z:b.w;return mix(lo,hi,t-i);}
    void main(){vec4 c=texture2D(image,(uv-.5)/zoom+.5);vec3 e=c.rgb*pow(2.,exposure)*vec3(1.+temperature*.08,1.,1.-temperature*.08);e=vec3(tone(e.r),tone(e.g),tone(e.b));float l=dot(e,vec3(.2126,.7152,.0722));e=vec3(l)+(e-vec3(l))*((preset>1.5?.96:1.)+saturation*.4);e=(e-.5)*(1.+contrast*.25)+.5;gl_FragColor=vec4(clamp(mix(c.rgb,e,intensity),0.,1.),1.);}`));
  gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('O tratamento da câmera não pôde ser preparado.'); gl.useProgram(program);
  const vertices = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const p = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { effects: true, draw(source: VideoFrame, grade: StudioGrade, zoom: number): CanvasImageSource {
    if (canvas.width !== source.displayWidth || canvas.height !== source.displayHeight) { canvas.width = source.displayWidth; canvas.height = source.displayHeight; }
    gl.viewport(0, 0, canvas.width, canvas.height); gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    for (const [key, value] of Object.entries({ zoom, intensity: grade.intensity, exposure: grade.exposure, contrast: grade.contrast, saturation: grade.saturation, temperature: grade.temperature, preset: grade.preset === 'cinematic' ? 2 : grade.preset === 'studio' ? 1 : 0 })) gl.uniform1f(gl.getUniformLocation(program, key), value);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); if (gl.isContextLost()) throw new Error('O processamento das cenas foi interrompido. O trecho capturado será preservado.'); return canvas;
  }, dispose() { shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteProgram(program); gl.deleteTexture(texture); gl.deleteBuffer(vertices); gl.getExtension('WEBGL_lose_context')?.loseContext(); } };
}
