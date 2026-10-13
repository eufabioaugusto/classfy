import { assertStudioActive, studioCanvas } from './media';
import { createStudioPortraitDetector, type StudioPortraitDetector } from './portraitClient';
import { drawStudioPortraitMask, studioPortraitAnalysisSize, studioPortraitFaceWidth } from './portraitMask';
import { STUDIO_PORTRAIT_V2, studioPortraitV2Pixel, studioPortraitV2Radius } from '../../../../shared/studio/portraitLook';

export type StudioPortraitSurface = {
  prepare(signal?: AbortSignal): Promise<void>;
  render(source: CanvasImageSource, width: number, height: number, strength: number, signal?: AbortSignal, version?: 1 | 2): Promise<CanvasImageSource>;
  readonly lastFacePresent: boolean | null;
  dispose(): void;
};
const fragment = `precision highp float;
varying vec2 uv; uniform sampler2D image,skin; uniform vec2 step; uniform float strength,version;
float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void accumulate(vec2 offset, float spatial, float center, inout float sum, inout float weight){
  float value=luminance(texture2D(image,clamp(uv+offset,vec2(0.),vec2(1.))).rgb);
  float delta=value-center; float sigma=version>1.5?${STUDIO_PORTRAIT_V2.sigma}:.035; float range=exp(-delta*delta/(2.*sigma*sigma));
  sum+=value*spatial*range; weight+=spatial*range;
}
float band(vec2 radius,float center){
  float sum=center,weight=1.;
  accumulate(vec2(radius.x,0.),.75,center,sum,weight);accumulate(vec2(-radius.x,0.),.75,center,sum,weight);
  accumulate(vec2(0.,radius.y),.75,center,sum,weight);accumulate(vec2(0.,-radius.y),.75,center,sum,weight);
  accumulate(radius,.5,center,sum,weight);accumulate(-radius,.5,center,sum,weight);
  accumulate(vec2(radius.x,-radius.y),.5,center,sum,weight);accumulate(vec2(-radius.x,radius.y),.5,center,sum,weight);
  return sum/weight;
}
void main(){
  vec4 original=texture2D(image,uv); float center=luminance(original.rgb);
  // V1 retains its original feather. V2 feathers the silhouette before hard feature cutouts.
  float mask=texture2D(skin,uv).r;
  if(version<1.5){vec2 m=vec2(1./640.,1./640.);mask*=.4;
    mask+=(texture2D(skin,uv+vec2(m.x,0.)).r+texture2D(skin,uv-vec2(m.x,0.)).r+texture2D(skin,uv+vec2(0.,m.y)).r+texture2D(skin,uv-vec2(0.,m.y)).r)*.15;}
  if(mask<.001||strength<=0.){gl_FragColor=original;return;}
  float delta;
  if(version>1.5){
    float target=band(step*${STUDIO_PORTRAIT_V2.radiusScales[0].toFixed(1)},center)*${STUDIO_PORTRAIT_V2.bandWeights[0]}
      +band(step*${STUDIO_PORTRAIT_V2.radiusScales[1].toFixed(1)},center)*${STUDIO_PORTRAIT_V2.bandWeights[1]}
      +band(step*${STUDIO_PORTRAIT_V2.radiusScales[2].toFixed(1)},center)*${STUDIO_PORTRAIT_V2.bandWeights[2]};
    delta=clamp(target-center,-${STUDIO_PORTRAIT_V2.maximumDelta},${STUDIO_PORTRAIT_V2.maximumDelta})*${STUDIO_PORTRAIT_V2.mix.toFixed(1)}*pow(strength,1.5)*mask;
  }else delta=clamp(band(step,center)-center,-.03,.03)*strength*mask*.45;
  float safe=min(original.r,min(original.g,original.b)); float room=1.-max(original.r,max(original.g,original.b));
  delta=clamp(delta,-safe,room); gl_FragColor=vec4(original.rgb+vec3(delta),original.a);
}`;
/** Natural luminance-only reference used by QA to guard skin colour and the strength envelope. */
export function studioPortraitPixel(rgb: readonly number[], nearbyLuminance: number, mask: number, strength: number, version: 1 | 2 = 1) {
  if (version === 2) return studioPortraitV2Pixel(rgb, nearbyLuminance, mask, strength);
  const center = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  const delta = Math.max(-Math.min(...rgb), Math.min(1 - Math.max(...rgb), Math.max(-.03, Math.min(.03, nearbyLuminance - center)) * strength * mask * .45));
  return rgb.map(value => value + delta);
}
export function createStudioPortraitSurface(): StudioPortraitSurface {
  let detector: StudioPortraitDetector | null = null, gl: WebGLRenderingContext | null = null, program: WebGLProgram | null = null;
  let sourceTexture: WebGLTexture | null = null, maskTexture: WebGLTexture | null = null, vertices: WebGLBuffer | null = null;
  let closed = false, facePresent: boolean | null = null, queue = Promise.resolve();
  const canvas = studioCanvas(1, 1), mask = studioCanvas(1, 1), analysis = studioCanvas(1, 1);
  const active = (signal?: AbortSignal) => { assertStudioActive(signal); if (closed) throw new DOMException('O retrato foi encerrado.', 'AbortError'); };
  function initializeGL() {
    if (gl) return;
    const context = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!context) throw new Error('Este navegador não oferece GPU para aplicar o retrato. Desative o retoque ou use outro navegador.');
    gl = context; const compile = (type: number, source: string) => {
      const shader = context.createShader(type); if (!shader) throw new Error('Não foi possível preparar o retrato na GPU.');
      context.shaderSource(shader, source); context.compileShader(shader);
      if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) { context.deleteShader(shader); throw new Error('A GPU não compilou o tratamento do retrato.'); }
      return shader;
    };
    try {
      const p = context.createProgram(); if (!p) throw new Error('Não foi possível preparar o retrato na GPU.'); program = p;
      const vertex = compile(context.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}'), pixel = compile(context.FRAGMENT_SHADER, fragment);
      context.attachShader(p, vertex); context.attachShader(p, pixel); context.linkProgram(p); context.deleteShader(vertex); context.deleteShader(pixel);
      if (!context.getProgramParameter(p, context.LINK_STATUS)) throw new Error('A GPU não confirmou o tratamento do retrato.');
      vertices = context.createBuffer(); context.bindBuffer(context.ARRAY_BUFFER, vertices); context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), context.STATIC_DRAW);
      const position = context.getAttribLocation(p, 'p'); context.useProgram(p); context.enableVertexAttribArray(position); context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
      const texture = (unit: number) => { const value = context.createTexture(); context.activeTexture(context.TEXTURE0 + unit); context.bindTexture(context.TEXTURE_2D, value); for (const parameter of [context.TEXTURE_MIN_FILTER, context.TEXTURE_MAG_FILTER]) context.texParameteri(context.TEXTURE_2D, parameter, context.LINEAR); for (const parameter of [context.TEXTURE_WRAP_S, context.TEXTURE_WRAP_T]) context.texParameteri(context.TEXTURE_2D, parameter, context.CLAMP_TO_EDGE); return value; };
      sourceTexture = texture(0); maskTexture = texture(1); context.uniform1i(context.getUniformLocation(p, 'image'), 0); context.uniform1i(context.getUniformLocation(p, 'skin'), 1);
    } catch (error) { context.getExtension('WEBGL_lose_context')?.loseContext(); gl = null; program = null; throw error; }
  }
  async function prepare(signal?: AbortSignal) { active(signal); initializeGL(); detector ??= createStudioPortraitDetector(); await detector.prepare(signal); active(signal); }
  async function draw(source: CanvasImageSource, width: number, height: number, strength: number, signal?: AbortSignal, version: 1 | 2 = 1) {
    active(signal); if (![1, 2].includes(version) || !Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('A intensidade do retrato deve estar entre 0 e 1.');
    if (strength === 0) { facePresent = null; return source; }
    const size = studioPortraitAnalysisSize(width, height); initializeGL(); detector ??= createStudioPortraitDetector();
    if (width > gl!.getParameter(gl!.MAX_TEXTURE_SIZE) || height > gl!.getParameter(gl!.MAX_TEXTURE_SIZE)) throw new Error('A GPU não suporta o retrato nesta resolução. Seus originais continuam preservados.');
    analysis.width = size.width; analysis.height = size.height; const analysisContext = analysis.getContext('2d'); if (!analysisContext) throw new Error('Não foi possível analisar o rosto localmente.');
    analysisContext.drawImage(source, 0, 0, size.width, size.height); const bitmap = await createImageBitmap(analysis);
    try { active(signal); } catch (error) { bitmap.close(); throw error; }
    const face = await detector.detect(bitmap, signal); active(signal);
    facePresent = drawStudioPortraitMask(mask, face, size.width, size.height, version);
    const context = gl!; if (context.isContextLost()) throw new Error('A GPU interrompeu o retrato. Reabra o editor para continuar.');
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.viewport(0, 0, width, height); context.useProgram(program);
    context.activeTexture(context.TEXTURE0); context.bindTexture(context.TEXTURE_2D, sourceTexture); context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, source as TexImageSource);
    context.activeTexture(context.TEXTURE1); context.bindTexture(context.TEXTURE_2D, maskTexture); context.texImage2D(context.TEXTURE_2D, 0, context.RGBA, context.RGBA, context.UNSIGNED_BYTE, mask);
    const faceWidth = studioPortraitFaceWidth(face) * width;
    const radius = version === 2 ? studioPortraitV2Radius(faceWidth) : Math.max(1, faceWidth * .004);
    context.uniform1f(context.getUniformLocation(program!, 'version'), version);
    context.uniform2f(context.getUniformLocation(program!, 'step'), radius / width, radius / height); context.uniform1f(context.getUniformLocation(program!, 'strength'), facePresent ? strength : 0);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4); if (context.getError() !== context.NO_ERROR) throw new Error('A GPU não concluiu o quadro com retrato. A exportação foi interrompida.');
    active(signal); return canvas;
  }
  return {
    prepare,
    render(source, width, height, strength, signal, version = 1) {
      // No stale mask/cache is reused across timestamps. Serializing bounds model/GPU work.
      if (strength === 0) return draw(source, width, height, strength, signal, version);
      try { active(signal); } catch (error) { return Promise.reject(error); }
      // Snapshot before the queue/worker awaits: upstream grade surfaces can be reused by a seek.
      const captured = createImageBitmap(source);
      void captured.catch(() => undefined);
      const work = queue.then(async () => { const frame = await captured; try { return await draw(frame, width, height, strength, signal, version); } finally { frame.close(); } });
      queue = work.then(() => undefined, () => undefined); return work;
    },
    get lastFacePresent() { return facePresent; },
    dispose() { if (closed) return; closed = true; detector?.dispose(); detector = null; if (gl) { gl.deleteTexture(sourceTexture); gl.deleteTexture(maskTexture); gl.deleteBuffer(vertices); gl.deleteProgram(program); gl.getExtension('WEBGL_lose_context')?.loseContext(); } gl = null; program = null; for (const value of [canvas, mask, analysis]) { value.width = 1; value.height = 1; } },
  };
}
/** Independent preflight; prefer a retained surface.prepare() when reusing an editor renderer. */
export async function prepareStudioPortrait(signal?: AbortSignal) { const surface = createStudioPortraitSurface(); try { await surface.prepare(signal); } finally { surface.dispose(); } }
