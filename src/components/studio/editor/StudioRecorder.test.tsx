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
async function mount(mode:'audio'|'camera'='audio',scopeKey='owner:project'){await act(async()=>root.render(<StrictMode><StudioRecorder mode={mode} scopeKey={scopeKey} onRecorded={onRecorded} onClose={onClose}/></StrictMode>));}
async function answer(label:string){const dialog=document.querySelector('[role="alertdialog"]');expect(dialog).toBeTruthy();const button=[...dialog!.querySelectorAll('button')].find(value=>value.textContent?.trim()===label);expect(button).toBeTruthy();await act(async()=>button!.click());}
async function click(label:string){const button=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent?.trim()===label);expect(button,`Botão ${label}`).toBeTruthy();await act(async()=>button!.click());}

beforeEach(()=>{
  (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
  Recorder.instances=[];permissions.mockReset();onClose.mockReset();onRecorded.mockReset().mockResolvedValue(undefined);mocks.inspect.mockReset().mockResolvedValue({duration:1,hasAudio:true});
  vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('MediaStream',Stream);vi.stubGlobal('AudioContext',Audio);
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:permissions},configurable:true});
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
  added=vi.spyOn(document,'addEventListener');removed=vi.spyOn(document,'removeEventListener');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('StudioRecorder com lifecycle React real',()=>{
  it('StrictMode prepara, grava e recupera leitura após replay sem controller fechado nem listener vazando',async()=>{
    const stream=new Stream();permissions.mockResolvedValue(stream);
    mocks.inspect.mockRejectedValueOnce(new Error('Leitura temporária indisponível.')).mockResolvedValueOnce({duration:1,hasAudio:true});
    await mount();expect(permissions).not.toHaveBeenCalled();expect(visibilityListeners()).toBe(2);
    expect(added.mock.calls.filter(([event])=>event==='visibilitychange')).toHaveLength(4);
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
    await mount();await click('Ativar microfone');await mount('camera');expect(visibilityListeners()).toBe(2);
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
  it('cancelar o diálogo conserva o REC e bloqueia STOP e salvamento até responder, sem confirmação nativa',async()=>{
    const stream=new Stream();permissions.mockResolvedValue(stream);const native=vi.spyOn(window,'confirm');
    await mount();await click('Ativar microfone');await click('Iniciar gravação');await click('Fechar gravação');
    const dialog=document.querySelector('[role="alertdialog"]')!;expect(dialog.textContent).toContain('Descartar esta gravação?');
    expect(document.activeElement?.textContent).toBe('Continuar gravando');
    await click('Encerrar gravação');expect(Recorder.instances[0].state).toBe('recording');expect(stream.tracks[0].stop).not.toHaveBeenCalled();
    await answer('Continuar gravando');expect(onClose).not.toHaveBeenCalled();expect(Recorder.instances[0].state).toBe('recording');
    await click('Encerrar gravação');await click('Usar gravação');expect(onRecorded).toHaveBeenCalledTimes(1);expect(onClose).toHaveBeenCalledTimes(1);expect(native).not.toHaveBeenCalled();
  });
  it('gravar outro só descarta o File depois da aprovação e cancelar permite usar o mesmo original',async()=>{
    permissions.mockImplementation(async()=>new Stream());await mount();await click('Ativar microfone');await click('Iniciar gravação');await click('Encerrar gravação');
    await click('Gravar outro');await click('Usar gravação');expect(onRecorded).not.toHaveBeenCalled();expect(permissions).toHaveBeenCalledTimes(1);
    await answer('Manter gravação');await click('Gravar outro');await answer('Descartar e gravar outro');
    expect(permissions).toHaveBeenCalledTimes(2);expect(host.querySelector('[aria-label="Iniciar gravação"]')).toBeTruthy();expect(onRecorded).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();
    await click('Iniciar gravação');await click('Encerrar gravação');await click('Usar gravação');expect(onRecorded).toHaveBeenCalledTimes(1);expect(Recorder.instances).toHaveLength(2);
  });
  it('resposta antiga depois de mudar o projeto não fecha nem descarta o novo controller',async()=>{
    permissions.mockResolvedValue(new Stream());await mount();await click('Ativar microfone');await click('Iniciar gravação');await click('Encerrar gravação');await click('Fechar gravação');
    const oldAccept=[...document.querySelectorAll('[role="alertdialog"] button')].find(button=>button.textContent==='Descartar gravação') as HTMLButtonElement;
    await mount('audio','other-owner:other-project');expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    await act(async()=>oldAccept.click());expect(onClose).not.toHaveBeenCalled();expect(onRecorded).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Ativar microfone');await click('Ativar microfone');expect(host.querySelector('[aria-label="Iniciar gravação"]')).toBeTruthy();
  });
  it('ocultar a aba cancela a pergunta; o trecho interrompido continua disponível para salvar',async()=>{
    permissions.mockResolvedValue(new Stream());await mount();await click('Ativar microfone');await click('Iniciar gravação');await click('Fechar gravação');
    await act(async()=>{Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});document.dispatchEvent(new Event('visibilitychange'));});
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();expect(onClose).not.toHaveBeenCalled();
    Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});await click('Usar gravação');expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it('aprovar descarte durante REC encerra somente a captura autorizada e não salva um File',async()=>{
    const stream=new Stream();permissions.mockResolvedValue(stream);await mount();await click('Ativar microfone');await click('Iniciar gravação');await click('Fechar gravação');
    expect(stream.tracks[0].stop).not.toHaveBeenCalled();await answer('Descartar gravação');
    expect(stream.tracks[0].stop).toHaveBeenCalledTimes(1);expect(onClose).toHaveBeenCalledTimes(1);expect(onRecorded).not.toHaveBeenCalled();expect(host.textContent).toContain('Ativar microfone');
  });

  it('depois de descartar para gravar outro, Fechar cancela a nova permissão pendente sem esperar a entrada tardia',async()=>{
    const waiting=deferred<Stream>();permissions.mockResolvedValueOnce(new Stream()).mockReturnValueOnce(waiting.promise);
    await mount();await click('Ativar microfone');await click('Iniciar gravação');await click('Encerrar gravação');await click('Gravar outro');await answer('Descartar e gravar outro');
    expect(host.textContent).toContain('Aguardando sua permissão');await click('Fechar gravação');expect(onClose).toHaveBeenCalledTimes(1);
    const late=new Stream();await act(async()=>waiting.resolve(late));expect(late.tracks[0].stop).toHaveBeenCalledTimes(1);expect(onRecorded).not.toHaveBeenCalled();expect(host.querySelector('[role="alert"]')).toBeNull();
  });

});
