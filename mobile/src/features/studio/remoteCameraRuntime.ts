import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import {randomUUID} from 'expo-crypto';
import {NativeModules} from 'react-native';
import type {Room,LocalVideoTrack} from 'livekit-client';
import type {MediaStream} from '@livekit/react-native-webrtc';
import {withLiveDeadline} from '@/features/live/request';
import {configureStudioNativeCameraAsync,getStudioNativeCameraCapabilitiesAsync,getMediaInfoAsync,setStudioNativeCameraProSettingsAsync,setStudioNativeCameraZoomAsync,
  startStudioRemoteCameraRecordingAsync,stopStudioNativeCameraRecordingAsync,startStudioRemoteCameraPreviewAsync,stopStudioRemoteCameraPreviewAsync,
  type StudioCameraProSettings,type StudioCameraState} from '../../../modules/classfy-studio-media';
import {createRemoteCameraController,type RemoteCameraNative} from './remoteCameraController';
import {remoteCameraRequest,createRemoteUploadFetch,type RemoteCameraScope,assertRemoteCameraScope} from './remoteCameraApi';
import {readRemoteCameraJournal,mutateRemoteCameraJournal,remoteMasterUri,type RemoteTakeJournal} from './remoteCameraJournal';
import {createStudioProject,getStudioProject,loadStudioProjects,mutateStudioProject} from './store';
import {persistStudioTake} from './media';
import {decodeBase64Bytes} from './uploadTransport';
import {uploadRemoteCameraOriginal} from './remoteCameraUpload';
import type {StudioRemoteConfiguration,StudioRemoteDeviceState,StudioRemoteSession} from './remoteCameraProtocol';

const resolutions={ '720p':'720p','1080p':'1080p','2k':'1440p','4k':'2160p'} as const;
let remoteSDK:{client:typeof import('livekit-client');rtc:typeof import('@livekit/react-native-webrtc');native:typeof import('@livekit/react-native')}|null=null;
function sdk(){return remoteSDK ||= {client:require('livekit-client'),rtc:require('@livekit/react-native-webrtc'),native:require('@livekit/react-native')};}
export function restoreStudioRemoteAudioPolicy(){remoteSDK?.native.setupIOSAudioManagement();}
const resolution=(quality:string)=>quality==='2160p'?'4k':quality==='1440p'?'2k':quality;
export const remoteDeviceState=(state:StudioCameraState,configuration?:StudioRemoteConfiguration):StudioRemoteDeviceState=>({
  ...(configuration?{configuration}:{}),width:state.width,height:state.height,fps:state.fps||0,recording:state.isRecording,
  generation:state.generation,
  pro:{...state.pro,supportsZoom:Number.isFinite(state.minZoom)&&Number.isFinite(state.maxZoom)&&state.maxZoom>state.minZoom,
    minZoom:state.minZoom,maxZoom:state.maxZoom,zoom:state.zoom},
  capabilities:{resolutions:state.qualities.map(value=>resolution(value.quality)),frameRates:state.qualities.find(value=>value.quality===state.quality)?.fps||[],
    qualityProfiles:state.qualities.map(value=>({resolution:resolution(value.quality),fps:value.fps,width:value.width,height:value.height})),supportsExposure:state.supportsExposure},
});
export async function remoteCameraDeviceId(owner:string){const key=`classfy:remote-camera:device:${owner}`;let id=await AsyncStorage.getItem(key);if(!id){id=randomUUID();await AsyncStorage.setItem(key,id);}return id;}
export type RemoteNativeEvent={phase:string;operationId:string;startedAtEpochMs?:number;recoveryUri?:string;error?:string};
export function createRemoteNativePort(owner:string,session:StudioRemoteSession,getTag:()=>number|null,scope:RemoteCameraScope,getAudio?:()=>Record<string,unknown>) {
  let room:Room|null=null,stream:MediaStream|null=null,track:LocalVideoTrack|null=null,previewTag:number|null=null,disposed=false;
  const waiting=new Map<string,{resolve:(time:number)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>;recovery?:string}>();
  let configuration=session.configuration;
  let configurationConfirmed=false;
  const check=()=>{assertRemoteCameraScope(scope);if(disposed)throw new Error('A câmera foi desconectada.');};
  const tag=()=>{check();const value=getTag();if(!value)throw new Error('Aguarde a câmera preparar a imagem.');return value;};
  const port:RemoteCameraNative={
    async configure(next){const target=tag();const caps=await getStudioNativeCameraCapabilitiesAsync(target);check();
      const quality=resolutions[next.resolution];
      if(!quality||!caps.qualities.some(value=>value.quality===quality&&value.fps.includes(next.fps)))throw new Error('Esta câmera não oferece a resolução/FPS escolhidos. Selecione uma combinação disponível.');
      configurationConfirmed=false;
      try {
        let confirmed=await configureStudioNativeCameraAsync(target,{position:next.cameraFacing,quality,fps:next.fps,orientation:session.kind==='short'?'portrait':'landscapeRight',cinematic:false,mirrored:false});check();
        const {zoom,...physical}=next.pro||{};
        if(Object.keys(physical).length){confirmed=await setStudioNativeCameraProSettingsAsync(target,physical as StudioCameraProSettings);check();}
        if(zoom!==undefined){if(typeof zoom!=='number'||!Number.isFinite(zoom))throw new Error('Escolha um zoom válido.');confirmed=await setStudioNativeCameraZoomAsync(target,zoom);check();}
        if(confirmed.proConfirmed===false)throw new Error('Confirme os ajustes físicos antes de gravar.');
        configuration=next;configurationConfirmed=true;return {...remoteDeviceState(confirmed,next),configurationConfirmed:true};
      }catch(cause){configurationConfirmed=false;throw cause;}},
    async snapshot(){return {...remoteDeviceState(await getStudioNativeCameraCapabilitiesAsync(tag()),configurationConfirmed?configuration:undefined),configurationConfirmed,previewConnection:room?.state||'disconnected',...(getAudio?{audioMonitor:getAudio()}:{} )};},
    begin(takeId){const target=tag();
      if(!configurationConfirmed)throw new Error('Reconfirme os ajustes da câmera antes de iniciar o take.');
      const started=new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(takeId);reject(new Error('A câmera não confirmou o início do take.'));void stopStudioNativeCameraRecordingAsync(target,takeId).catch(()=>undefined);},12000);waiting.set(takeId,{resolve,reject,timer});});
      void started.catch(()=>undefined);
      const finished=startStudioRemoteCameraRecordingAsync(target,takeId,owner,session.id).then(value=>({uri:value.uri}),async cause=>{
        const pending=waiting.get(takeId);if(pending?.recovery)return {uri:pending.recovery};throw cause;
      }).finally(()=>{const pending=waiting.get(takeId);if(pending){clearTimeout(pending.timer);pending.reject(new Error('O take terminou antes de confirmar o início.'));waiting.delete(takeId);}});
      return {started,finished};},
    async stop(takeId){const target=getTag();if(target)await stopStudioNativeCameraRecordingAsync(target,takeId);},
    async preview(connection){check();if(room)return;
      const runtime=sdk();runtime.native.registerGlobals({autoConfigureAudioSession:false});runtime.client.setLogLevel(runtime.client.LogLevel.silent);
      // Explicit exclusive camera route. No audio track/session is acquired.
      NativeModules.WebRTCModule?.audioDeviceModuleSetAutomaticAudioSessionConfiguration?.(null);
      const target=tag();previewTag=target;const descriptor=await startStudioRemoteCameraPreviewAsync(target);check();
      const ownedStream=new runtime.rtc.MediaStream(descriptor);stream=ownedStream;const media=ownedStream.getVideoTracks()[0];if(!media)throw new Error('A câmera não forneceu a pista de prévia.');
      track=new runtime.client.LocalVideoTrack(media as unknown as globalThis.MediaStreamTrack,{},true);
      const owned=new runtime.client.Room({adaptiveStream:false,dynacast:true,stopLocalTrackOnUnpublish:false});room=owned;
      try {if(new URL(connection.url).protocol!=='wss:')throw new Error('A prévia precisa de uma conexão privada segura.');
        await withLiveDeadline(()=>owned.connect(connection.url,connection.token,{autoSubscribe:false}),scope.signal,30_000);check();if(room!==owned)throw new Error('A conexão mudou.');
        await owned.localParticipant.publishTrack(track,{source:runtime.client.Track.Source.Camera,videoCodec:'h264',simulcast:false,
          // This is a 1080p display proxy; the 4K master stays in MovieFileOutput.
          // Congestion control can reduce resolution rather than queue old frames.
          videoEncoding:{maxBitrate:6_000_000,maxFramerate:30,priority:'high'},
          degradationPreference:'maintain-framerate',stopMicTrackOnMute:false});check();
      }catch {await port.disconnect();throw new Error('Não foi possível conectar a prévia privada. O original permanece no iPhone.');}
    },
    async disconnect(){
      const owned=room;room=null;await owned?.disconnect();track=null;
      if(previewTag)await stopStudioRemoteCameraPreviewAsync(previewTag).catch(()=>undefined);previewTag=null;stream?.release();stream=null;
      // Restore the installed default only after this video-only room is gone.
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
    journal:id=>readRemoteCameraJournal(owner,id,deviceId),mutate,masterUri:(session,take)=>remoteMasterUri(owner,session,take),inspect,upload,
    async saveLocal(session,take){check();await loadStudioProjects(owner);let journal=await readRemoteCameraJournal(owner,session.id,deviceId);
      let project=journal.projectId?getStudioProject(owner,journal.projectId):undefined;
      if(!project){project=await createStudioProject(owner,session.kind,{transient:true,isCurrent:scope.isCurrent});const id=project.id;await mutate(session.id,value=>({...value,projectId:id}));}
      const local=await persistStudioTake(project,{id:take.id,uri:take.uri,name:`${session.title||'Take do computador'}.mov`});check();
      await mutateStudioProject(owner,project.id,value=>{check();return {takes:value.takes.some(item=>item.id===local.id)?value.takes:[...value.takes,local],...(!value.coverUri&&!value.coverUrl&&local.thumbnailUri?{coverUri:local.thumbnailUri}:{})};});
      return {projectId:project.id,localTakeId:local.id};},
  });
}
