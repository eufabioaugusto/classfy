import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { getStudioAACDelay, StudioAACSource, studioAudioCalibrationSignal, studioAudioCorrelationLag } from './exportAudio';
const mocks=vi.hoisted(()=>({packets:[]as any[]}));
vi.mock('mediabunny',()=>({EncodedAudioPacketSource:class{add=async(packet:any,meta:any)=>{mocks.packets.push({packet,meta});};close=vi.fn();},EncodedPacket:class{static fromEncodedChunk(chunk:any){return{timestamp:chunk.timestamp/1e6,duration:chunk.duration/1e6,clone(options:any){return{...this,...options};}};}}}));
class Data {
  numberOfFrames:number;timestamp:number;numberOfChannels=2;
  constructor(public value:any){this.numberOfFrames=value.numberOfFrames;this.timestamp=value.timestamp;}
  copyTo(target:Float32Array){target.set(this.value.data.subarray(0,this.numberOfFrames));}close=vi.fn();
}
class Encoder extends EventTarget{
  static instances:Encoder[]=[];static isConfigSupported=async()=>({supported:true});state='configured';encodeQueueSize=0;
  constructor(public callbacks:any){super();Encoder.instances.push(this);}configure(){}
  encode(data:Data){this.callbacks.output({timestamp:data.timestamp,duration:data.numberOfFrames/48000*1e6,samples:new Float32Array(data.value.data),frames:data.numberOfFrames},{decoderConfig:{codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2}});}
  flush=async()=>{};close=vi.fn(()=>{this.state='closed';});
}
class Decoder{
  state='configured';constructor(public callbacks:any){}configure(){}
  decode(chunk:any){this.callbacks.output(new Data({numberOfFrames:chunk.frames,timestamp:chunk.timestamp+50000,data:chunk.samples}));}flush=async()=>{};close(){this.state='closed';}
}
beforeEach(()=>{mocks.packets=[];Encoder.instances=[];vi.stubGlobal('AudioData',Data);vi.stubGlobal('AudioEncoder',Encoder);vi.stubGlobal('AudioDecoder',Decoder);});
afterEach(()=>vi.unstubAllGlobals());
it('calibração mede delay do encoder/decoder real do contrato e reutiliza config, sem constante de aparelho',async()=>{const first=await getStudioAACDelay(),second=await getStudioAACDelay();expect(first).toBe(2400);expect(second).toBe(first);expect(Encoder.instances).toHaveLength(1);expect(Encoder.instances[0].close).toHaveBeenCalledOnce();});
it('correlação distingue delay exato e rejeita sinal não verificável',()=>{const input=studioAudioCalibrationSignal(),output=new Float32Array(input.length+3000);output.set(input,2112);expect(studioAudioCorrelationLag(input,output)).toBe(2112);expect(()=>studioAudioCorrelationLag(input,new Float32Array(output.length))).toThrow('sincronização');});
it('MP4 recebe priming negativo e fim exato; não elimina dados necessários ao decoder',async()=>{
  const source=new StudioAACSource(1,2400),encoder=Encoder.instances[0];encoder.callbacks.output({timestamp:0,duration:21333},{decoderConfig:{codec:'aac'}});encoder.callbacks.output({timestamp:1040000,duration:21333});encoder.callbacks.output({timestamp:1100000,duration:21333});await source.close();
  expect(mocks.packets).toHaveLength(2);expect(mocks.packets[0].packet.timestamp).toBe(-.05);expect(mocks.packets[1].packet.timestamp).toBeCloseTo(.99);expect(mocks.packets[1].packet.duration).toBeCloseTo(.01);expect(mocks.packets[0].meta.decoderConfig.codec).toBe('aac');
});
it('cancel libera backpressure pendente e ignora callbacks tardios owned',async()=>{
  const controller=new AbortController(),source=new StudioAACSource(1,2400,controller.signal),encoder=Encoder.instances[0];encoder.encodeQueueSize=4;const pending=source.add([new Float32Array(1024),new Float32Array(1024)]);controller.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});const count=mocks.packets.length;encoder.callbacks.output({timestamp:100000,duration:21333});await Promise.resolve();expect(mocks.packets).toHaveLength(count);expect(encoder.close).toHaveBeenCalledOnce();
});
