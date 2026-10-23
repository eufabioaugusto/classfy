import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {randomUUID} from 'expo-crypto';
import {NativeModules} from 'react-native';
import type {Room,LocalVideoTrack,RemoteParticipant} from 'livekit-client';
import type {MediaStream} from '@livekit/react-native-webrtc';
import {withLiveDeadline} from '@/features/live/request';
import {configureStudioNativeCameraAsync,getStudioNativeCameraCapabilitiesAsync,getMediaInfoAsync,setStudioNativeCameraProSettingsAsync,setStudioNativeCameraZoomAsync,
  startStudioRemoteCameraRecordingAsync,stopStudioNativeCameraRecordingAsync,startStudioRemoteCameraPreviewAsync,stopStudioRemoteCameraPreviewAsync,
  setStudioNativeCameraFocusAsync,setStudioNativeCameraEffectAsync,isStudioNativeCameraEffectsAvailable,isStudioCompositionAvailable,
  setStudioNativeAudioInputAsync,isStudioNativeAudioInputSelectionAvailable,
  type StudioCameraProSettings,type StudioCameraState} from '../../../modules/classfy-studio-media';
import {createRemoteCameraController,REMOTE_CAMERA_LIVE_CONTROL_TOPIC,REMOTE_CAMERA_LIVE_ACK_TOPIC,remoteCameraLiveId,validRemoteCameraLivePatch,type RemoteCameraNative} from './remoteCameraController';
import {remoteCameraRequest,remoteCameraDiscoveryRequest,createRemoteUploadFetch,type RemoteCameraScope,assertRemoteCameraScope} from './remoteCameraApi';
import {readRemoteCameraJournal,mutateRemoteCameraJournal,remoteMasterUri,type RemoteTakeJournal} from './remoteCameraJournal';
import {createStudioProject,getStudioProject,loadStudioProjects,mutateStudioProject} from './store';
import {persistStudioTake} from './media';
import {studioGrade,validateStudioGrade,type StudioGrade} from './model';
import {prepareRemoteCameraGradedMaster} from './remoteCameraGrade';
import {decodeBase64Bytes} from './uploadTransport';
import {uploadRemoteCameraOriginal} from './remoteCameraUpload';
import type {StudioRemoteAudioInputState,StudioRemoteConfiguration,StudioRemoteDeviceState,StudioRemoteSession} from './remoteCameraProtocol';

const resolutions={ '720p':'720p','1080p':'1080p','2k':'1440p','4k':'2160p'} as const;
let remoteSDK:{client:typeof import('livekit-client');rtc:typeof import('@livekit/react-native-webrtc');native:typeof import('@livekit/react-native')}|null=null;
function sdk(){return remoteSDK ||= {client:require('livekit-client'),rtc:require('@livekit/react-native-webrtc'),native:require('@livekit/react-native')};}
export function restoreStudioRemoteAudioPolicy(){remoteSDK?.native.setupIOSAudioManagement();}
const resolution=(quality:string)=>quality==='2160p'?'4k':quality==='1440p'?'2k':quality;
export const remoteDeviceState=(state:StudioCameraState,configuration?:StudioRemoteConfiguration):StudioRemoteDeviceState=>({
  ...(configuration?{configuration}:{}),width:state.width,height:state.height,fps:state.fps||0,recording:state.isRecording,
  generation:state.generation,supportsFocus:state.supportsFocus,supportsFocusLock:state.supportsFocusLock,focusLocked:state.focusLocked,
  ...(state.imageGrade?{imageGrade:state.imageGrade}:{}),imageGradeConfirmed:state.imageGradeConfirmed,remoteGradeConfirmed:state.remoteGradeConfirmed,
  ...(state.audioInput?{audioInput:state.audioInput}:{}),supportsAudioInputSelection:state.supportsAudioInputSelection===true&&isStudioNativeAudioInputSelectionAvailable(),
  pro:{...state.pro,supportsFocusPoint:state.supportsFocus===true,supportsFocusLock:state.supportsFocusLock===true,supportsZoom:Number.isFinite(state.minZoom)&&Number.isFinite(state.maxZoom)&&state.maxZoom>state.minZoom,
    minZoom:state.minZoom,maxZoom:state.maxZoom,zoom:state.zoom},
  capabilities:{resolutions:state.qualities.map(value=>resolution(value.quality)),frameRates:state.qualities.find(value=>value.quality===state.quality)?.fps||[],
    audioInputSelection:state.supportsAudioInputSelection===true&&isStudioNativeAudioInputSelectionAvailable(),supportsImageGrade:state.supportsImageGrade!==false&&isStudioNativeCameraEffectsAvailable()&&isStudioCompositionAvailable(),supportsFocus:state.supportsFocus,supportsFocusLock:state.supportsFocusLock,
    qualityProfiles:state.qualities.map(value=>({resolution:resolution(value.quality),fps:value.fps,width:value.width,height:value.height})),supportsExposure:state.supportsExposure},
});
export async function remoteCameraDeviceId(owner:string){const key=`classfy:remote-camera:device:${owner}`;let id=await AsyncStorage.getItem(key);if(!id){id=randomUUID();await AsyncStorage.setItem(key,id);}return id;}
export type RemoteNativeEvent={phase:string;operationId:string;startedAtEpochMs?:number;recoveryUri?:string;error?:string};
export function createRemoteNativePort(owner:string,session:StudioRemoteSession,getTag:()=>number|null,scope:RemoteCameraScope,getAudio?:()=>Record<string,unknown>) {
  type PreviewLease={epoch:number;room:Room|null;stream:MediaStream|null;track:LocalVideoTrack|null;tag:number|null;
    nativeStarted:boolean;ready:boolean;removeListener:(()=>void)|null;cleanup:Promise<void>|null};
  let previewLease:PreviewLease|null=null,previewEpoch=0;
  let previewWork:{epoch:number;promise:Promise<void>}|null=null,disconnectWork:Promise<void>|null=null;
  const waiting=new Map<string,{resolve:(time:number)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;recovery?:string}>();
  let configuration=session.configuration;
  let configurationConfirmed=false,confirmedGrade:StudioGrade=studioGrade('natural'),confirmedGeneration:number|undefined;
  let configuring=false,focusing=false,nativeReady=false;
  let selectingAudio=false,audioSelectionSupported=false,lastAudio:StudioRemoteAudioInputState|undefined;
  let liveHandler:Parameters<NonNullable<RemoteCameraNative['setLiveConfigurationHandler']>>[0]=null;
  const gradeState=(state:StudioCameraState)=>{
    const room=previewLease?.room;
    lastAudio=state.audioInput;audioSelectionSupported=state.supportsAudioInputSelection===true&&isStudioNativeAudioInputSelectionAvailable();
    nativeReady=configurationConfirmed&&!configuring&&!focusing&&!selectingAudio&&state.proConfirmed!==false&&
      (confirmedGeneration===undefined||state.generation===confirmedGeneration)&&state.imageGradeConfirmed!==false&&(!room||state.remoteGradeConfirmed!==false);
    const actual=remoteDeviceState(state,nativeReady?configuration:undefined);
    return {...actual,capabilities:{...actual.capabilities,...(liveHandler&&previewLease?.ready&&room?.state==='connected'&&previewLease.removeListener?{liveControls:1}:{})},
      imageGrade:state.imageGrade||confirmedGrade,imageGradeConfirmed:nativeReady,configurationConfirmed:nativeReady};
  };
  async function applyGrade(target:number,requested:StudioGrade){
    if(validateStudioGrade(requested).length)throw new Error('Escolha um tratamento de imagem válido.');
    if(!isStudioNativeCameraEffectsAvailable()||!isStudioCompositionAvailable()){
      if(JSON.stringify(requested)!==JSON.stringify(studioGrade('natural')))throw new Error('Atualize o app para gravar com tratamento de imagem.');
      confirmedGrade=requested;return;
    }
    const ack=await setStudioNativeCameraEffectAsync(target,JSON.stringify(requested));check();
    if(!ack.previewProcessed)throw new Error('A câmera não confirmou a imagem tratada. Aguarde a prévia antes de gravar.');
    confirmedGrade=ack.grade;
  }
  const check=()=>assertRemoteCameraScope(scope);
  // Only the lease that created a native preview may release its resources.
  // A new preview waits for this cleanup, including a pending native start.
  const releasePreview=(owned:PreviewLease):Promise<void>=>{
    if(owned.cleanup)return owned.cleanup;
    owned.ready=false;owned.removeListener?.();owned.removeListener=null;
    owned.cleanup=(async()=>{
      const room=owned.room;owned.room=null;await room?.disconnect().catch(()=>undefined);
      if(owned.nativeStarted&&owned.tag!==null)await stopStudioRemoteCameraPreviewAsync(owned.tag).catch(()=>undefined);
      owned.nativeStarted=false;owned.stream?.release();owned.stream=null;owned.track=null;
    })();return owned.cleanup;
  };
  const tag=()=>{check();const value=getTag();if(!value)throw new Error('Aguarde a câmera preparar a imagem.');return value;};
  function requireAudioInput(state:StudioCameraState,inputId:string|null){
    const audio=state.audioInput;
    if(!audio?.confirmed||audio.selecting||!audio.current||audio.preferredId!==inputId||inputId!==null&&audio.current.id!==inputId)
      throw new Error(audio?.warning||'O iPhone não confirmou o microfone escolhido.');
  }
  function rememberFocus(state:StudioCameraState){
    // Custom ISO/shutter is manual even though AVFoundation's .locked flag is
    // false. Prefer the confirmed Pro mode so a focus tap cannot save Auto and
    // erase the manual exposure before another adjustment or reconnection.
    const autoExposure=typeof state.pro?.autoExposure==='boolean'?state.pro.autoExposure:!state.exposureLocked;
    const pro:Record<string,unknown>={...configuration.pro,autoFocus:!state.focusLocked,autoExposure};
    delete pro.lensPosition;delete pro.iso;delete pro.shutterSeconds;
    if(state.focusLocked&&typeof state.pro?.lensPosition==='number')pro.lensPosition=state.pro.lensPosition;
    if(!autoExposure){pro.iso=state.pro?.iso;pro.shutterSeconds=state.pro?.shutterSeconds;}
    configuration={...configuration,pro};
  }
  function confirmedPro(requested:StudioRemoteConfiguration['pro'],state:StudioCameraState){
    if(!requested)return undefined;
    const {focusPoint:_point,...pro}=requested,actual=state.pro;
    const finite=(key:string)=>typeof actual?.[key as keyof StudioCameraProSettings]==='number'&&Number.isFinite(actual[key as keyof StudioCameraProSettings]);
    const copy=(keys:string[])=>{for(const key of keys)if(finite(key))pro[key]=actual![key as keyof StudioCameraProSettings];};
    if(['autoExposure','iso','shutterSeconds'].some(key=>key in pro)){
      const automatic=typeof actual?.autoExposure==='boolean'?actual.autoExposure:!state.exposureLocked;
      pro.autoExposure=automatic;delete pro.iso;delete pro.shutterSeconds;
      if(!automatic)copy(['iso','shutterSeconds']);
    }
    if(['autoWhiteBalance','redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'].some(key=>key in pro)){
      if(typeof actual?.autoWhiteBalance==='boolean')pro.autoWhiteBalance=actual.autoWhiteBalance;
      if(pro.autoWhiteBalance===true)for(const key of ['redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'])delete pro[key];
      else if('temperatureKelvin' in pro||'whiteBalanceTint' in pro)copy(['temperatureKelvin','whiteBalanceTint']);
      else copy(['redGain','greenGain','blueGain']);
    }
    if('autoFocus' in pro||'lensPosition' in pro){
      pro.autoFocus=typeof actual?.autoFocus==='boolean'?actual.autoFocus:!state.focusLocked;
      delete pro.lensPosition;if(pro.autoFocus===false)copy(['lensPosition']);
    }
    if('zoom' in pro&&Number.isFinite(state.zoom))pro.zoom=state.zoom;
    return pro;
  }
  const port:RemoteCameraNative={
    setLiveConfigurationHandler(handler){liveHandler=handler;},
    async configure(next){const target=tag();
      if(configuring||focusing||selectingAudio)throw new Error('Aguarde o iPhone confirmar os ajustes da câmera.');
      const previous=configuration,wasConfirmed=configurationConfirmed;
      configuring=true;configurationConfirmed=false;nativeReady=false;
      try {
        const caps=await getStudioNativeCameraCapabilitiesAsync(target);check();
        const quality=resolutions[next.resolution];
        if(!quality||!caps.qualities.some(value=>value.quality===quality&&value.fps.includes(next.fps)))throw new Error('Esta câmera não oferece a resolução/FPS escolhidos. Selecione uma combinação disponível.');
        const reconfigure=!wasConfirmed||confirmedGeneration!==undefined&&caps.generation!==confirmedGeneration||
          previous.cameraFacing!==next.cameraFacing||previous.resolution!==next.resolution||previous.fps!==next.fps;
        const {zoom,focusPoint,...physical}=next.pro||{};
        const temperatureKeys=['temperatureKelvin','whiteBalanceTint'],gainKeys=['redGain','greenGain','blueGain'];
        const changed=(keys:string[])=>keys.some(key=>key in physical&&!Object.is(physical[key],previous.pro?.[key]));
        // A controller patch can inherit the previous WB representation.
        // AVFoundation accepts either Kelvin/tint or RGB, so retain the new one.
        if(changed(temperatureKeys)&&!changed(gainKeys))for(const key of gainKeys)delete physical[key];
        else if(changed(gainKeys)&&!changed(temperatureKeys))for(const key of temperatureKeys)delete physical[key];
        const point=focusPoint as {x:number;y:number;locked:boolean}|undefined,requestedGrade=next.imageGrade||studioGrade('natural');
        if(zoom!==undefined&&(typeof zoom!=='number'||!Number.isFinite(zoom)))throw new Error('Escolha um zoom válido.');
        if(focusPoint!==undefined&&(!point||![point.x,point.y].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)||typeof point.locked!=='boolean'))throw new Error('Toque dentro da imagem para focar.');
        if(validateStudioGrade(requestedGrade).length)throw new Error('Escolha um tratamento de imagem válido.');
        const changedPhysical=reconfigure?physical:Object.fromEntries(Object.entries(physical).filter(([key,value])=>!Object.is(value,previous.pro?.[key])));
        let confirmed=caps;
        // Capture configuration rebuilds AVFoundation outputs and its processed
        // preview. Sliders must keep that graph alive and use only their setter.
        if(reconfigure){confirmed=await configureStudioNativeCameraAsync(target,{position:next.cameraFacing,quality,fps:next.fps,orientation:session.kind==='short'?'portrait':'landscapeRight',cinematic:false,mirrored:false});check();}
        if(Object.keys(changedPhysical).length){confirmed=await setStudioNativeCameraProSettingsAsync(target,changedPhysical as StudioCameraProSettings);check();}
        if(zoom!==undefined&&(reconfigure||!Object.is(zoom,previous.pro?.zoom))){confirmed=await setStudioNativeCameraZoomAsync(target,zoom as number);check();}
        if(point!==undefined){
          confirmed=await setStudioNativeCameraFocusAsync(target,{...point,imageCoordinates:true});check();
        }
        if(reconfigure||JSON.stringify(requestedGrade)!==JSON.stringify(confirmedGrade))await applyGrade(target,requestedGrade);
        if(next.audioInputId!==undefined&&(reconfigure||next.audioInputId!==previous.audioInputId)){
          if(!isStudioNativeAudioInputSelectionAvailable())throw new Error('Atualize o app Classfy para escolher o microfone do iPhone.');
          confirmed=await setStudioNativeAudioInputAsync(target,next.audioInputId);check();gradeState(confirmed);
          requireAudioInput(confirmed,next.audioInputId);
        }
        confirmed=await getStudioNativeCameraCapabilitiesAsync(target);check();
        if(confirmed.proConfirmed===false)throw new Error('Confirme os ajustes físicos antes de gravar.');
        if(confirmed.imageGradeConfirmed===false||previewLease?.room&&confirmed.remoteGradeConfirmed===false)throw new Error('Aguarde a câmera confirmar o tratamento na prévia antes de gravar.');
        if(next.audioInputId!==undefined)requireAudioInput(confirmed,next.audioInputId);
        configuration={...next,imageGrade:confirmedGrade,...(next.pro?{pro:confirmedPro({...physical,...(zoom!==undefined?{zoom}:{})},confirmed)}:{})};if(point!==undefined)rememberFocus(confirmed);
        confirmedGeneration=confirmed.generation;configurationConfirmed=true;configuring=false;return gradeState(confirmed);
      }catch(cause){configurationConfirmed=false;nativeReady=false;throw cause;}finally{configuring=false;}},
    async snapshot(){const state=await getStudioNativeCameraCapabilitiesAsync(tag());check();return {...gradeState(state),previewConnection:previewLease?.ready?previewLease.room?.state||'disconnected':'disconnected',...(getAudio?{audioMonitor:getAudio()}:{} )};},
    async selectAudioInput(inputId){const target=tag();
      if(!isStudioNativeAudioInputSelectionAvailable())throw new Error('Atualize o app Classfy para escolher o microfone do iPhone.');
      if(inputId!==null&&(typeof inputId!=='string'||!inputId.trim()||inputId.length>256))throw new Error('Escolha uma entrada de áudio disponível no iPhone.');
      if(selectingAudio||configuring||focusing)throw new Error('Aguarde o iPhone confirmar o microfone.');
      selectingAudio=true;
      try{
        const confirmed=await setStudioNativeAudioInputAsync(target,inputId);check();gradeState(confirmed);
        requireAudioInput(confirmed,inputId);
        configuration={...configuration,audioInputId:inputId};selectingAudio=false;return gradeState(confirmed);
      }finally{selectingAudio=false;}
    },
    async focus(point){const target=tag();
      if(![point.x,point.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1)||typeof point.locked!=='boolean')throw new Error('Toque dentro da imagem para focar.');
      if(configuring||focusing||selectingAudio)throw new Error('Aguarde o iPhone confirmar os ajustes da câmera.');
      focusing=true;
      try{const focused=await setStudioNativeCameraFocusAsync(target,point);check();rememberFocus(focused);focusing=false;return gradeState(focused);}
      catch(cause){configurationConfirmed=false;nativeReady=false;throw cause;}finally{focusing=false;}},
    begin(takeId){const target=tag();
      if(selectingAudio||audioSelectionSupported&&(!lastAudio?.confirmed||lastAudio.selecting||!lastAudio.current))throw new Error(lastAudio?.warning||'Confirme o microfone antes de gravar.');
      if(!configurationConfirmed||configuring||focusing||!nativeReady)throw new Error('Reconfirme os ajustes da câmera antes de iniciar o take.');
      const started=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(takeId);reject(new Error('A câmera não confirmou o início do take.'));void stopStudioNativeCameraRecordingAsync(target,takeId).catch(()=>undefined);},12000);waiting.set(takeId,{resolve,reject,timer});});
      void started.catch(()=>undefined);
      const finished=startStudioRemoteCameraRecordingAsync(target,takeId,owner,session.id).then(value=>({uri:value.uri}),async cause=>{
        const pending=waiting.get(takeId);if(pending?.recovery)return {uri:pending.recovery};throw cause;
      }).finally(()=>{const pending=waiting.get(takeId);if(pending){clearTimeout(pending.timer);pending.reject(new Error('O take terminou antes de confirmar o início.'));waiting.delete(takeId);}});
      return {started,finished};},
    async stop(takeId){const target=getTag();if(target)await stopStudioNativeCameraRecordingAsync(target,takeId);},
    async preview(connection){
      check();if(previewWork?.epoch===previewEpoch)return previewWork.promise;
      if(previewLease?.ready&&previewLease.room?.state==='connected')return;
      if(previewLease)void port.disconnect();
      const epoch=previewEpoch,previousDisconnect=disconnectWork;
      const owned:PreviewLease={epoch,room:null,stream:null,track:null,tag:null,nativeStarted:false,ready:false,removeListener:null,cleanup:null};
      const checkOwned=()=>{check();if(previewEpoch!==epoch||previewLease!==owned)throw new Error('A prévia privada foi desconectada.');};
      let work!:Promise<void>;
      work=(async()=>{
      await previousDisconnect;check();if(previewEpoch!==epoch)throw new Error('A prévia privada foi desconectada.');previewLease=owned;
      try{
      const runtime=sdk();runtime.native.registerGlobals({autoConfigureAudioSession:false});runtime.client.setLogLevel(runtime.client.LogLevel.silent);
      // Explicit exclusive camera route. No audio track/session is acquired.
      NativeModules.WebRTCModule?.audioDeviceModuleSetAutomaticAudioSessionConfiguration?.(null);
      const target=tag();owned.tag=target;owned.nativeStarted=true;const descriptor=await startStudioRemoteCameraPreviewAsync(target);checkOwned();
      const ownedStream=new runtime.rtc.MediaStream(descriptor);owned.stream=ownedStream;const media=ownedStream.getVideoTracks()[0];if(!media)throw new Error('A câmera não forneceu a pista de prévia.');
      const track=new runtime.client.LocalVideoTrack(media as unknown as globalThis.MediaStreamTrack,{},true);owned.track=track;
      const room=new runtime.client.Room({adaptiveStream:false,dynacast:true,stopLocalTrackOnUnpublish:false});owned.room=room;
      const expectedController=`studio-controller-${session.id}-${session.controllerId}`;
      if(runtime.client.RoomEvent?.DataReceived&&typeof room.on==='function'&&typeof room.off==='function'&&typeof room.localParticipant.publishData==='function'){
        const received=(payload:Uint8Array,participant?:RemoteParticipant,_kind?:unknown,topic?:string,_encryptionType?:unknown,participantIdentity?:string)=>{
          // LiveKit supplies the authenticated packet identity even before its
          // RemoteParticipant exists. Neither sender value comes from the JSON.
          if(participant?.identity!==undefined&&participantIdentity!==undefined&&participant.identity!==participantIdentity)return;
          const sender=participant?.identity??participantIdentity;
          if(topic!==REMOTE_CAMERA_LIVE_CONTROL_TOPIC||sender!==expectedController||!liveHandler||previewLease!==owned||!owned.ready||room.state!=='connected'||payload.byteLength>8192)return;
          let value:{v?:unknown;id?:unknown;patch?:unknown};
          try{check();value=JSON.parse(new TextDecoder().decode(payload));}catch{return;}
          if(!value||typeof value!=='object'||Array.isArray(value)||value.v!==1||!remoteCameraLiveId(value.id)||!validRemoteCameraLivePatch(value.patch)||Object.keys(value).some(key=>!['v','id','patch'].includes(key)))return;
          const id=value.id,patch=value.patch,handler=liveHandler;
          void (async()=>{
            let ack:Record<string,unknown>;
            try{const state=await handler(id,patch);check();ack={v:1,id,ok:true,state};}
            catch(cause){ack={v:1,id,ok:false,error:(cause instanceof Error?cause.message:'O iPhone não confirmou esse ajuste.').replace(/(?:https?|wss?|file):\/\/\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gi,'[dado privado omitido]').slice(0,500)};}
            try{checkOwned();if(!owned.ready||room.state!=='connected'||liveHandler!==handler)return;
              await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(ack)),{reliable:true,topic:REMOTE_CAMERA_LIVE_ACK_TOPIC,destinationIdentities:[expectedController]});
            }catch{/* Durable delivery remains the fallback when RTC closes. */}
          })();
        };
        room.on(runtime.client.RoomEvent.DataReceived,received);
        owned.removeListener=()=>room.off(runtime.client.RoomEvent.DataReceived,received);
      }
        if(new URL(connection.url).protocol!=='wss:')throw new Error('A prévia precisa de uma conexão privada segura.');
        await withLiveDeadline(()=>room.connect(connection.url,connection.token,{autoSubscribe:false}),scope.signal,30_000);checkOwned();
        await room.localParticipant.publishTrack(track,{source:runtime.client.Track.Source.Camera,videoCodec:'h264',simulcast:false,
          // This is a 1080p display proxy; the 4K master stays in MovieFileOutput.
          // Congestion control can reduce resolution rather than queue old frames.
          videoEncoding:{maxBitrate:6_000_000,maxFramerate:30,priority:'high'},
          degradationPreference:'maintain-framerate',stopMicTrackOnMute:false});checkOwned();
        await applyGrade(target,confirmedGrade);checkOwned();
        if(room.state!=='connected')throw new Error('A prévia privada perdeu a conexão.');
        owned.ready=true;
      }catch {if(previewLease===owned)previewLease=null;await releasePreview(owned);throw new Error('Não foi possível conectar a prévia privada. O original permanece no iPhone.');}
      })().finally(()=>{if(previewWork?.promise===work)previewWork=null;});
      previewWork={epoch,promise:work};return work;
    },
    async disconnect(){
      previewEpoch++;
      if(disconnectWork)return disconnectWork;
      const owned=previewLease,pending=previewWork?.promise;previewLease=null;
      owned?.removeListener?.();if(owned){owned.removeListener=null;owned.ready=false;}
      let work!:Promise<void>;
      work=(async()=>{await pending?.catch(()=>undefined);if(owned)await releasePreview(owned);})()
        .finally(()=>{if(disconnectWork===work)disconnectWork=null;});
      // Restore the installed default only after this video-only room is gone.
      disconnectWork=work;return work;
    },
  };
  return {port,onRecordingState(event:RemoteNativeEvent){const value=waiting.get(event.operationId);if(!value)return;
    if(event.recoveryUri)value.recovery=event.recoveryUri;
    if(Number.isFinite(event.startedAtEpochMs)){clearTimeout(value.timer);value.resolve(event.startedAtEpochMs!);}
  }};
}
export function createRemoteCameraRuntime(owner:string,deviceId:string,scope:RemoteCameraScope){
  const check=()=>assertRemoteCameraScope(scope),request=(action:string,body:Record<string,unknown>)=>remoteCameraRequest(owner,action,body,scope);
  const mutate=(sessionId:string,change:Parameters<typeof mutateRemoteCameraJournal>[3])=>mutateRemoteCameraJournal(owner,sessionId,deviceId,change);
  async function inspect(uri:string){const info=await getMediaInfoAsync(uri);
    if(!info.hasVideo||!info.hasAudio||!Number.isFinite(info.duration)||info.duration<=0||!info.fileSize||!info.width||!info.height||!info.frameRate)throw new Error('O original ainda não é um vídeo completo com áudio. Ele permanece no iPhone para recuperação.');
    return {bytes:info.fileSize,mime:'video/quicktime',width:info.width,height:info.height,fps:info.frameRate,duration:info.duration};}
  const upload=(session:StudioRemoteSession,take:RemoteTakeJournal,onProgress?:(bytes:number)=>void)=>uploadRemoteCameraOriginal({
    sessionId:session.id,deviceId,take,request,fetch:createRemoteUploadFetch(scope),check,
    onProgress,
    journal:()=>readRemoteCameraJournal(owner,session.id,deviceId),
    mutate:change=>mutate(session.id,change),
    read:async(position,length)=>decodeBase64Bytes(await FileSystem.readAsStringAsync(take.uri,{encoding:FileSystem.EncodingType.Base64,position,length})),
  });
  return createRemoteCameraController({owner,deviceId,current:()=>scope.isCurrent?.()!==false&&!scope.signal?.aborted,request,
    discover:controllerId=>remoteCameraDiscoveryRequest(owner,{deviceId,...(controllerId?{controllerId}:{})},scope),
    journal:id=>readRemoteCameraJournal(owner,id,deviceId),mutate,masterUri:(session,take)=>remoteMasterUri(owner,session,take),inspect,upload,
    async prepareMaster(session,take,onProgress){check();return prepareRemoteCameraGradedMaster({owner,sessionId:session.id,takeId:take.id,sourceUri:take.sourceUri||take.uri,imageGrade:take.imageGrade||studioGrade('natural'),shouldContinue:()=>scope.isCurrent?.()!==false&&!scope.signal?.aborted,onProgress});},
    async saveLocal(session,take){check();await loadStudioProjects(owner);let journal=await readRemoteCameraJournal(owner,session.id,deviceId);
      let project=journal.projectId?getStudioProject(owner,journal.projectId):undefined;
      if(!project){project=await createStudioProject(owner,session.kind,{transient:true,isCurrent:scope.isCurrent});const id=project.id;await mutate(session.id,value=>({...value,projectId:id}));}
      const local=await persistStudioTake(project,{id:take.id,uri:take.uri,name:`${session.title||'Take do computador'}.mov`});check();
      await mutateStudioProject(owner,project.id,value=>{check();return {takes:value.takes.some(item=>item.id===local.id)?value.takes:[...value.takes,local],...(!value.coverUri&&!value.coverUrl&&local.thumbnailUri?{coverUri:local.thumbnailUri}:{})};});
      return {projectId:project.id,localTakeId:local.id};},
  });
}
