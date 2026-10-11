import { beforeEach, expect, it, vi } from 'vitest';
import { exportStudioRecipe } from './export';
import type { StudioRenderRecipe } from '../../../../shared/studio';
const mocks=vi.hoisted(()=>({order:[]as string[],canVideo:vi.fn(),canAudio:vi.fn(),cancel:vi.fn(),inspect:vi.fn(),recipes:[]as any[],audioChannels:[]as any[],onVideo:null as null|(()=>Promise<void>)}));
vi.mock('mediabunny',()=>({Quality:class{},Mp4OutputFormat:class{},BufferTarget:class{buffer=new Uint8Array([1,2,3]).buffer;},StreamTarget:class{},
  canEncodeVideo:mocks.canVideo,canEncodeAudio:mocks.canAudio,
  Output:class{addVideoTrack(){}addAudioTrack(){}start=async()=>{mocks.order.push('start');};finalize=async()=>{mocks.order.push('finalize');};cancel=mocks.cancel;},
  CanvasSource:class{async add(at:number){mocks.order.push(`video:${at}`);if(mocks.onVideo)await mocks.onVideo();}close(){mocks.order.push('video-close');}},
  AudioBufferSource:class{async add(){mocks.order.push('audio');}close(){mocks.order.push('audio-close');}},
}));
vi.mock('./renderer',()=>({studioBrowserFont:()=> 'Arial',StudioRenderKernel:class{constructor(recipe:any){mocks.recipes.push(recipe);}draw=async()=>{};mixAudio=async(_start:number,length:number)=>[new Float32Array(Math.round(length*48000)),new Float32Array(Math.round(length*48000))];dispose=vi.fn();}}));
vi.mock('./exportAudio',()=>({getStudioAACDelay:async()=>2400,StudioAACSource:class{source={};async add(){mocks.order.push('audio');}async close(){mocks.order.push('audio-close');}dispose(){}}}));
vi.mock('./media',async(importOriginal)=>({...await importOriginal<any>(),inspectStudioMedia:mocks.inspect}));
const recipe=():StudioRenderRecipe=>({version:2,timebase:120000,durationTicks:120000,mediaType:'video',canvas:{aspectRatio:'landscape',backgroundColor:'#000000'},output:{profile:'standard',width:320,height:180,frameRateNumerator:30,frameRateDenominator:1,colorSpace:'rec709'},assets:[{id:'a',kind:'video',uri:'file://original',name:'original',durationTicks:120000,width:320,height:180,hasAudio:true}],clips:[{id:'c',kind:'video',assetId:'a',startTicks:0,durationTicks:120000,sourceStartTicks:0,sourceEndTicks:120000,zIndex:0,rect:{x:0,y:0,width:1,height:1},rotationDegrees:0,fit:'contain',opacity:1,gain:1,fadeInTicks:0,fadeOutTicks:0,effect:'natural'}]});
beforeEach(()=>{mocks.order=[];mocks.recipes=[];mocks.onVideo=null;mocks.canVideo.mockReset().mockResolvedValue(true);mocks.canAudio.mockReset().mockResolvedValue(true);mocks.cancel.mockReset().mockResolvedValue(undefined);mocks.inspect.mockReset().mockResolvedValue({duration:1,width:320,height:180,hasAudio:true});Object.defineProperty(navigator,'storage',{value:{},configurable:true});
  vi.stubGlobal('AudioBuffer',class{duration:number;constructor(public options:any){this.duration=options.length/options.sampleRate;}copyToChannel(){}});
});
it('export offline usa receita congelada, interleave e backpressure; 100% só após validar arquivo',async()=>{
  const input=recipe(),progress:number[]=[];const pending=exportStudioRecipe(input,async()=>new Blob(['original']),{onProgress:p=>progress.push(p)});input.clips[0].gain=0;const file=await pending;
  expect(mocks.recipes[0].clips[0].gain).toBe(1);expect(file.type).toBe('video/mp4');expect(file.name.endsWith('.mp4')).toBe(true);expect(mocks.order.indexOf('audio')).toBeLessThan(mocks.order.indexOf('video-close'));expect(mocks.order).toContain('finalize');expect(progress.at(-1)).toBe(1);expect(progress.slice(0,-1).every(p=>p<1)).toBe(true);expect(mocks.inspect).toHaveBeenCalledOnce();
});
it('perfil não suportado rejeita antes de criar arquivo; nenhum downgrade silencioso',async()=>{mocks.canVideo.mockResolvedValue(false);await expect(exportStudioRecipe(recipe(),async()=>new Blob())).rejects.toThrow('resolução');expect(mocks.order).toEqual([]);});
it('cancel em encoder pending não certifica arquivo nem publica conclusão',async()=>{
  const controller=new AbortController(),progress:number[]=[];mocks.onVideo=async()=>{controller.abort();};await expect(exportStudioRecipe(recipe(),async()=>new Blob(),{signal:controller.signal,onProgress:p=>progress.push(p)})).rejects.toMatchObject({name:'AbortError'});expect(mocks.cancel).toHaveBeenCalled();expect(progress).not.toContain(1);expect(mocks.inspect).not.toHaveBeenCalled();
});
it('encoder sem áudio ou geometria correta rejeita resultado completo',async()=>{mocks.inspect.mockResolvedValue({duration:1,width:320,height:180,hasAudio:false});await expect(exportStudioRecipe(recipe(),async()=>new Blob())).rejects.toThrow('áudio');expect(mocks.cancel).toHaveBeenCalled();});
it('cadência degradada não é certificada apenas pela dimensão correta',async()=>{mocks.inspect.mockResolvedValue({duration:1,width:320,height:180,hasAudio:true,frameRate:24});await expect(exportStudioRecipe(recipe(),async()=>new Blob())).rejects.toThrow('cadência');expect(mocks.cancel).toHaveBeenCalled();});
