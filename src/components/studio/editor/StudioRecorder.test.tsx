import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioRecorder } from './StudioRecorder';

const mocks=vi.hoisted(()=>({inspect:vi.fn(),processor:vi.fn()}));
vi.mock('@/lib/studio/editor/media',()=>({inspectStudioMedia:mocks.inspect}));
vi.mock('@/lib/studio/editor/captureVideo',async original=>({...await original<object>(),createStudioCaptureVideoProcessor:mocks.processor}));

function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}
class Track {
  id='microphone';kind='audio';label='USB Microphone';readyState='live';onended:null|(()=>void)=null;onmute=null;
  stop=vi.fn(()=>{this.readyState='ended';});getSettings(){return{deviceId:'usb-id'};}
}
class CameraTrack extends Track {
  kind='video';id='camera';label='Câmera 4K';
  settings={deviceId:'camera',width:1920,height:1080,frameRate:30,iso:400,exposureMode:'manual'};
  getSettings(){return{...this.settings};}
  getCapabilities(){return{width:{min:1280,max:3840},height:{min:720,max:2160},frameRate:{min:24,max:60},iso:{min:100,max:1600,step:100},exposureMode:['continuous','manual']};}
  getConstraints(){return{};}
  applyConstraints=vi.fn(async(constraints:Record<string,any>)=>{for(const key of ['width','height','frameRate'] as const)if(constraints[key]?.exact)this.settings[key]=constraints[key].exact;for(const patch of constraints.advanced??[])Object.assign(this.settings,patch);});
}
class Stream {
  constructor(public tracks:Track[]=[new Track()]){}getTracks(){return this.tracks;}getAudioTracks(){return this.tracks.filter(value=>value.kind==='audio');}getVideoTracks(){return this.tracks.filter(value=>value.kind==='video');}
}
class Recorder {
  static instances:Recorder[]=[];static isTypeSupported(){return true;}
  state='inactive';mimeType='audio/mp4';ondataavailable:null|((e:{data:Blob})=>void)=null;onstop:null|(()=>void)=null;onerror=null;
  constructor(_stream?:Stream,options?:{mimeType:string}){this.mimeType=options?.mimeType??'audio/mp4';Recorder.instances.push(this);}start(){this.state='recording';}
  stop=vi.fn(()=>{this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['actual-recorded-bytes'],{type:this.mimeType})});this.onstop?.();});});
}
class Audio {
  resume=vi.fn(async()=>{});close=vi.fn(async()=>{});createMediaStreamSource(){return{connect:vi.fn()};}
  createMediaStreamDestination(){return{stream:new Stream(),connect:vi.fn()};}
  createAnalyser(){return{fftSize:2048,getFloatTimeDomainData(samples:Float32Array){samples.fill(.5);}};}
}
let root:Root,host:HTMLDivElement;
const permissions=vi.fn(),display=vi.fn(),onClose=vi.fn(),onRecorded=vi.fn();
let added:ReturnType<typeof vi.spyOn>,removed:ReturnType<typeof vi.spyOn>;
const visibilityListeners=()=>{
  const active=new Set(added.mock.calls.filter(([event])=>event==='visibilitychange').map(([,listener])=>listener));
  removed.mock.calls.filter(([event])=>event==='visibilitychange').forEach(([,listener])=>active.delete(listener));return active.size;
};
async function mount(mode:'audio'|'camera'|'screen'='audio',scopeKey='owner:project',aspectRatio:'16:9'|'9:16'='16:9'){await act(async()=>root.render(<StrictMode><StudioRecorder mode={mode} scopeKey={scopeKey} aspectRatio={aspectRatio} onRecorded={onRecorded} onClose={onClose}/></StrictMode>));}
async function answer(label:string){const dialog=document.querySelector('[role="alertdialog"]');expect(dialog).toBeTruthy();const button=[...dialog!.querySelectorAll('button')].find(value=>value.textContent?.trim()===label);expect(button).toBeTruthy();await act(async()=>button!.click());}
async function click(label:string){const button=[...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===label||b.textContent?.trim()===label);expect(button,`Botão ${label}`).toBeTruthy();await act(async()=>button!.click());}

beforeEach(()=>{
  (globalThis as Record<string,unknown>).IS_REACT_ACT_ENVIRONMENT=true;
  Recorder.instances=[];permissions.mockReset();display.mockReset();onClose.mockReset();onRecorded.mockReset().mockResolvedValue(undefined);mocks.inspect.mockReset().mockResolvedValue({duration:1,hasAudio:true});
  mocks.processor.mockReset().mockImplementation((track:CameraTrack,_grade:unknown,_zoom:unknown,_error:unknown,output?:{width:number;height:number;frameRate:number})=>{const owned=new CameraTrack();Object.assign(owned.settings,output??track.getSettings());return{stream:new Stream([owned]),effects:true,profile:{...owned.settings},prepare:vi.fn(async()=>undefined),configure:vi.fn(),setVisible:vi.fn(),dispose:vi.fn(()=>owned.stop())};});
  vi.stubGlobal('MediaRecorder',Recorder);vi.stubGlobal('MediaStream',Stream);vi.stubGlobal('AudioContext',Audio);
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:permissions,getDisplayMedia:display},configurable:true});
  Object.defineProperty(HTMLCanvasElement.prototype,'captureStream',{value:vi.fn(),configurable:true});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue(undefined);
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
  added=vi.spyOn(document,'addEventListener');removed=vi.spyOn(document,'removeEventListener');
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();delete(HTMLCanvasElement.prototype as any).captureStream;vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('StudioRecorder com lifecycle React real',()=>{
  it('modal de câmera alterna resolução/FPS com confirmação e oferece controles físicos sem guias sem efeito',async()=>{
    const camera=new CameraTrack(),mic=new Track();permissions.mockResolvedValue(new Stream([camera,mic]));await mount('camera');await click('Ativar câmera');
    await click('Alterar resolução da gravação: 1080p');await click('Alterar resolução da gravação: 2K');expect(host.textContent).toContain('4K');expect(camera.getSettings()).toMatchObject({width:3840,height:2160});
    await click('Alterar quadros por segundo: 30 fps');expect(camera.getSettings().frameRate).toBe(60);expect(host.querySelector('[aria-label="Alterar quadros por segundo: 60 fps"]')).toBeTruthy();
    await click('Configurações da gravação');expect(host.querySelector('[aria-label="ISO"]')).toBeTruthy();expect(host.querySelector('[aria-label="Modo de leitura"]')).toBeNull();expect(host.textContent).not.toContain('Roteiro');
    await click('Iniciar gravação');expect(host.querySelector('.se-recording-tools')).toBeNull();expect(host.querySelector('.se-recording-quality')).toBeNull();await click('Encerrar gravação');await click('Usar gravação');expect(onRecorded).toHaveBeenCalledTimes(1);expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('modal da tela oferece quatro saídas e conserva a fonte durante a mudança',async()=>{
    const screen=new CameraTrack();screen.label='Slides';display.mockResolvedValue(new Stream([screen]));permissions.mockResolvedValue(new Stream());await mount('screen');await click('Ativar tela e microfone');await click('Configurações da gravação');
    const select=host.querySelector<HTMLSelectElement>('[aria-label="Resolução da gravação"]')!;expect([...select.options].map(value=>value.textContent)).toEqual(['720p','1080p','2K','4K']);
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value')!.set!.call(select,'3840x2160');select.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(host.textContent).toContain('Gravação: 3840 × 2160');expect(host.textContent).toContain('Entrada: 1920 × 1080');expect(screen.applyConstraints).not.toHaveBeenCalled();expect(display).toHaveBeenCalledTimes(1);expect(permissions).toHaveBeenCalledTimes(1);
  });
  it('uma configuração pendente bloqueia REC e novo ajuste, e uma troca de projeto invalida o resultado',async()=>{
    permissions.mockResolvedValue(new Stream([new CameraTrack(),new Track()]));await mount('camera');await click('Ativar câmera');const waiting=deferred<void>();
    const factory=mocks.processor.getMockImplementation()!;mocks.processor.mockImplementationOnce((...args)=>({...factory(...args),prepare:()=>waiting.promise}));
    await click('Alterar resolução da gravação: 1080p');expect(host.querySelector<HTMLButtonElement>('[aria-label="Alterar resolução da gravação: 1080p"]')?.disabled).toBe(true);expect(host.querySelector('[aria-label="Iniciar gravação"]')).toBeNull();
    await mount('camera','owner:another-project');await act(async()=>waiting.resolve());expect(host.querySelector('[role="alert"]')).toBeNull();expect(onRecorded).not.toHaveBeenCalled();expect(onClose).not.toHaveBeenCalled();expect(host.textContent).toContain('Ativar câmera');
  });
  it('modal de Short solicita saídas verticais no seletor de resolução',async()=>{
    permissions.mockResolvedValue(new Stream([new CameraTrack(),new Track()]));await mount('camera','owner:short','9:16');await click('Ativar câmera');await click('Configurações da gravação');await click('Gravação');
    const select=host.querySelector<HTMLSelectElement>('[aria-label="Resolução da gravação"]')!;
    expect([...select.options].filter(option=>['720p','1080p','2K','4K'].includes(option.textContent!)).map(option=>option.value)).toEqual(['720x1280','1080x1920','1440x2560','2160x3840']);
  });
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
