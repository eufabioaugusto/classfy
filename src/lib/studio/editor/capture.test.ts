import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioCapture, studioAudioLevels, type StudioCaptureState } from './capture';
const mocks=vi.hoisted(()=>({inspect:vi.fn()}));
vi.mock('./media',()=>({inspectStudioMedia:mocks.inspect}));
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(value:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
class Track {
  id='track';readyState='live';enabled=true;muted=false;onended:null|(()=>void)=null;onmute:null|(()=>void)=null;onunmute:null|(()=>void)=null;
  constructor(public kind='audio',public deviceId='usb-id',public label='USB Microphone'){}
  stop=vi.fn(()=>{this.readyState='ended';});getSettings(){return{deviceId:this.deviceId,width:1920,height:1080,frameRate:30};}
}
class Stream {
  constructor(public tracks:Track[]=[new Track()]){}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(t=>t.kind==='audio');}getVideoTracks(){return this.tracks.filter(t=>t.kind==='video');}
}
class Recorder {
  static instances:Recorder[]=[];static isTypeSupported(){return true;}
  state='inactive';mimeType='audio/mp4';ondataavailable:null|((e:{data:Blob})=>void)=null;onstop:null|(()=>void)=null;onerror=null;
  constructor(){Recorder.instances.push(this);}start(){this.state='recording';}stop=vi.fn(()=>{this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['actual-media'],{type:this.mimeType})});this.onstop?.();});});
}
const deviceEvents=new EventTarget();
const mediaDevices={getUserMedia:vi.fn(),getDisplayMedia:vi.fn(),enumerateDevices:vi.fn(),addEventListener:vi.fn(deviceEvents.addEventListener.bind(deviceEvents)),removeEventListener:vi.fn(deviceEvents.removeEventListener.bind(deviceEvents))};
class Audio {
  static instances:Audio[]=[];sources:{stream:Stream;connect:ReturnType<typeof vi.fn>}[]=[];
  constructor(){Audio.instances.push(this);}
  resume=vi.fn(async()=>{});close=vi.fn(async()=>{});
  createMediaStreamSource(stream:Stream){const source={stream,connect:vi.fn()};this.sources.push(source);return source;}createAnalyser(){return{fftSize:2048,getFloatTimeDomainData(samples:Float32Array){samples.fill(.5);}};}
  createMediaStreamDestination(){return{stream:new Stream([new Track('audio','mixed-output','Mixed output')])};}
}
beforeEach(()=>{
  vi.useFakeTimers();Recorder.instances=[];Audio.instances=[];vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('MediaStream',Stream);vi.stubGlobal('AudioContext',Audio);
  Object.defineProperty(navigator,'mediaDevices',{value:mediaDevices,configurable:true});mediaDevices.getUserMedia.mockReset();mediaDevices.getDisplayMedia.mockReset();
  mediaDevices.enumerateDevices.mockReset().mockResolvedValue([]);mediaDevices.addEventListener.mockClear();mediaDevices.removeEventListener.mockClear();
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

const device=(kind:'videoinput'|'audioinput',id:string,name:string)=>({kind,deviceId:id,label:name});
function watch(options:Parameters<typeof createStudioCapture>[0]){const capture=createStudioCapture(options);let state:StudioCaptureState;capture.subscribe(value=>state=value);return{capture,state:()=>state};}
const changed=()=>deviceEvents.dispatchEvent(new Event('devicechange'));
const drain=async()=>{await Promise.resolve();await Promise.resolve();};

describe('dispositivos reais e privacidade do seletor',()=>{
  it('seleção idle não pede permissão; câmera externa e mic legado usam deviceId exact e nomes confirmados',async()=>{
    const camera=new Track('video','continuity-camera','iPhone de Fabio'),mic=new Track('audio','usb-mic','Microfone USB');
    mediaDevices.getUserMedia.mockResolvedValue(new Stream([camera,mic]));mediaDevices.enumerateDevices.mockResolvedValue([device('videoinput','continuity-camera','iPhone de Fabio'),device('audioinput','usb-mic','Microfone USB')]);
    const h=watch({mode:'camera',cameraId:'initial-camera',deviceId:'initial-mic'});changed();await drain();expect(mediaDevices.enumerateDevices).not.toHaveBeenCalled();
    await h.capture.selectDevices({cameraId:'continuity-camera',microphoneId:'usb-mic'});expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();expect(h.state().camera).toBeNull();
    await h.capture.prepare();await drain();expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({video:{deviceId:{exact:'continuity-camera'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}},audio:{deviceId:{exact:'usb-mic'},echoCancellation:true}});
    expect(h.state().camera).toEqual({id:'continuity-camera',name:'iPhone de Fabio'});expect(h.state().input).toEqual({id:'usb-mic',name:'Microfone USB'});expect(h.state().devices).toEqual({cameras:[{id:'continuity-camera',name:'iPhone de Fabio'}],microphones:[{id:'usb-mic',name:'Microfone USB'}]});h.capture.dispose();
  });
  it('o construtor mantém deviceId como microfone e câmera vazia volta a facing em vez de repetir exact antigo',async()=>{
    mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([new Track('video','external','Câmera externa'),new Track('audio','mic','Mic')])).mockResolvedValueOnce(new Stream([new Track('video','front','Frontal')]));
    const h=watch({mode:'camera',cameraId:'external',deviceId:'mic'});await h.capture.prepare();expect(mediaDevices.getUserMedia.mock.calls[0][0].audio).toEqual({deviceId:{exact:'mic'},echoCancellation:true});
    await h.capture.flip();expect(mediaDevices.getUserMedia.mock.calls[1][0]).toEqual({video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}},audio:false});expect(h.state().camera?.id).toBe('front');h.capture.dispose();
  });
  it('troca somente câmera e mantém mic; trocar mic mantém câmera e estado de silêncio real',async()=>{
    const oldCamera=new Track('video','built-in','Câmera integrada'),oldMic=new Track('audio','built-in-mic','Microfone integrado'),camera=new Track('video','usb-camera','Câmera USB'),mic=new Track('audio','wireless','Wireless');
    mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([oldCamera,oldMic])).mockResolvedValueOnce(new Stream([camera])).mockResolvedValueOnce(new Stream([mic]));
    const h=watch({mode:'camera'});await h.capture.prepare();await h.capture.selectDevices({cameraId:'usb-camera'});expect(mediaDevices.getUserMedia.mock.calls[1][0].audio).toBe(false);expect(oldCamera.stop).toHaveBeenCalledTimes(1);expect(oldMic.stop).not.toHaveBeenCalled();expect(h.state().stream?.getAudioTracks()).toEqual([oldMic]);
    h.capture.setMicrophoneEnabled(false);expect(oldMic.enabled).toBe(false);expect(h.state().levels).toEqual([{averageDb:-120,peakDb:-120}]);
    await h.capture.selectDevices({microphoneId:'wireless'});expect(mediaDevices.getUserMedia.mock.calls[2][0].video).toBe(false);expect(mic.enabled).toBe(false);expect(oldMic.stop).toHaveBeenCalledTimes(1);expect(camera.stop).not.toHaveBeenCalled();expect(h.state().input).toEqual({id:'wireless',name:'Wireless'});
    await vi.advanceTimersByTimeAsync(100);expect(h.state().levels[0].averageDb).toBe(-120);h.capture.setMicrophoneEnabled(true);expect(mic.enabled).toBe(true);await vi.advanceTimersByTimeAsync(100);expect(h.state().levels[0].averageDb).toBeCloseTo(-6.0206);h.capture.dispose();expect(camera.stop).toHaveBeenCalledTimes(1);expect(mic.stop).toHaveBeenCalledTimes(1);
  });
  it('falha de seleção mantém entrada atual e mensagem legível sem assumir o dispositivo solicitado',async()=>{
    const camera=new Track('video','current','Atual'),mic=new Track();mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([camera,mic])).mockRejectedValueOnce(new DOMException('constraints','OverconstrainedError'));
    const h=watch({mode:'camera'});await h.capture.prepare();const preview=h.state().stream;await expect(h.capture.selectDevices({cameraId:'offline'})).rejects.toThrow('dispositivo escolhido');expect(h.state().phase).toBe('ready');expect(h.state().stream).toBe(preview);expect(h.state().camera?.id).toBe('current');expect(camera.stop).not.toHaveBeenCalled();expect(h.state().error).toContain('escolha outra entrada');h.capture.dispose();
  });
  it('bloqueia troca em REC/STOP e preserve candidato sem reabrir permissão ou apagar arquivo',async()=>{
    mediaDevices.getUserMedia.mockResolvedValue(new Stream());const reading=deferred<{duration:number;hasAudio:boolean}>();mocks.inspect.mockReturnValue(reading.promise);const h=watch({mode:'audio'});await h.capture.prepare();h.capture.start();
    await expect(h.capture.selectDevices({microphoneId:'other'})).rejects.toThrow('antes de iniciar');const stop=h.capture.stop();await expect(h.capture.selectDevices({microphoneId:'other'})).rejects.toThrow('antes de iniciar');reading.reject(new Error('Decoder indisponível'));await expect(stop).rejects.toThrow('Decoder');const original=h.state().file;
    await expect(h.capture.selectDevices({microphoneId:'other'})).rejects.toThrow('take pendente');await expect(h.capture.prepare()).rejects.toThrow('take pendente');expect(h.state().file).toBe(original);expect(original?.size).toBeGreaterThan(0);expect(mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);h.capture.dispose();
  });
  it('devicechange publica a lista mais recente, não transforma exposição limitada em perda e ignora resposta após dispose',async()=>{
    const first=deferred<ReturnType<typeof device>[]>(),second=deferred<ReturnType<typeof device>[]>(),last=deferred<ReturnType<typeof device>[]>();mediaDevices.getUserMedia.mockResolvedValue(new Stream());mediaDevices.enumerateDevices.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(last.promise);
    const h=watch({mode:'audio'});await h.capture.prepare();changed();second.resolve([device('audioinput','new','Novo USB')]);await drain();first.resolve([device('audioinput','old','Antigo')]);await drain();expect(h.state().devices.microphones).toEqual([{id:'new',name:'Novo USB'}]);expect(h.state().phase).toBe('ready');
    changed();const count=mediaDevices.enumerateDevices.mock.calls.length;h.capture.dispose();last.resolve([device('audioinput','late','Tardio')]);await drain();changed();await drain();expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(count);expect(mediaDevices.removeEventListener).toHaveBeenCalledWith('devicechange',expect.any(Function));expect(h.state().phase).toBe('idle');
  });
  it('troca em voo cancelada não reabre a câmera nem deixa novos tracks/contexts ligados',async()=>{
    const pending=deferred<Stream>(),camera=new Track('video','original','Original'),mic=new Track();mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([camera,mic])).mockReturnValueOnce(pending.promise);const h=watch({mode:'camera'});await h.capture.prepare();const swapping=h.capture.selectDevices({cameraId:'usb'});
    await expect(h.capture.selectDevices({cameraId:'second'})).rejects.toThrow('antes de iniciar');h.capture.cancel();const late=new Track('video','usb','USB');pending.resolve(new Stream([late]));await expect(swapping).rejects.toMatchObject({name:'AbortError'});expect(late.stop).toHaveBeenCalledTimes(1);expect(camera.stop).toHaveBeenCalledTimes(1);expect(mic.stop).toHaveBeenCalledTimes(1);expect(h.state().stream).toBeNull();expect(Audio.instances.every(ctx=>ctx.close.mock.calls.length===1)).toBe(true);h.capture.dispose();
  });
});

describe('tela e microfone em caminhos separados',()=>{
  it('troca mic preserva display privado e áudio da tela; medidor e mute seguem somente mic físico',async()=>{
    const video=new Track('video','screen','Tela escolhida'),screenAudio=new Track('audio','display-audio','Áudio da tela'),mic=new Track('audio','old-mic','USB antigo'),replacement=new Track('audio','new-mic','USB novo');
    const display=new Stream([video,screenAudio]);mediaDevices.getDisplayMedia.mockResolvedValue(display);mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([mic])).mockResolvedValueOnce(new Stream([replacement]));
    const h=watch({mode:'screen'});await h.capture.prepare();expect(h.state().camera).toBeNull();expect(h.state().input?.name).toBe('USB antigo');
    const analyserSource=Audio.instances[0].sources.find(source=>source.connect.mock.calls.some(([target])=>target.fftSize===2048));expect(analyserSource?.stream.getAudioTracks()).toEqual([mic]);
    h.capture.setMicrophoneEnabled(false);expect(mic.enabled).toBe(false);expect(screenAudio.enabled).toBe(true);expect(h.state().stream?.getAudioTracks()[0].enabled).toBe(true);expect(h.state().levels[0].averageDb).toBe(-120);
    await h.capture.selectDevices({microphoneId:'new-mic'});expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);expect(mediaDevices.getUserMedia.mock.calls[1][0]).toEqual({video:false,audio:{deviceId:{exact:'new-mic'},echoCancellation:true}});expect(video.stop).not.toHaveBeenCalled();expect(screenAudio.stop).not.toHaveBeenCalled();expect(mic.stop).toHaveBeenCalledTimes(1);expect(replacement.enabled).toBe(false);expect(h.state().stream?.getVideoTracks()).toEqual([video]);expect(h.state().input?.name).toBe('USB novo');h.capture.dispose();expect(video.stop).toHaveBeenCalledTimes(1);expect(screenAudio.stop).toHaveBeenCalledTimes(1);expect(replacement.stop).toHaveBeenCalledTimes(1);
  });
  it('perda do mic original encerra REC com arquivo parcial mesmo quando destination continua vivo',async()=>{
    const video=new Track('video','display','Display'),mic=new Track('audio','physical','Physical');mediaDevices.getDisplayMedia.mockResolvedValue(new Stream([video]));mediaDevices.getUserMedia.mockResolvedValue(new Stream([mic]));const h=watch({mode:'screen'});await h.capture.prepare();h.capture.start();
    const destination=h.state().stream!.getAudioTracks()[0];expect(destination.readyState).toBe('live');mic.readyState='ended';mic.onended?.();await vi.waitFor(()=>expect(h.state().phase).toBe('recorded'));expect(h.state().error).toContain('preservado');expect(h.state().file!.size).toBeGreaterThan(0);expect(Recorder.instances[0].stop).toHaveBeenCalledTimes(1);expect(video.stop).toHaveBeenCalledTimes(1);h.capture.dispose();
  });
  it('troca mic negada não obriga escolher tela outra vez, e cancel fecha display durante troca pendente',async()=>{
    const video=new Track('video','display','Display'),mic=new Track();mediaDevices.getDisplayMedia.mockResolvedValue(new Stream([video]));mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([mic])).mockRejectedValueOnce(new DOMException('denied','NotAllowedError'));
    const h=watch({mode:'screen'});await h.capture.prepare();await expect(h.capture.selectDevices({microphoneId:'denied'})).rejects.toMatchObject({name:'NotAllowedError'});expect(h.state().phase).toBe('ready');expect(video.stop).not.toHaveBeenCalled();expect(h.state().input?.id).toBe('usb-id');expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(1);
    const pending=deferred<Stream>();mediaDevices.getUserMedia.mockReturnValueOnce(pending.promise);const work=h.capture.selectDevices({microphoneId:'late'});h.capture.dispose();const late=new Track();pending.resolve(new Stream([late]));await expect(work).rejects.toMatchObject({name:'AbortError'});expect(late.stop).toHaveBeenCalledTimes(1);expect(video.stop).toHaveBeenCalledTimes(1);
  });
});

describe('confirmação tardia do caminho de áudio',()=>{
  it('mute alterado durante AudioContext.resume pendente é aplicado ao novo mic antes de entregar ready',async()=>{
    const pending=deferred<void>();class DelayedAudio extends Audio{resume=vi.fn(async()=>{if(Audio.instances.length===2)await pending.promise;});}vi.stubGlobal('AudioContext',DelayedAudio);
    const oldMic=new Track('audio','old','Antigo'),newMic=new Track('audio','new','Novo');mediaDevices.getUserMedia.mockResolvedValueOnce(new Stream([oldMic])).mockResolvedValueOnce(new Stream([newMic]));
    const h=watch({mode:'audio'});await h.capture.prepare();const changing=h.capture.selectDevices({microphoneId:'new'});await drain();expect(h.state().phase).toBe('preparing');h.capture.setMicrophoneEnabled(false);pending.resolve();await changing;
    expect(h.state().phase).toBe('ready');expect(h.state().microphoneEnabled).toBe(false);expect(newMic.enabled).toBe(false);await vi.advanceTimersByTimeAsync(100);expect(h.state().levels[0].averageDb).toBe(-120);h.capture.dispose();
  });
});
