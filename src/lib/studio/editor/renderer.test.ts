import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioRenderer, StudioRenderKernel, studioClipEnvelope, studioClipPose, studioClipSourceSeconds, studioFitRect, studioGradePixel, wrapStudioText } from './renderer';
import { studioGrade, type StudioRecipeClip, type StudioRenderRecipe } from '../../../../shared/studio';
const sources=vi.hoisted(()=>({audio:null as any, frames:[] as any[],dispose:vi.fn(),inputs:[] as any[],firstAudioGate:null as Promise<void>|null}));
vi.mock('mediabunny',()=>({
  ALL_FORMATS:[],BlobSource:class{},Input:class{index=sources.inputs.length;disposed=false;constructor(){sources.inputs.push(this);}getPrimaryVideoTrack=async()=>({canDecode:async()=>true,getDisplayWidth:async()=>100,getDisplayHeight:async()=>50});getPrimaryAudioTrack=async()=>({index:this.index,canDecode:async()=>true});dispose=()=>{this.disposed=true;sources.dispose();};},
  CanvasSink:class{async*canvases(start:number){for(const frame of sources.frames)if(frame.timestamp>=Math.floor(start*2)/2)yield frame;}},
  AudioBufferSink:class{constructor(private track:any){}async*buffers(){if(this.track.index===0&&sources.firstAudioGate)await sources.firstAudioGate;if(sources.audio)yield sources.audio;}},
}));
function clip(patch:Partial<StudioRecipeClip>={}):StudioRecipeClip{return{id:'clip',kind:'video',assetId:'asset',startTicks:0,durationTicks:240000,sourceStartTicks:0,sourceEndTicks:240000,zIndex:0,rect:{x:0,y:0,width:1,height:1},rotationDegrees:0,fit:'contain',opacity:1,gain:1,fadeInTicks:0,fadeOutTicks:0,effect:'natural',...patch};}
function recipe(clips=[clip()]):StudioRenderRecipe{return{version:2,timebase:120000,durationTicks:240000,mediaType:'video',canvas:{aspectRatio:'landscape',backgroundColor:'#000000'},output:{profile:'standard',width:320,height:180,frameRateNumerator:30,frameRateDenominator:1,colorSpace:'rec709'},assets:[{id:'asset',kind:'video',uri:'file://original',name:'original',durationTicks:480000,width:100,height:50,hasAudio:true}],clips};}
const commands:any[]=[];
beforeEach(()=>{
  commands.length=0;sources.dispose.mockClear();sources.audio=null;sources.inputs=[];sources.firstAudioGate=null;sources.frames=[0,.5,1,1.5,2,2.5].map(timestamp=>({timestamp,duration:.5,canvas:{width:100,height:50,label:timestamp}}));
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockImplementation(function(type:any){if(type==='webgl')return null;return{fillRect:(...args:any[])=>commands.push(['fill',...args]),drawImage:(...args:any[])=>commands.push(['draw',...args]),save:()=>commands.push(['save']),restore:()=>commands.push(['restore']),translate:(...args:any[])=>commands.push(['translate',...args]),rotate:(...args:any[])=>commands.push(['rotate',...args]),scale:(...args:any[])=>commands.push(['scale',...args]),beginPath(){},rect(){},clip(){},measureText:(v:string)=>({width:v.length*10}),fillText:(...args:any[])=>commands.push(['text',...args]),strokeText:(...args:any[])=>commands.push(['stroke',...args]),createLinearGradient:()=>({addColorStop:vi.fn()})}as any;});
});
describe('compositor compartilhado',()=>{
  it('trim/rate usa intervalo original; fades seguem tempo da montagem',()=>{
    const item=clip({sourceStartTicks:120000,sourceEndTicks:360000,durationTicks:120000,playbackRate:2,fadeInTicks:30000,fadeOutTicks:30000});
    expect(studioClipSourceSeconds(item,.5,120000)).toBe(2);expect(studioClipEnvelope(item,15000)).toBe(.5);expect(studioClipEnvelope(item,105000)).toBe(.5);
  });
  it('draw respeita z-order, posição, rotação e flips sem alterar original',async()=>{
    const main=clip({flipHorizontal:true,rotationDegrees:90,rect:{x:.25,y:.25,width:.5,height:.5}}),overlay=clip({id:'image-2',zIndex:2,flipVertical:true});
    const kernel=new StudioRenderKernel(recipe([overlay,main]),async()=>new Blob(['original']));const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;await kernel.draw(canvas,.75);
    expect(commands.filter(c=>c[0]==='scale')).toEqual([['scale',-1,1],['scale',1,-1]]);expect(commands.filter(c=>c[0]==='draw').map(c=>c[1].label)).toEqual([.5,.5]);expect(commands.find(c=>c[0]==='translate')).toEqual(['translate',160,90]);kernel.dispose();
  });
  it('mix é bounded por bloco; extração de áudio, velocidade, gain e mute são reais',async()=>{
    const channel=new Float32Array([0,.25,.5,.75,1,.75,.5,.25]);sources.audio={timestamp:0,duration:2,buffer:{sampleRate:4,length:8,numberOfChannels:1,getChannelData:()=>channel}};
    const fast=clip({kind:'audio',playbackRate:2,durationTicks:120000,sourceEndTicks:240000,gain:.5});const kernel=new StudioRenderKernel(recipe([fast]),async()=>new Blob(['original']));const result=await kernel.mixAudio(0,1,4);
    expect([...result[0]]).toEqual([0,.25,.5,.25]);expect([...result[1]]).toEqual([...result[0]]);kernel.dispose();
    const muted=new StudioRenderKernel(recipe([clip({gain:0})]),async()=>new Blob(['original']));expect([...((await muted.mixAudio(0,.5,4))[0])]).toEqual([0,0]);muted.dispose();
  });
  it('podcast com20originais descarta Inputs fora da janela sem exigir draw',async()=>{
    const clips=Array.from({length:20},(_,i)=>clip({id:`clip-${i}`,assetId:`audio-${i}`,kind:'audio',startTicks:i*120000,durationTicks:120000,sourceEndTicks:120000}));
    const input={...recipe(clips),mediaType:'audio' as const,durationTicks:2400000,assets:clips.map(c=>({id:c.assetId!,kind:'audio' as const,name:c.id,uri:`file://${c.id}`,durationTicks:120000,hasAudio:true}))};
    const samples=new Float32Array([.25,.25,.25,.25]);sources.audio={timestamp:0,duration:1,buffer:{sampleRate:4,length:4,numberOfChannels:1,getChannelData:()=>samples}};
    const kernel=new StudioRenderKernel(input,async()=>new Blob(['audio']));
    for(let i=0;i<20;i++){const mixed=await kernel.mixAudio(i,.25,4);expect(mixed[0][0]).toBe(.25);expect(sources.inputs.filter(value=>!value.disposed).length).toBeLessThanOrEqual(3);}
    expect(sources.inputs).toHaveLength(20);expect(sources.dispose).toHaveBeenCalledTimes(17);kernel.dispose();await Promise.resolve();expect(sources.dispose).toHaveBeenCalledTimes(20);
  });
  it('prune não fecha decode de áudio em voo quando draw e mix avançam; libera após conclusão',async()=>{
    let release!:()=>void;sources.firstAudioGate=new Promise<void>(resolve=>{release=resolve;});
    const clips=[clip({id:'a',assetId:'old',kind:'audio',durationTicks:120000,sourceEndTicks:120000}),clip({id:'b',assetId:'new',kind:'audio',startTicks:1200000,durationTicks:120000,sourceEndTicks:120000})];
    const input={...recipe(clips),mediaType:'audio' as const,durationTicks:1320000,assets:clips.map(c=>({id:c.assetId!,kind:'audio' as const,name:c.id,uri:`file://${c.id}`,durationTicks:120000,hasAudio:true}))};
    const samples=new Float32Array([.5,.5,.5,.5]);sources.audio={timestamp:0,duration:1,buffer:{sampleRate:4,length:4,numberOfChannels:1,getChannelData:()=>samples}};
    const kernel=new StudioRenderKernel(input,async()=>new Blob(['audio'])),pending=kernel.mixAudio(0,.25,4);await vi.waitFor(()=>expect(sources.inputs).toHaveLength(1));
    await kernel.mixAudio(10,.25,4);await kernel.draw(document.createElement('canvas'),10);expect(sources.inputs[0].disposed).toBe(false);
    release();expect((await pending)[0][0]).toBe(.5);expect(sources.inputs[0].disposed).toBe(true);expect(sources.inputs[1].disposed).toBe(false);
    kernel.dispose();await Promise.resolve();expect(sources.inputs.every(value=>value.disposed)).toBe(true);
  });
  it('janela de áudio distante mantém o decoder de vídeo ativo',async()=>{
    const input=recipe([clip(),clip({id:'audio',assetId:'audio',kind:'audio',startTicks:1200000})]);input.durationTicks=1440000;input.assets.push({id:'audio',kind:'audio',uri:'file://audio',name:'audio',durationTicks:240000,hasAudio:true});
    const kernel=new StudioRenderKernel(input,async()=>new Blob(['original']));await kernel.draw(document.createElement('canvas'),.25);await kernel.mixAudio(10,.25,4);
    expect(sources.inputs[0].disposed).toBe(false);await kernel.draw(document.createElement('canvas'),.75);expect(sources.inputs).toHaveLength(2);
    kernel.dispose();await Promise.resolve();expect(sources.inputs.every(value=>value.disposed)).toBe(true);
  });
  it('efeitos têm progressão local e conservam a fase após corte',()=>{
    const original=clip({motion:'pulse'}),trimmed=clip({startTicks:120000,motion:'pulse',motionOffsetTicks:60000});
    expect(studioClipPose(original,60000,120000).scale).toBe(studioClipPose(trimmed,0,120000).scale);
    const fade=clip({text:{content:'Aula',fontFamily:'System',fontSize:.04,color:'#ffffff',backgroundColor:'#00000000',alignment:'center',animation:'fade',animationDurationTicks:120000}});
    expect(studioClipPose(fade,60000,120000).alpha).toBe(.5);expect(studioClipPose(fade,120000,120000).alpha).toBe(1);
  });
  it('intensidade0 conserva pixels; preset/interpolação são efetivos',()=>{
    const rgb=[.1,.3,.7],grade={...studioGrade('cinematic'),intensity:0};expect(studioGradePixel(rgb,grade)).toEqual(rgb);
    const full=studioGradePixel(rgb,{...grade,intensity:1}),half=studioGradePixel(rgb,{...grade,intensity:.5});expect(full).not.toEqual(rgb);half.forEach((v,i)=>expect(v).toBeCloseTo((rgb[i]+full[i])/2));
  });
  it('contain/cover preservam proporção e texto quebra sem perder caracteres',()=>{
    expect(studioFitRect(100,50,100,100,'contain')).toEqual({x:0,y:25,width:100,height:50});expect(studioFitRect(100,50,100,100,'cover')).toEqual({x:-50,y:0,width:200,height:100});
    const lines=wrapStudioText({measureText:(v:string)=>({width:Array.from(v).length*10}as TextMetrics)},'Aula longa',30);expect(lines.join('')).toBe('Aula longa');expect(lines.every(line=>line.length<=3)).toBe(true);
  });
  it('dispose durante resolução impede original tardio de compor',async()=>{
    let resolve!:(blob:Blob)=>void;const pending=new Promise<Blob>(r=>resolve=r),kernel=new StudioRenderKernel(recipe(),()=>pending);const drawing=kernel.draw(document.createElement('canvas'),0);kernel.dispose();resolve(new Blob(['original']));await expect(drawing).rejects.toMatchObject({name:'AbortError'});expect(commands.some(c=>c[0]==='draw')).toBe(false);
  });
  it('Pause vence resume atrasado e Play concorrente agenda somente uma operação',async()=>{
    let resolve!:()=>void;const resume=new Promise<void>(r=>resolve=r),frames=vi.fn(()=>1);vi.stubGlobal('requestAnimationFrame',frames);vi.stubGlobal('cancelAnimationFrame',vi.fn());
    vi.stubGlobal('AudioContext',class{currentTime=0;resume=()=>resume;close=async()=>{};});
    const engine=await createStudioRenderer(recipe(),async()=>new Blob(['original']));let state:any;engine.subscribe(s=>state=s);
    const a=engine.play(),b=engine.play();expect(a).toBe(b);engine.pause();resolve();await a;expect(state.playing).toBe(false);expect(frames).not.toHaveBeenCalled();engine.dispose();vi.unstubAllGlobals();
  });
  it('draw antigo rejeitado durante recipe nova não apaga quadro nem erro da sessão atual',async()=>{
    let reject!:(error:unknown)=>void,first=true;const old=new Promise<Blob>((_,r)=>reject=r),resolve=()=>first?(first=false,old):Promise.resolve(new Blob(['new']));
    const engine=await createStudioRenderer(recipe(),resolve);let state:any;engine.subscribe(s=>state=s);const target=document.createElement('canvas');const stale=engine.draw(target,0);await Promise.resolve();await Promise.resolve();
    const changing=engine.setRecipe(recipe([clip({rect:{x:.25,y:.25,width:.5,height:.5}})]));reject(new Error('decoder antigo encerrado'));await stale;await changing;expect(state.error).toBeNull();expect(state.position).toBe(0);engine.dispose();
  });
  it('falha no primeiro quadro libera decoder e listener mesmo sem devolver o renderer ao caller',async()=>{
    sources.frames=[];
    const add=vi.spyOn(document,'addEventListener'),remove=vi.spyOn(document,'removeEventListener');
    const target=document.createElement('canvas');
    await expect(createStudioRenderer(recipe(),async()=>new Blob(['original']),{canvas:target})).rejects.toThrow('decodificar o quadro');
    const registered=add.mock.calls.find(call=>call[0]==='visibilitychange');
    expect(registered).toBeTruthy();
    expect(remove).toHaveBeenCalledWith('visibilitychange',registered![1]);
    expect(sources.inputs).toHaveLength(1);
    expect(sources.inputs[0].disposed).toBe(true);
    expect(sources.dispose).toHaveBeenCalledOnce();
    add.mockRestore();remove.mockRestore();
  });
});
