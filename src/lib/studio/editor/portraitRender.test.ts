import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioPortraitSurface } from './portraitRender';
const detector=vi.hoisted(()=>({prepare:vi.fn(async()=>undefined),detect:vi.fn(async()=>[]),dispose:vi.fn()}));
vi.mock('./portraitClient',()=>({createStudioPortraitDetector:()=>detector}));
const bitmap=()=>({close:vi.fn()} as unknown as ImageBitmap);
function gpu(){
  return {VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,MAX_TEXTURE_SIZE:5,ARRAY_BUFFER:6,STATIC_DRAW:7,FLOAT:8,TEXTURE0:9,TEXTURE_2D:10,TEXTURE_MIN_FILTER:11,TEXTURE_MAG_FILTER:12,TEXTURE_WRAP_S:13,TEXTURE_WRAP_T:14,LINEAR:15,CLAMP_TO_EDGE:16,RGBA:17,UNSIGNED_BYTE:18,TRIANGLE_STRIP:19,NO_ERROR:0,createShader:()=>({}),shaderSource(){},compileShader(){},getShaderParameter:()=>true,deleteShader(){},createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,createBuffer:()=>({}),bindBuffer(){},bufferData(){},getAttribLocation:()=>0,useProgram(){},enableVertexAttribArray(){},vertexAttribPointer(){},createTexture:()=>({}),activeTexture(){},bindTexture(){},texParameteri(){},uniform1i(){},getUniformLocation:()=>({}),getParameter:()=>8192,isContextLost:()=>false,viewport(){},texImage2D(){},uniform2f(){},uniform1f(){},drawArrays(){},getError:()=>0,deleteTexture(){},deleteBuffer(){},deleteProgram(){},getExtension:()=>({loseContext:vi.fn()})};
}
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation((kind:string)=>kind==='webgl'?gpu() as any:{drawImage(){},fillRect(){},beginPath(){},closePath(){},moveTo(){},lineTo(){},fill(){}} as any);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('superfície de retrato e propriedade de frames',()=>{
  it('intensidade0 mantém fonte e não cria bitmap/modelo/GPU',async()=>{
    const surface=createStudioPortraitSurface(), source=document.createElement('canvas'), create=vi.fn();vi.stubGlobal('createImageBitmap',create);
    expect(await surface.render(source,1280,720,0)).toBe(source);expect(create).not.toHaveBeenCalled();expect(detector.prepare).not.toHaveBeenCalled();expect(detector.detect).not.toHaveBeenCalled();surface.dispose();
  });
  it('abort após análise bitmap resolver fecha o bitmap não transferido e o quadro original',async()=>{
    const surface=createStudioPortraitSurface(), source=document.createElement('canvas'), frame=bitmap(), analysis=bitmap(), controller=new AbortController();
    let resolve!:(value:ImageBitmap)=>void;const delayed=new Promise<ImageBitmap>(value=>{resolve=value;});const create=vi.fn().mockResolvedValueOnce(frame).mockReturnValueOnce(delayed);vi.stubGlobal('createImageBitmap',create);
    const work=surface.render(source,1280,720,.4,controller.signal), rejected=expect(work).rejects.toMatchObject({name:'AbortError'});
    await vi.waitFor(()=>expect(create).toHaveBeenCalledTimes(2));controller.abort();resolve(analysis);await rejected;
    expect(analysis.close).toHaveBeenCalledOnce();expect(frame.close).toHaveBeenCalledOnce();expect(detector.detect).not.toHaveBeenCalled();surface.dispose();
  });
  it('falha deGPU interrompe tratamento e fecha o original; não omite efeito na exportação',async()=>{
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);const surface=createStudioPortraitSurface(), frame=bitmap();vi.stubGlobal('createImageBitmap',vi.fn(async()=>frame));
    await expect(surface.render(document.createElement('canvas'),1280,720,.4)).rejects.toThrow('GPU');expect(frame.close).toHaveBeenCalledOnce();expect(detector.detect).not.toHaveBeenCalled();surface.dispose();
  });
  it('dispose durantewarm propaga abort e termina detector mesmo com resposta tardia',async()=>{
    let resolve!:()=>void;detector.prepare.mockImplementationOnce(()=>new Promise<void>(value=>{resolve=value;}));const surface=createStudioPortraitSurface(), preparing=surface.prepare();surface.dispose();resolve();await expect(preparing).rejects.toMatchObject({name:'AbortError'});expect(detector.dispose).toHaveBeenCalledOnce();
  });
});
