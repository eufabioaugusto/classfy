import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioRecorder } from './StudioRecorder';

const mocks=vi.hoisted(()=>({inspect:vi.fn()}));
vi.mock('@/lib/studio/editor/media',()=>({inspectStudioMedia:mocks.inspect}));

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
class Track {
  id='microphone';kind='audio';label='USB Microphone';readyState='live';onended:null|(()=>void)=null;onmute=null;
  stop=vi.fn(()=>{this.readyState='ended';});getSettings(){return{deviceId:'usb-id'};}
}
class Stream {
  constructor(public tracks=[new Track()]){}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks;}getVideoTracks(){return[];}
}
class Recorder {
  static instances:Recorder[]=[];static isTypeSupported(){return true;}
  state='inactive';mimeType='audio/mp4';ondataavailable:null|((e:{data:Blob})=>void)=null;onstop:null|(()=>void)=null;onerror=null;
  constructor(){Recorder.instances.push(this);}start(){this.state='recording';}
  stop=vi.fn(()=>{this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['actual-recorded-bytes'],{type:this.mimeType})});this.onstop?.();});});
}
class Audio {
  resume=vi.fn(async()=>{});close=vi.fn(async()=>{});createMediaStreamSource(){return{connect:vi.fn()};}
  createAnalyser(){return{fftSize:2048,getFloatTimeDomainData(samples:Float32Array){samples.fill(.5);}};}
}
let root:Root,host:HTMLDivElement;
const permissions=vi.fn(),onClose=vi.fn(),onRecorded=vi.fn();
let added:ReturnType<typeof vi.spyOn>,removed:ReturnType<typeof vi.spyOn>;
const visibilityListeners=()=>{
  const active=new Set(added.mock.calls.filter(([event])=>event==='visibilitychange').map(([,listener])=>listener));
  removed.mock.calls.filter(([event])=>event==='visibilitychange').forEach(([,listener])=>active.delete(listener));return active.size;
};
async function mount(mode:'audio'|'camera'='audio'){await act(async()=>root.render(<StrictMode><StudioRecorder mode={mode} onRecorded={onRecorded} onClose={onClose}/></StrictMode>));}
async function click(label:string){const button=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent?.trim()===label);expect(button,`Botão ${label}`).toBeTruthy();await act(async()=>button!.click());}

beforeEach(()=>{
  (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
  Recorder.instances=[];permissions.mockReset();onClose.mockReset();onRecorded.mockReset().mockResolvedValue(undefined);mocks.inspect.mockReset().mockResolvedValue({duration:1,hasAudio:true});
  vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('MediaStream',Stream);vi.stubGlobal('AudioContext',Audio);
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:permissions},configurable:true});
  added=vi.spyOn(document,'addEventListener');removed=vi.spyOn(document,'removeEventListener');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('StudioRecorder com lifecycle React real',()=>{
  it('StrictMode prepara, grava e recupera leitura após replay sem controller fechado nem listener vazando',async()=>{
    const stream=new Stream();permissions.mockResolvedValue(stream);
    mocks.inspect.mockRejectedValueOnce(new Error('Leitura temporária indisponível.')).mockResolvedValueOnce({duration:1,hasAudio:true});
    await mount();expect(permissions).not.toHaveBeenCalled();expect(visibilityListeners()).toBe(1);
    expect(added.mock.calls.filter(([event])=>event==='visibilitychange')).toHaveLength(2);
    await click('Ativar microfone');expect(host.textContent).toContain('USB Microphone');
    await click('Iniciar gravação');await click('Encerrar gravação');expect(host.textContent).toContain('Leitura temporária');
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    await click('Tentar ler trecho');await click('Usar gravação');
    expect(onRecorded).toHaveBeenCalledTimes(1);expect(onRecorded.mock.calls[0][0]).toMatchObject({type:'audio/mp4'});
    expect(permissions).toHaveBeenCalledTimes(1);expect(Recorder.instances).toHaveLength(1);expect(onClose).toHaveBeenCalledTimes(1);
    await act(async()=>root.unmount());expect(visibilityListeners()).toBe(0);
  });
  it('troca de modo invalida permissão antiga, para a entrada tardia e mantém só o novo listener',async()=>{
    const waiting=deferred<Stream>();permissions.mockReturnValueOnce(waiting.promise);
    await mount();await click('Ativar microfone');await mount('camera');expect(visibilityListeners()).toBe(1);
    const oldStream=new Stream();await act(async()=>waiting.resolve(oldStream));
    expect(oldStream.tracks[0].stop).toHaveBeenCalledTimes(1);expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain('Ativar câmera');expect(onRecorded).not.toHaveBeenCalled();
  });
  it('unmount durante permissão elimina listener e rejeita captura tardia sem callback externo',async()=>{
    const waiting=deferred<Stream>();permissions.mockReturnValueOnce(waiting.promise);
    await mount();await click('Ativar microfone');await act(async()=>root.unmount());expect(visibilityListeners()).toBe(0);
    const stream=new Stream();await act(async()=>waiting.resolve(stream));expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);
    expect(onRecorded).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
  });
});
