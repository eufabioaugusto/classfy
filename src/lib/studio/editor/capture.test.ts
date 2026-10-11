import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioCapture, studioAudioLevels } from './capture';
const mocks=vi.hoisted(()=>({inspect:vi.fn()}));
vi.mock('./media',()=>({inspectStudioMedia:mocks.inspect}));
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(value:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
class Track {
  id='track';kind='audio';label='USB Microphone';readyState='live';onended:null|(()=>void)=null;onmute=null;
  stop=vi.fn(()=>{this.readyState='ended';});getSettings(){return{deviceId:'usb-id'};}
}
class Stream {
  constructor(public tracks:Track[]=[new Track()]){}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
}
class Recorder {
  static instances:Recorder[]=[];static isTypeSupported(){return true;}
  state='inactive';mimeType='audio/mp4';ondataavailable:null|((e:{data:Blob})=>void)=null;onstop:null|(()=>void)=null;onerror=null;
  constructor(){Recorder.instances.push(this);}start(){this.state='recording';}stop=vi.fn(()=>{this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['actual-media'],{type:this.mimeType})});this.onstop?.();});});
}
const mediaDevices={getUserMedia:vi.fn(),getDisplayMedia:vi.fn()};
class Audio {
  resume=vi.fn(async()=>{});close=vi.fn(async()=>{});
  createMediaStreamSource(){return{connect:vi.fn()};}createAnalyser(){return{fftSize:2048,getFloatTimeDomainData(samples:Float32Array){samples.fill(.5);}};}
}
beforeEach(()=>{
  vi.useFakeTimers();Recorder.instances=[];vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('MediaStream',Stream);vi.stubGlobal('AudioContext',Audio);
  Object.defineProperty(navigator,'mediaDevices',{value:mediaDevices,configurable:true});mediaDevices.getUserMedia.mockReset();mediaDevices.getDisplayMedia.mockReset();
  mocks.inspect.mockReset().mockResolvedValue({duration:.75,hasAudio:true});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('captura privada e áudio real',()=>{
  it('construção não solicita câmera ou mic; prepare mostra a entrada realmente autorizada',async()=>{
    const stream=new Stream();mediaDevices.getUserMedia.mockResolvedValue(stream);const capture=createStudioCapture({mode:'audio'});let state:any;capture.subscribe(next=>state=next);
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();await capture.prepare();expect(state.phase).toBe('ready');expect(Recorder.instances).toHaveLength(0);
    expect(state.input).toEqual({id:'usb-id',name:'USB Microphone'});await vi.advanceTimersByTimeAsync(100);expect(state.levels[0].averageDb).toBeCloseTo(-6.0206,3);capture.dispose();expect(stream.tracks[0].stop).toHaveBeenCalled();
  });
  it('permissão que resolve depois de cancel não reabre nem deixa mic ativo',async()=>{
    const pending=deferred<Stream>();mediaDevices.getUserMedia.mockReturnValue(pending.promise);const capture=createStudioCapture({mode:'audio'});let state:any;capture.subscribe(next=>state=next);
    const prepare=capture.prepare();capture.cancel();const stream=new Stream();pending.resolve(stream);await expect(prepare).rejects.toMatchObject({name:'AbortError'});expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);expect(state.phase).toBe('idle');expect(state.stream).toBeNull();capture.dispose();
  });
  it('STOP é idempotente, valida duração no arquivo e fecha entrada antes de metadata',async()=>{
    const stream=new Stream();mediaDevices.getUserMedia.mockResolvedValue(stream);const reading=deferred<any>();mocks.inspect.mockReturnValue(reading.promise);const capture=createStudioCapture({mode:'audio'});let state:any;capture.subscribe(next=>state=next);await capture.prepare();capture.start();
    const a=capture.stop(),b=capture.stop();expect(a).toBe(b);await Promise.resolve();expect(stream.tracks[0].stop).toHaveBeenCalled();expect(state.phase).toBe('stopping');reading.resolve({duration:9,hasAudio:true});const file=await a;
    expect(file.type).toBe('audio/mp4');expect(state.elapsed).toBe(9);expect(state.phase).toBe('recorded');expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1);capture.dispose();
  });
  it('encerramento da entrada preserva trecho e aviso até usar',async()=>{
    const stream=new Stream();mediaDevices.getUserMedia.mockResolvedValue(stream);const capture=createStudioCapture({mode:'audio'});let state:any;capture.subscribe(next=>state=next);await capture.prepare();capture.start();stream.tracks[0].onended?.();await vi.waitFor(()=>expect(state.phase).toBe('recorded'));expect(state.error).toContain('preservado');expect(state.file.size).toBeGreaterThan(0);capture.dispose();
  });
  it('negação da segunda permissão encerra tela já autorizada',async()=>{
    const track=new Track();track.kind='video';const screen=new Stream([track]);mediaDevices.getDisplayMedia.mockResolvedValue(screen);mediaDevices.getUserMedia.mockRejectedValue(new DOMException('denied','NotAllowedError'));
    const capture=createStudioCapture({mode:'screen'});await expect(capture.prepare()).rejects.toMatchObject({name:'NotAllowedError'});expect(track.stop).toHaveBeenCalled();capture.dispose();
  });
  it('dBFS representa RMS e pico independentes, com silêncio -120dBFS',()=>{
    const levels=studioAudioLevels([new Float32Array([0,1,0,-1]),new Float32Array(4)]);expect(levels[0].averageDb).toBeCloseTo(-3.0103,3);expect(levels[0].peakDb).toBe(0);expect(levels[1]).toEqual({averageDb:-120,peakDb:-120});
  });
  it('dispose libera STOP em metadata pendente e impede arquivo/estado tardios',async()=>{
    mediaDevices.getUserMedia.mockResolvedValue(new Stream());const reading=deferred<any>();mocks.inspect.mockReturnValue(reading.promise);const capture=createStudioCapture({mode:'audio'});const updates:any[]=[];capture.subscribe(state=>updates.push(state));await capture.prepare();capture.start();const stopping=capture.stop();await Promise.resolve();capture.dispose();await expect(stopping).rejects.toMatchObject({name:'AbortError'});const count=updates.length;reading.resolve({duration:9,hasAudio:true});await Promise.resolve();await Promise.resolve();expect(updates).toHaveLength(count);expect(updates.at(-1).phase).toBe('idle');
  });
  it('falha transitória na leitura preserva bytes e retry não reinicia gravador nem entrada',async()=>{
    mediaDevices.getUserMedia.mockResolvedValue(new Stream());mocks.inspect.mockRejectedValueOnce(new Error('Leitura temporariamente indisponível.')).mockResolvedValueOnce({duration:9,hasAudio:true});const capture=createStudioCapture({mode:'audio'});let state:any;capture.subscribe(value=>state=value);await capture.prepare();capture.start();await expect(capture.stop()).rejects.toThrow('temporariamente');const original=state.file;expect(original.size).toBeGreaterThan(0);expect(state.phase).toBe('error');const recovered=await capture.stop();expect(recovered).toBe(original);expect(state.phase).toBe('recorded');expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);expect(Recorder.instances).toHaveLength(1);capture.dispose();
  });
});
