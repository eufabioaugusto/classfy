import { EncodedAudioPacketSource, EncodedPacket } from 'mediabunny';
import { assertStudioActive } from './media';

const sampleRate=48000,channels=2;
const configuration:AudioEncoderConfig={codec:'mp4a.40.2',sampleRate,numberOfChannels:channels,bitrate:192000};
const calibrated=new Map<string,Promise<number>>();
function awaiting<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return work;assertStudioActive(signal);
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('Exportação cancelada.','AbortError'));};
    signal.addEventListener('abort',abort,{once:true});work.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
export function studioAudioCorrelationLag(reference:Float32Array,decoded:Float32Array,maximumLag=6000):number {
  const from=Math.round(sampleRate*.045),to=Math.min(reference.length,Math.round(sampleRate*.195));
  const score=(lag:number)=>{
    let xy=0,yy=0,xx=0;
    for(let i=from;i<to;i++){const y=decoded[i+lag]??0,x=reference[i];xy+=x*y;yy+=y*y;xx+=x*x;}
    return xy/Math.sqrt(Math.max(1e-20,xx*yy));
  };
  let best=0,value=-Infinity;
  for(let lag=0;lag<=maximumLag;lag+=4){const current=score(lag);if(current>value){value=current;best=lag;}}
  const coarse=best;
  for(let lag=Math.max(0,coarse-4);lag<=Math.min(maximumLag,coarse+4);lag++){const current=score(lag);if(current>value){value=current;best=lag;}}
  if(value<.6)throw new Error('O encoder AAC não permitiu confirmar a sincronização do áudio. Use outro navegador.');
  return best;
}
export function studioAudioCalibrationSignal():Float32Array {
  const result=new Float32Array(sampleRate/2);let seed=1729,filtered=0;
  for(let i=0;i<result.length;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;filtered=.78*filtered+.22*(seed/0x100000000*2-1);
    if(i>=sampleRate*.04&&i<sampleRate*.2){const p=(i-sampleRate*.04)/(sampleRate*.16);result[i]=filtered*.8*Math.sin(Math.PI*p)**2;}
  }
  return result;
}
function audioData(samples:readonly Float32Array[],timestamp:number):AudioData {
  const frames=samples[0].length,data=new Float32Array(frames*channels);for(let channel=0;channel<channels;channel++)data.set(samples[Math.min(channel,samples.length-1)],channel*frames);
  return new AudioData({format:'f32-planar',sampleRate,numberOfChannels:channels,numberOfFrames:frames,timestamp:Math.round(timestamp*1e6),data});
}
/** Measures this browser's AAC encoder+decoder delay; no device-dependent magic constant. */
async function calibrateAAC():Promise<number> {
  const input=studioAudioCalibrationSignal(),decoded=new Float32Array(sampleRate*.75);let config:AudioDecoderConfig|undefined,error:unknown;
  const packets:EncodedAudioChunk[]=[];
  const encoder=new AudioEncoder({output(chunk,meta){packets.push(chunk);if(meta?.decoderConfig)config=meta.decoderConfig;},error(value){error=value;}});
  let decoder:AudioDecoder|undefined;
  try{
    const support=await AudioEncoder.isConfigSupported(configuration);if(!support.supported)throw new Error('O encoder AAC não está disponível.');
    encoder.configure(configuration);
    for(let at=0;at<input.length;at+=4096){const part=input.slice(at,Math.min(input.length,at+4096)),data=audioData([part,part],at/sampleRate);encoder.encode(data);data.close();}
    await encoder.flush();if(error)throw error;if(!config)throw new Error('O encoder AAC não informou a configuração de áudio.');
    decoder=new AudioDecoder({output(data){try{const samples=new Float32Array(data.numberOfFrames);data.copyTo(samples,{planeIndex:0,format:'f32-planar'});const start=Math.round(data.timestamp/1e6*sampleRate);for(let i=0;i<samples.length;i++)if(start+i>=0&&start+i<decoded.length)decoded[start+i]=samples[i];}finally{data.close();}},error(value){error=value;}});
    decoder.configure(config);for(const packet of packets)decoder.decode(packet);await decoder.flush();if(error)throw error;
    return studioAudioCorrelationLag(input,decoded);
  }finally{if(encoder.state!=='closed')encoder.close();if(decoder&&decoder.state!=='closed')decoder.close();}
}
export async function getStudioAACDelay(signal?:AbortSignal):Promise<number>{
  assertStudioActive(signal);const key=JSON.stringify(configuration);let result=calibrated.get(key);
  if(!result){result=calibrateAAC();calibrated.set(key,result);result.catch(()=>{if(calibrated.get(key)===result)calibrated.delete(key);});}
  const delay=await awaiting(result,signal);assertStudioActive(signal);return delay;
}
/** Compensated packets retain AAC priming data in MP4 but trim it using the edit list. */
export class StudioAACSource {
  readonly source=new EncodedAudioPacketSource('aac');
  private encoder:AudioEncoder;
  private written:Promise<void>=Promise.resolve();
  private error:unknown;private at=0;private disposed=false;
  private readonly abort=()=>this.dispose();
  constructor(private duration:number,private delaySamples:number,private signal?:AbortSignal){
    this.encoder=new AudioEncoder({output:(chunk,meta)=>{
      if(this.disposed)return;
      const packet=EncodedPacket.fromEncodedChunk(chunk),at=packet.timestamp-this.delaySamples/sampleRate;
      if(at>=this.duration-.000001)return;
      const corrected=packet.clone({timestamp:at,duration:Math.min(packet.duration || 1024/sampleRate,this.duration-at)});
      this.written=this.written.then(()=>{assertStudioActive(this.signal);if(this.disposed)throw new DOMException('Exportação cancelada.','AbortError');return this.source.add(corrected,meta);}).catch(error=>{this.error=error;});
    },error:error=>{this.error=error;}});
    this.encoder.configure(configuration);
    this.signal?.addEventListener('abort',this.abort,{once:true});
  }
  async add(samples:readonly Float32Array[]){
    assertStudioActive(this.signal);if(this.error)throw this.error;
    const data=audioData(samples,this.at);this.at+=samples[0].length/sampleRate;
    try{this.encoder.encode(data);}finally{data.close();}
    if(this.encoder.encodeQueueSize>=4)await awaiting(new Promise<void>(resolve=>this.encoder.addEventListener('dequeue',()=>resolve(),{once:true})),this.signal);
    await awaiting(this.written,this.signal);if(this.error)throw this.error;assertStudioActive(this.signal);
  }
  async close(){await awaiting(this.encoder.flush(),this.signal);await awaiting(this.written,this.signal);if(this.error)throw this.error;assertStudioActive(this.signal);this.source.close();this.dispose();}
  dispose(){if(this.disposed)return;this.disposed=true;this.signal?.removeEventListener('abort',this.abort);if(this.encoder.state!=='closed')this.encoder.close();}
}
