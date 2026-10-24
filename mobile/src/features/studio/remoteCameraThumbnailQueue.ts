import type {StudioRemoteMetadata,StudioRemoteThumbnail} from './remoteCameraProtocol';

export const REMOTE_THUMBNAIL_MAX_BYTES=16_384;
export const REMOTE_THUMBNAIL_MAX_EDGE=320;
export type RemoteThumbnailImage={version:1;mime:'image/jpeg';base64:string;bytes:number;width:number;height:number};
export type RemoteThumbnailJob={sessionId:string;takeId:string;sourceUri:string;metadata:StudioRemoteMetadata};
type ThumbnailScope={signal:AbortSignal;check():void};
type Dependencies={
  current():boolean;idle(sessionId:string):boolean;
  list():Promise<RemoteThumbnailJob[]>;
  prepare(job:RemoteThumbnailJob,scope:ThumbnailScope):Promise<RemoteThumbnailImage>;
  publish(job:RemoteThumbnailJob,image:RemoteThumbnailImage,scope:ThumbnailScope):Promise<StudioRemoteThumbnail>;
  remember(job:RemoteThumbnailJob,thumbnail:StudioRemoteThumbnail,scope:ThumbnailScope):Promise<void>;
  delayMs?:number;retryDelayMs?:number;
};

/** One idle queue, independent of the camera/command queue. No job is awaited by REC or STOP. */
export function createRemoteThumbnailQueue(deps:Dependencies){
  let closed=false,epoch=0,sessionId:string|null=null,settled=false,pending=false,retryAttempt=0,nextDelay=0;
  let timer:ReturnType<typeof setTimeout>|null=null,work:Promise<void>|null=null,abort:AbortController|null=null;
  const pause=()=>{epoch++;settled=false;pending=false;retryAttempt=0;nextDelay=0;abort?.abort();if(timer)clearTimeout(timer);timer=null;};
  const run=()=>{
    if(closed||work||!pending||!sessionId||!deps.current()||!deps.idle(sessionId))return;
    pending=false;const ownedSession=sessionId,ownedEpoch=epoch,ownedAbort=new AbortController();abort=ownedAbort;
    const check=()=>{if(closed||ownedAbort.signal.aborted||epoch!==ownedEpoch||sessionId!==ownedSession||!deps.current()||!deps.idle(ownedSession))
      throw Object.assign(new Error('A preparação da miniatura foi pausada.'),{name:'AbortError'});};
    const scope={signal:ownedAbort.signal,check};
    let owned!:Promise<void>;
    owned=(async()=>{
      check();const jobs=(await deps.list()).slice(0,24);check();
      let retry=false;
      for(const job of jobs){
        check();let image:RemoteThumbnailImage;
        try{image=await deps.prepare(job,scope);check();}catch{check();continue;}
        try{
          const thumbnail=await deps.publish(job,image,scope);check();
          await deps.remember(job,thumbnail,scope);check();
        }catch{check();retry=true;/* Retry exactly the cached JPEG when connectivity returns. */}
      }
      settled=!retry;pending=retry;nextDelay=retry?(deps.retryDelayMs??Math.min(60_000,3000*2**Math.min(retryAttempt++,5))):0;
    })().catch(()=>undefined).finally(()=>{
      if(work===owned)work=null;if(abort===ownedAbort)abort=null;
      if(pending&&!closed)kick();
    });work=owned;
  };
  const kick=()=>{if(timer||work||closed)return;timer=setTimeout(()=>{timer=null;run();},nextDelay||(deps.delayMs??250));};
  return {
    schedule(id:string){if(closed||!deps.current()||!deps.idle(id))return;if(sessionId!==id){pause();sessionId=id;}
      if(settled)return;pending=true;kick();},
    pause,
    dispose(){closed=true;pause();sessionId=null;},
  };
}
