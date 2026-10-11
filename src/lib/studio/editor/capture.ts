import { inspectStudioMedia } from './media';

export type StudioCaptureMode = 'camera' | 'screen' | 'audio';
export type StudioCaptureState = {
  phase:'idle'|'preparing'|'ready'|'recording'|'stopping'|'recorded'|'error';
  stream:MediaStream|null; elapsed:number; file:File|null; error:string|null;
  input:{id:string;name:string}|null; levels:{averageDb:number;peakDb:number}[];
  width?:number;height?:number;frameRate?:number;
};
export type StudioCaptureController = {
  prepare():Promise<void>; start():void; stop():Promise<File>; flip():Promise<void>;
  cancel():void; dispose():void; subscribe(listener:(state:StudioCaptureState)=>void):()=>void;
};
export function studioAudioLevels(channels:readonly Float32Array[]) {
  return channels.map(samples => {
    let sum=0,peak=0; for(const sample of samples) { sum+=sample*sample; peak=Math.max(peak,Math.abs(sample)); }
    const db=(value:number)=>Math.max(-120,20*Math.log10(Math.max(value,1e-6)));
    return {averageDb:db(Math.sqrt(sum/Math.max(1,samples.length))),peakDb:db(peak)};
  });
}
export function studioCaptureMime(mode:StudioCaptureMode):string {
  const candidates=mode==='audio'?['audio/mp4','audio/webm;codecs=opus','audio/webm']:['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'];
  return candidates.find(type=>MediaRecorder.isTypeSupported(type)) ?? '';
}
/** No permission, device or recording work is performed by construction. */
export function createStudioCapture({mode,facing='user',deviceId}:{mode:StudioCaptureMode;facing?:'user'|'environment';deviceId?:string}):StudioCaptureController {
  let state:StudioCaptureState={phase:'idle',stream:null,elapsed:0,file:null,error:null,input:null,levels:[]};
  const streams=new Set<MediaStream>();
  let generation=0,closed=false,context:AudioContext|null=null,analyser:AnalyserNode|null=null,recorder:MediaRecorder|null=null;
  let chunks:Blob[]=[],meterTimer:ReturnType<typeof setInterval>|null=null,started=0,stopPromise:Promise<File>|null=null,recordingGeneration=0,notice:string|null=null;
  let stopReject:((reason:unknown)=>void)|null=null;
  let candidate:File|null=null;
  const listeners=new Set<(state:StudioCaptureState)=>void>();
  const publish=(patch:Partial<StudioCaptureState>)=>{if(closed)return;state={...state,...patch};listeners.forEach(listener=>listener({...state,levels:[...state.levels]}));};
  const assert=(expected:number)=>{if(closed||expected!==generation)throw new DOMException('Captura cancelada.','AbortError');};
  const stopDevices=()=>{
    if(meterTimer)clearInterval(meterTimer);meterTimer=null;analyser=null;
    streams.forEach(stream=>stream.getTracks().forEach(track=>{track.onended=null;track.onmute=null;track.stop();}));streams.clear();
    const owned=context;context=null;void owned?.close().catch(()=>{});publish({stream:null,input:null,levels:[]});
  };
  const own=(stream:MediaStream,expected:number)=>{if(closed||generation!==expected){stream.getTracks().forEach(track=>track.stop());assert(expected);}streams.add(stream);return stream;};
  const interrupt=()=>{
    if(state.phase==='stopping'||state.phase==='recorded')return;
    notice='A entrada foi interrompida. O trecho já capturado foi preservado.';
    if(state.phase==='recording')void controller.stop().catch(()=>{});else{generation++;stopDevices();publish({phase:'idle',error:'A entrada foi desconectada. Ative a captura novamente.'});}
  };
  const prepare=async()=>{
    if(closed)throw new DOMException('Captura encerrada.','AbortError');
    if(['recording','stopping','preparing'].includes(state.phase))throw new Error('Conclua a operação atual antes de abrir outra entrada.');
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('Este navegador não oferece gravação local. Use Chrome, Edge ou Safari atualizado em HTTPS.');
    const expected=++generation;stopDevices();notice=null;stopPromise=null;candidate=null;publish({phase:'preparing',error:null,file:null,elapsed:0});
    try {
      let stream:MediaStream;
      if(mode==='screen'){
        if(!navigator.mediaDevices.getDisplayMedia)throw new Error('A gravação da tela não está disponível neste navegador.');
        const display=own(await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30}},audio:true}),expected);
        const microphone=own(await navigator.mediaDevices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId},echoCancellation:true}:true}),expected);
        context=new AudioContext();await context.resume();assert(expected);
        const destination=context.createMediaStreamDestination();
        for(const input of [display,microphone])if(input.getAudioTracks().length)context.createMediaStreamSource(input).connect(destination);
        stream=own(new MediaStream([...display.getVideoTracks(),...destination.stream.getAudioTracks()]),expected);
        publish({input:inputIdentity(microphone.getAudioTracks()[0],display.getAudioTracks().length>0)});
      }else{
        stream=own(await navigator.mediaDevices.getUserMedia({video:mode==='camera'?{facingMode:{ideal:facing},width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:30}}:false,audio:deviceId?{deviceId:{exact:deviceId},echoCancellation:true}:true}),expected);
        publish({input:inputIdentity(stream.getAudioTracks()[0])});
      }
      assert(expected);const video=stream.getVideoTracks()[0]?.getSettings();
      if(stream.getAudioTracks().length){context??=new AudioContext();await context.resume();assert(expected);analyser=context.createAnalyser();analyser.fftSize=2048;context.createMediaStreamSource(stream).connect(analyser);}
      stream.getTracks().forEach(track=>{track.onended=interrupt;track.onmute=()=>{if(track.readyState==='ended')interrupt();};});
      publish({phase:'ready',stream,width:video?.width,height:video?.height,frameRate:video?.frameRate});
      meterTimer=setInterval(()=>{
        if(closed||expected!==generation)return;
        if(analyser){const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);publish({levels:studioAudioLevels([samples])});}
        if(recorder?.state==='recording')publish({elapsed:(performance.now()-started)/1000});
      },100);
    }catch(error){if(expected===generation&&!closed){stopDevices();publish({phase:'error',error:captureError(error)});}throw error;}
  };
  const controller:StudioCaptureController={
    prepare,
    start(){
      if(closed||state.phase!=='ready'||!state.stream)throw new Error('Ative a entrada antes de gravar.');
      const mime=studioCaptureMime(mode);if(!mime)throw new Error('O navegador não oferece um formato de gravação compatível.');
      chunks=[];stopPromise=null;notice=null;recordingGeneration=generation;
      recorder=new MediaRecorder(state.stream,{mimeType:mime,...(mode!=='audio'?{videoBitsPerSecond:8000000}:{}),audioBitsPerSecond:192000});
      const ownedGeneration=recordingGeneration;
      recorder.ondataavailable=event=>{if(ownedGeneration===generation&&event.data.size)chunks.push(event.data);};
      recorder.onerror=()=>{notice='O gravador encontrou um erro. Tentaremos preservar o trecho disponível.';void controller.stop().catch(()=>{});};
      recorder.start(1000);started=performance.now();publish({phase:'recording',elapsed:0,error:null});
    },
    stop(){
      if(stopPromise)return stopPromise;
      if(candidate&&state.phase==='error'){
        const file=candidate,expected=generation;publish({phase:'stopping',error:null});
        const attempt=(async()=>{try{const metadata=await inspectStudioMedia(file);assert(expected);if(metadata.duration<.1||mode==='audio'&&!metadata.hasAudio)throw new Error('Não foi encontrado um trecho válido de áudio ou vídeo.');publish({phase:'recorded',file,elapsed:metadata.duration,error:notice});return file;}catch(error){if(expected===generation&&!closed)publish({phase:'error',file,error:captureError(error)});throw error;}finally{if(stopPromise===attempt)stopPromise=null;}})();stopPromise=attempt;return attempt;
      }
      if(!recorder||!['recording','paused'].includes(recorder.state))return Promise.reject(new Error('Não existe gravação ativa para concluir.'));
      const owned=recorder,expected=recordingGeneration;publish({phase:'stopping'});
      stopPromise=new Promise<File>((resolve,reject)=>{
        stopReject=reject;
        owned.onstop=()=>{void(async()=>{
          try{
            assert(expected);stopDevices();const type=owned.mimeType||chunks[0]?.type||studioCaptureMime(mode),extension=type.includes('mp4')?mode==='audio'?'m4a':'mp4':'webm';
            const file=new File(chunks,`Classfy-${mode}-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`,{type});chunks=[];
            candidate=file;
            // MediaRecorder clocks are not proof of content. Read actual bytes, including WebM with no duration tag.
            const metadata=await inspectStudioMedia(file);assert(expected);
            if(metadata.duration<.1||mode==='audio'&&!metadata.hasAudio)throw new Error('Não foi encontrado um trecho válido de áudio ou vídeo. Grave por mais tempo e tente novamente.');
            recorder=null;stopReject=null;publish({phase:'recorded',file,elapsed:metadata.duration,error:notice});resolve(file);
          }catch(error){if(expected===generation&&!closed){recorder=null;stopReject=null;stopPromise=null;stopDevices();publish({phase:'error',file:candidate,error:captureError(error)});}reject(error);}
        })();};
        try{owned.stop();}catch(error){reject(error);}
      });return stopPromise;
    },
    async flip(){if(mode!=='camera'||state.phase!=='ready')throw new Error('Troque a câmera antes de iniciar a gravação.');facing=facing==='user'?'environment':'user';await prepare();},
    cancel(){generation++;stopReject?.(new DOMException('Captura cancelada.','AbortError'));stopReject=null;if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;if(recorder.state!=='inactive')try{recorder.stop();}catch{/* The device may already have stopped its recorder. */}}recorder=null;chunks=[];candidate=null;stopPromise=null;stopDevices();publish({phase:'idle',file:null,elapsed:0,error:null});},
    dispose(){if(closed)return;controller.cancel();closed=true;listeners.clear();document.removeEventListener('visibilitychange',visibility);},
    subscribe(listener){listeners.add(listener);listener({...state});return()=>listeners.delete(listener);},
  };
  const visibility=()=>{if(document.visibilityState==='visible')return;if(state.phase==='recording'){notice='A gravação foi encerrada ao sair desta aba. Confira o trecho antes de usar.';void controller.stop().catch(()=>{});}else if(state.phase==='ready'||state.phase==='preparing')controller.cancel();};
  document.addEventListener('visibilitychange',visibility);return controller;
}
function inputIdentity(track?:MediaStreamTrack,screenAudio=false){if(!track)return null;return{id:track.getSettings().deviceId??track.id,name:(track.label||'Entrada de áudio autorizada')+(screenAudio?' + áudio da tela':'')};}
function captureError(error:unknown){const value=error as Error;if(value.name==='NotAllowedError')return'Permita câmera e microfone no navegador para gravar. Se negou, abra as permissões deste site e tente novamente.';if(value.name==='NotFoundError')return'A entrada de câmera ou microfone não foi encontrada.';return value.message||'Não foi possível iniciar a captura.';}
