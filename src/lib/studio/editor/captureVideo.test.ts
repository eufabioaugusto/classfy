import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { studioGrade } from '../../../../shared/studio/model';
import { createStudioCaptureVideoProcessor, studioCaptureCrop, studioCaptureGrade, studioCaptureVideoControls } from './captureVideo';

function source(settings:MediaTrackSettings & {zoom?:number}={width:1920,height:1080,frameRate:30},capabilities:MediaTrackCapabilities & {zoom?:{min:number;max:number;step?:number}}={}) {
  return { getSettings:()=>settings,getCapabilities:()=>capabilities } as unknown as MediaStreamTrack;
}
class Stream {
  constructor(public tracks:MediaStreamTrack[]){} getVideoTracks(){return this.tracks;}getTracks(){return this.tracks;}
}
function surface(gpu=true) {
  const video=document.createElement('video');Object.defineProperties(video,{readyState:{value:2,configurable:true},videoWidth:{value:1920},videoHeight:{value:1080}});
  video.play=vi.fn(async()=>{});video.pause=vi.fn();
  const canvas=document.createElement('canvas'),fallback=document.createElement('canvas'),output={stop:vi.fn(),requestFrame:vi.fn()} as unknown as MediaStreamTrack;
  const uniforms:Record<string,number>={},ctx={drawImage:vi.fn()};
  const gl={VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,STATIC_DRAW:6,FLOAT:7,TEXTURE_2D:8,TEXTURE_MIN_FILTER:9,TEXTURE_MAG_FILTER:10,LINEAR:11,TEXTURE_WRAP_S:12,TEXTURE_WRAP_T:13,CLAMP_TO_EDGE:14,RGBA:15,UNSIGNED_BYTE:16,TRIANGLE_STRIP:17,
    createShader:vi.fn(()=>({})),shaderSource:vi.fn(),compileShader:vi.fn(),getShaderParameter:vi.fn(()=>true),createProgram:vi.fn(()=>({})),attachShader:vi.fn(),linkProgram:vi.fn(),getProgramParameter:vi.fn(()=>true),useProgram:vi.fn(),createBuffer:vi.fn(()=>({})),bindBuffer:vi.fn(),bufferData:vi.fn(),getAttribLocation:vi.fn(()=>0),enableVertexAttribArray:vi.fn(),vertexAttribPointer:vi.fn(),createTexture:vi.fn(()=>({})),bindTexture:vi.fn(),texParameteri:vi.fn(),viewport:vi.fn(),texImage2D:vi.fn(),getUniformLocation:vi.fn((_p,name:string)=>name),uniform1f:vi.fn((name:string,value:number)=>{uniforms[name]=value;}),drawArrays:vi.fn(),isContextLost:vi.fn(()=>false),deleteShader:vi.fn(),deleteTexture:vi.fn(),deleteBuffer:vi.fn(),deleteProgram:vi.fn(),getExtension:vi.fn(()=>({loseContext:vi.fn()}))};
  canvas.getContext=vi.fn((kind:string)=>kind==='webgl'&&gpu?gl:null) as any;fallback.getContext=vi.fn(()=>ctx) as any;
  const captureStream=vi.fn(()=>new Stream([output]));Object.defineProperty(HTMLCanvasElement.prototype,'captureStream',{configurable:true,value:captureStream});
  const original=document.createElement.bind(document);let canvasCount=0;
  vi.spyOn(document,'createElement').mockImplementation(((tag:string,...args:unknown[])=>tag==='video'?video:tag==='canvas'?canvasCount++===0?canvas:fallback:original(tag,...args)) as typeof document.createElement);
  return{canvas,fallback,video,output,ctx,gl,uniforms,captureStream};
}
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal('MediaStream',Stream);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();delete (HTMLCanvasElement.prototype as unknown as Record<string,unknown>).captureStream;});

describe('capacidade e tratamento da câmera',()=>{
  it('capabilities ausentes oferecem somente perfil confirmado, nunca 4K/FPS/zoom fictícios',()=>{
    const controls=studioCaptureVideoControls(source({width:1280,height:720}),null);
    expect(controls).toMatchObject({effects:false,processed:false,zoom:{mode:'none',value:1,max:1}});expect(controls.resolutions).toEqual([{width:1280,height:720,label:'1280 × 720'}]);expect(controls.frameRates).toEqual([]);
  });
  it('range zoom sem setting exposto não promete hardware; faixa real não é limitada artificialmente',()=>{
    const processor={effects:true} as any;
    expect(studioCaptureVideoControls(source({width:1920,height:1080},{zoom:{min:1,max:100}}),processor).zoom.mode).toBe('digital');
    expect(studioCaptureVideoControls(source({zoom:2},{zoom:{min:1,max:100,step:.1}}),processor).zoom).toEqual({mode:'hardware',min:1,max:100,step:.1,value:2});
  });
  it('grade parcial completa/clona valores e rejeita NaN/faixas ilegais antes de tocar pixels',()=>{
    const current=studioGrade();const next=studioCaptureGrade(current,{preset:'cinematic',exposure:.5});expect(current.preset).toBe('natural');expect(next).toEqual({...studioGrade('cinematic'),exposure:.5});expect(()=>studioCaptureGrade(current,{contrast:2})).toThrow('limites');expect(()=>studioCaptureGrade(current,{exposure:NaN})).toThrow('limites');
    expect(studioCaptureCrop(1920,1080,2)).toEqual({x:480,y:270,width:960,height:540});
  });
  it('GPU captura a superfície final e aplica grade/zoom aos pixels, sem alterar a fonte física',async()=>{
    const fixture=surface();const track=source();const engine=createStudioCaptureVideoProcessor(track,studioGrade(),1,vi.fn())!;await engine.prepare();
    expect(engine.effects).toBe(true);expect(engine.stream.getVideoTracks()).toEqual([fixture.output]);expect(fixture.gl.texImage2D.mock.calls[0].at(-1)).toBe(fixture.video);expect((fixture.video.srcObject as MediaStream).getTracks()).toEqual([track]);
    engine.configure({...studioGrade('cinematic'),exposure:.5,intensity:.7,temperature:.2},2);
    expect(fixture.uniforms).toMatchObject({preset:2,exposure:.5,intensity:.7,temperature:.2,zoom:2});expect(fixture.gl.drawArrays).toHaveBeenCalledTimes(2);expect((fixture.output as any).requestFrame).toHaveBeenCalledTimes(2);
    expect(fixture.gl.shaderSource.mock.calls[1][1]).toContain('(uv-.5)/zoom+.5');engine.dispose();expect(fixture.video.srcObject).toBeNull();expect(fixture.video.isConnected).toBe(false);expect(fixture.gl.deleteShader).toHaveBeenCalledTimes(2);expect((fixture.output as any).stop).not.toHaveBeenCalled();
  });
  it('sem GPU o zoom é crop 2D real e filtro é recusado explicitamente',async()=>{
    const fixture=surface(false);const engine=createStudioCaptureVideoProcessor(source(),studioGrade(),1,vi.fn())!;await engine.prepare();expect(engine.effects).toBe(false);
    engine.configure(studioGrade(),2);expect(fixture.ctx.drawImage).toHaveBeenLastCalledWith(fixture.video,480,270,960,540,0,0,1920,1080);expect(()=>engine.configure(studioGrade('studio'),2)).toThrow('não oferece processamento');engine.dispose();
  });
  it('dispose invalida primeiro frame pendente e não reinstala motor ao resolver play tardio',async()=>{
    const fixture=surface();let resolve!:()=>void;fixture.video.play=vi.fn(()=>new Promise<void>(r=>{resolve=r;}));const engine=createStudioCaptureVideoProcessor(source(),studioGrade(),1,vi.fn())!;
    const preparing=engine.prepare();engine.dispose();resolve();await expect(preparing).rejects.toMatchObject({name:'AbortError'});expect(fixture.gl.drawArrays).not.toHaveBeenCalled();expect(fixture.video.srcObject).toBeNull();
  });
  it('falha GPU após primeiro frame é reportada; não troca silenciosamente por arquivo sem tratamento',async()=>{
    const fixture=surface(),failed=vi.fn();const engine=createStudioCaptureVideoProcessor(source(),studioGrade('studio'),1,failed)!;await engine.prepare();fixture.gl.isContextLost.mockReturnValue(true);await vi.advanceTimersByTimeAsync(40);
    expect(failed).toHaveBeenCalledTimes(1);expect(failed.mock.calls[0][0].message).toContain('trecho capturado');expect(()=>engine.configure(studioGrade(),1)).toThrow('não está disponível');engine.dispose();
  });
  it('primeiro quadro durante ajuste não expira enquanto aba está oculta e retorna sem novo stream',async()=>{
    const fixture=surface();Object.defineProperty(fixture.video,'readyState',{value:0,configurable:true});const engine=createStudioCaptureVideoProcessor(source(),studioGrade(),1,vi.fn())!;
    let completed=false;const first=engine.prepare().then(()=>{completed=true;});await Promise.resolve();engine.setVisible(false);await vi.advanceTimersByTimeAsync(15000);expect(completed).toBe(false);expect(fixture.gl.drawArrays).not.toHaveBeenCalled();
    Object.defineProperty(fixture.video,'readyState',{value:2,configurable:true});engine.setVisible(true);await vi.advanceTimersByTimeAsync(50);await first;expect(completed).toBe(true);expect(fixture.captureStream).toHaveBeenCalledTimes(1);engine.dispose();
  });
  it('primeiro quadro sem imagem expira apenas em foreground e cancel sempre encerra espera',async()=>{
    const fixture=surface();Object.defineProperty(fixture.video,'readyState',{value:0,configurable:true});const engine=createStudioCaptureVideoProcessor(source(),studioGrade(),1,vi.fn())!;const preparing=engine.prepare();const rejected=expect(preparing).rejects.toThrow('não entregou imagem');await vi.advanceTimersByTimeAsync(8100);await rejected;engine.dispose();
  });
  it('falha de draw inicial rejeita a espera possuída; dispose não cria rejeição sem consumidor',async()=>{
    const fixture=surface(false);fixture.ctx.drawImage.mockImplementation(()=>{throw new Error('Rendering failed before first frame');});const engine=createStudioCaptureVideoProcessor(source(),studioGrade(),1,vi.fn())!;
    await expect(engine.prepare()).rejects.toThrow('Rendering failed');engine.dispose();await Promise.resolve();expect(fixture.video.srcObject).toBeNull();
  });
});
