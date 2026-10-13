import type { StudioRemoteCommand, StudioRemoteConfiguration, StudioRemoteDeviceState, StudioRemoteDiscoveryResponse, StudioRemoteResponse, StudioRemoteSession } from './remoteCameraProtocol';
import type { RemoteCameraJournal, RemoteTakeJournal } from './remoteCameraJournal';
import {mergeRemoteCameraConfiguration} from './remoteCameraConfiguration.ts';
import {validateStudioGrade} from './model.ts';

export const REMOTE_CAMERA_LIVE_CONTROL_TOPIC='classfy-studio-camera-control-v1';
export const REMOTE_CAMERA_LIVE_ACK_TOPIC='classfy-studio-camera-control-ack-v1';
export const remoteCameraLiveId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** RTC can change appearance, never capture ownership, audio or a take. */
export function validRemoteCameraLivePatch(value:unknown):value is Partial<StudioRemoteConfiguration>{
  if(!plain(value)||!Object.keys(value).length||Object.keys(value).some(key=>!['pro','imageGrade'].includes(key)))return false;
  if('imageGrade' in value&&(!plain(value.imageGrade)||Object.keys(value.imageGrade).some(key=>!['preset','intensity','exposure','contrast','saturation','temperature'].includes(key))||validateStudioGrade(value.imageGrade).length))return false;
  if('pro' in value){
    const pro=value.pro;if(!plain(pro)||!Object.keys(pro).length)return false;
    const modes=['autoExposure','autoWhiteBalance','autoFocus'],numbers=['iso','shutterSeconds','redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint','lensPosition','zoom'];
    for(const [key,setting] of Object.entries(pro)){
      if(modes.includes(key)){if(typeof setting!=='boolean')return false;}
      else if(numbers.includes(key)){
        if(typeof setting!=='number'||!Number.isFinite(setting)||key!=='whiteBalanceTint'&&setting<0||['iso','shutterSeconds','redGain','greenGain','blueGain','temperatureKelvin','zoom'].includes(key)&&setting<=0||key==='lensPosition'&&setting>1)return false;
      }else if(key==='focusPoint'){
        if(!plain(setting)||Object.keys(setting).some(key=>!['x','y','locked'].includes(key))||typeof setting.locked!=='boolean'||![setting.x,setting.y].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1))return false;
      }else return false;
    }
    if(pro.autoExposure===true&&('iso' in pro||'shutterSeconds' in pro)||pro.autoFocus===true&&'lensPosition' in pro||
      pro.autoWhiteBalance===true&&['redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'].some(key=>key in pro)||
      ['redGain','greenGain','blueGain'].some(key=>key in pro)&&['temperatureKelvin','whiteBalanceTint'].some(key=>key in pro))return false;
  }
  return true;
}
const livePatchContains=(applied:unknown,requested:unknown):boolean=>plain(requested)?plain(applied)&&Object.entries(requested).every(([key,value])=>Object.prototype.hasOwnProperty.call(applied,key)&&livePatchContains(applied[key],value)):Object.is(applied,requested);

export type RemoteCameraNative = {
  configure(configuration:StudioRemoteConfiguration):Promise<StudioRemoteDeviceState>;
  snapshot():Promise<StudioRemoteDeviceState>;
  focus?(point:{x:number;y:number;locked:boolean}):Promise<StudioRemoteDeviceState>;
  selectAudioInput?(inputId:string|null):Promise<StudioRemoteDeviceState>;
  setLiveConfigurationHandler?(handler:((id:string,patch:Partial<StudioRemoteConfiguration>)=>Promise<StudioRemoteDeviceState>)|null):void;
  begin(takeId:string):{started:Promise<number>;finished:Promise<{uri:string}>};
  stop(takeId:string):Promise<void>;
  preview(connection:NonNullable<StudioRemoteResponse['connection']>):Promise<void>;
  disconnect():Promise<void>;
};
export type RemoteCameraDependencies = {
  owner:string;deviceId:string;current():boolean;now?():number;
  request(action:string,body:Record<string,unknown>):Promise<StudioRemoteResponse>;
  discover?(controllerId?:string):Promise<StudioRemoteDiscoveryResponse>;
  journal(sessionId:string):Promise<RemoteCameraJournal>;
  mutate(sessionId:string,change:(latest:RemoteCameraJournal)=>RemoteCameraJournal):Promise<RemoteCameraJournal>;
  masterUri(sessionId:string,takeId:string):string;
  inspect(uri:string):Promise<NonNullable<RemoteTakeJournal['metadata']>>;
  prepareMaster?(session:StudioRemoteSession,take:RemoteTakeJournal,onProgress?:(progress:number,stage:string)=>void):Promise<{uri:string;metadata:NonNullable<RemoteTakeJournal['metadata']>;signature?:string}>;
  saveLocal(session:StudioRemoteSession,take:RemoteTakeJournal):Promise<{projectId:string;localTakeId:string}>;
  upload(session:StudioRemoteSession,take:RemoteTakeJournal,onProgress?:(bytes:number)=>void):Promise<void>;
};
export type RemoteCameraSnapshot={phase:'idle'|'joining'|'waiting'|'unpaired'|'preparing'|'ready'|'starting'|'recording'|'saving'|'error'|'closed';session:StudioRemoteSession|null;
  linkedControllerId?:string|null;
  state:StudioRemoteDeviceState|null;error:string|null;previewConnected:boolean;uploading:boolean;takeCount:number;syncUncertaintyMs:number|null;recordingStartedAtMs?:number;
  processing?:boolean;processingProgress?:number;processingStage?:string;
  uploadState?:'uploading'|'paused'|'idle'|'complete';uploadProgressBytes?:number;uploadTotalBytes?:number;uploadPendingCount?:number;uploadTakeId?:string|null;uploadError?:string|null;uploadResumedAtServerMs?:number};
const failure=(cause:unknown)=>(cause instanceof Error?cause.message:'A conexão foi interrompida. Os originais permanecem no iPhone.')
  .replace(/(?:https?|wss?|file):\/\/\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gi,'[dado privado omitido]').slice(0,500);

/** Coordinates actual camera events and durable receipts; no media/network mocks in production. */
export function createRemoteCameraController(deps:RemoteCameraDependencies) {
  const now=deps.now||Date.now, listeners=new Set<(state:RemoteCameraSnapshot)=>void>();
  let state:RemoteCameraSnapshot={phase:'idle',session:null,state:null,error:null,previewConnected:false,uploading:false,takeCount:0,syncUncertaintyMs:null};
  let closed=false, native:RemoteCameraNative|null=null, connection:StudioRemoteResponse['connection'], polling:Promise<void>|null=null;
  let commandWork:Promise<void>=Promise.resolve(), uploadWork:Promise<void>|null=null, bestRtt=Infinity, offset=0;
  let nativeSettingsWork:Promise<void>=Promise.resolve(),startingNative=false;
  const liveApplied=new Map<string,Partial<StudioRemoteConfiguration>>();
  let liveConfigurationId:string|undefined;
  const uploadRequests=new Set<string>();
  type ActiveTake={id:string;finished:Promise<RemoteTakeJournal>;stopping:boolean;acknowledged:boolean};
  let active:ActiveTake|null=null;
  let deviceHeartbeatAt:number|null=null,deviceHeartbeatKey:string|null=null;
  const heartbeatKey=()=>JSON.stringify([state.phase,state.uploadState||'idle',state.uploadTakeId||null,state.uploadError||null,state.processing===true]);
  const heartbeatDue=()=>deviceHeartbeatAt===null||heartbeatKey()!==deviceHeartbeatKey||
    now()-deviceHeartbeatAt>=(active||state.uploading||state.processing?1500:3000);
  const current=()=>!closed&&deps.current();
  const check=()=>{if(!current())throw Object.assign(new Error('A conexão mudou. O original permanece no iPhone.'),{name:'AbortError'});};
  const settings=<T,>(run:()=>Promise<T>|T):Promise<T>=>{
    const work=nativeSettingsWork.catch(()=>undefined).then(()=>{check();return run();});
    nativeSettingsWork=work.then(()=>undefined,()=>undefined);return work;
  };
  const stamped=(actual:StudioRemoteDeviceState):StudioRemoteDeviceState=>liveConfigurationId?{...actual,liveConfigurationId}:actual;
  const publish=(patch:Partial<RemoteCameraSnapshot>)=>{state={...state,...patch};if(current())listeners.forEach(listener=>listener({...state}));};
  const request=async(action:string,body:Record<string,unknown>)=>{
    check();const before=now(), response=await deps.request(action,body),after=now();check();
    const rtt=after-before, server=Date.parse(response.serverAt);
    const observedOffset=server-(before+after)/2;
    if(rtt>=0&&Number.isFinite(server)){
      if(Number.isFinite(bestRtt)&&Math.abs(observedOffset-offset)>Math.max(1000,bestRtt+rtt))bestRtt=Infinity;
      if(rtt<bestRtt){bestRtt=rtt;offset=observedOffset;publish({syncUncertaintyMs:rtt/2});}
    }
    if(state.session&&response.session.id!==state.session.id&&action!=='unpair')throw new Error('A resposta pertence a outra conexão.');
    if(!state.session||!Number.isFinite(state.session.sequence)||!Number.isFinite(response.session.sequence)||response.session.sequence>=state.session.sequence)publish({session:response.session});
    if(native&&(action==='heartbeat'&&body.role==='device'||action==='ack'&&(body.result as Record<string,unknown>)?.state)){
      deviceHeartbeatAt=now();deviceHeartbeatKey=heartbeatKey();
    }
    return response;
  };
  const patchTake=(sessionId:string,id:string,patch:Partial<RemoteTakeJournal>)=>deps.mutate(sessionId,journal=>({...journal,takes:journal.takes.map(take=>take.id===id?{...take,...patch}:take)}));
  const transferState=()=>({uploadState:state.uploadState||'idle',uploadProgressBytes:state.uploadProgressBytes||0,
    uploadTotalBytes:state.uploadTotalBytes||0,uploadTakeId:state.uploadTakeId||null,uploadError:state.uploadError||null,uploading:state.uploading,
    processing:state.processing===true,processingProgress:state.processingProgress||0,processingStage:state.processingStage||null,
    ...(state.uploadResumedAtServerMs!==undefined?{uploadResumedAtServerMs:state.uploadResumedAtServerMs}:{})});
  let lastTransferHeartbeat=0;
  async function transferHeartbeat(force=false){if(native||!current()||!state.session||!force&&now()-lastTransferHeartbeat<1500)return;
    lastTransferHeartbeat=now();await request('heartbeat',{sessionId:state.session.id,role:'device',clientId:deps.deviceId,
      state:{recording:false,cameraConnected:false,...transferState()}}).catch(()=>undefined);}
  let lastProcessingHeartbeat=0;
  async function processingHeartbeat(){
    if(!current()||!state.session||now()-lastProcessingHeartbeat<1500)return;
    lastProcessingHeartbeat=now();await request('heartbeat',{sessionId:state.session.id,role:'device',clientId:deps.deviceId,
      state:{...state.state,...transferState()}}).catch(()=>undefined);
  }
  async function localReady(session:StudioRemoteSession,id:string,uri:string) {
    const journal=await deps.journal(session.id), existing=journal.takes.find(take=>take.id===id);
    if(!existing)throw new Error('O original não possui diário local.');
    const sourceUri=existing.sourceUri||uri,sourceMetadata=await deps.inspect(sourceUri);
    const original={...existing,sourceUri,sourceMetadata};
    // Persist the clean source and frozen look before any derived encoding.
    // An interrupted export never makes the ungraded source upload-ready.
    await patchTake(session.id,id,original);
    let prepared:{uri:string;metadata:NonNullable<RemoteTakeJournal['metadata']>;signature?:string}={uri:sourceUri,metadata:sourceMetadata};
    if(deps.prepareMaster){
      publish({processing:true,processingProgress:0,processingStage:'rendering'});void processingHeartbeat();
      try{prepared=await deps.prepareMaster(session,original,(progress,stage)=>{if(current()){publish({processingProgress:Math.max(0,Math.min(1,progress)),processingStage:stage});void processingHeartbeat();}});}
      finally{publish({processing:false,processingProgress:undefined,processingStage:undefined});lastProcessingHeartbeat=0;void processingHeartbeat();}
    }
    const take={...original,uri:prepared.uri,...(prepared.signature?{gradeSignature:prepared.signature}:{}),metadata:{...prepared.metadata,...(existing.startedAtServerMs!==undefined?{startedAtServerMs:existing.startedAtServerMs}:{})},phase:'local_ready' as const};
    // Durability survives blur/sign-out; UI/network work still requires current().
    await patchTake(session.id,id,take);
    if(current()) {
      try {const saved=await deps.saveLocal(session,take);await patchTake(session.id,id,saved);}catch(cause){publish({error:`Original preservado. ${failure(cause)}`});}
      publish({takeCount:(await deps.journal(session.id)).takes.filter(value=>value.metadata).length});
    }
    return take;
  }
  async function recover(session:StudioRemoteSession) {
    const journal=await deps.journal(session.id);
    for(const take of journal.takes) {
      if(take.metadata) {
        if(!take.localTakeId&&current())try {await patchTake(session.id,take.id,await deps.saveLocal(session,take));}catch(cause){publish({error:`Original preservado. ${failure(cause)}`});}
        continue;
      }
      try {await localReady(session,take.id,take.sourceUri||take.uri);}catch(cause){if(take.sourceMetadata&&current())publish({uploadState:'paused',uploadTakeId:take.id,uploadError:failure(cause),error:failure(cause)});/* The clean source is never replaced or uploaded without its chosen look. */}
    }
    const preserved=(await deps.journal(session.id)).takes.filter(take=>take.metadata||take.sourceMetadata);
    publish({takeCount:preserved.length,uploadPendingCount:preserved.filter(take=>take.phase!=='uploaded').length});
  }
  async function uploads(takeId?:string) {
    if(!state.session||!current())return;
    uploadRequests.add(takeId||'*');
    if(uploadWork)return uploadWork;
    const session=state.session;
    let work!:Promise<void>;
    work=(async()=>{
      publish({uploading:true,uploadState:'uploading',uploadError:null,...(state.uploadError?{error:null}:{})});
      let transferring:RemoteTakeJournal|undefined;
      let pendingCount=state.uploadPendingCount;
      const countPending=(journal:RemoteCameraJournal)=>journal.takes.filter(take=>take.metadata&&take.phase!=='uploaded').length;
      try {
        // New completed takes can arrive while another original is uploading.
        // Drain fresh requests through the same worker; never open concurrent TUS streams.
        while(uploadRequests.size){
          const requested=new Set(uploadRequests);uploadRequests.clear();
          const batch=await deps.journal(session.id);pendingCount=countPending(batch);
          for(const take of batch.takes) {
            if(!take.metadata||take.phase==='uploaded'||!requested.has('*')&&!requested.has(take.id))continue;
            check();transferring=take;publish({uploadState:'uploading',uploadTakeId:take.id,uploadProgressBytes:0,uploadTotalBytes:take.metadata.bytes,uploadError:null,error:null});void transferHeartbeat(true);
            try{
              await deps.upload(session,take,bytes=>{if(current()){publish({uploadProgressBytes:Math.max(state.uploadProgressBytes||0,bytes)});void transferHeartbeat();}});check();
              pendingCount=countPending(await patchTake(session.id,take.id,{phase:'uploaded',error:undefined}));publish({uploadState:'complete',uploadProgressBytes:take.metadata.bytes,error:null});
            }catch(cause){const message=failure(cause);
              const saved=await patchTake(session.id,take.id,{phase:'error',error:message}).catch(()=>undefined);if(saved)pendingCount=countPending(saved);
              if(!current())throw cause;
              publish({uploadState:'paused',uploadError:message,error:`Envio pausado. Os originais estão salvos. ${message}`});
            }
            transferring=undefined;
          }
        }
        if(state.uploadState==='uploading')publish({uploadState:state.uploadTakeId?'complete':'idle'});
      }catch(cause){const message=failure(cause);
        uploadRequests.clear();
        if(transferring)await patchTake(session.id,transferring.id,{phase:'error',error:message}).catch(()=>undefined);
        if(current())publish({uploadState:'paused',uploadError:message,error:`Envio pausado. Os originais estão salvos. ${message}`});}
      finally{if(uploadWork===work)uploadWork=null;publish({uploading:false,uploadPendingCount:pendingCount});await transferHeartbeat(true);}
    })();uploadWork=work;return work;
  }
  async function ack(command:StudioRemoteCommand,result:Record<string,unknown>) {
    const session=state.session!;
    await deps.mutate(session.id,journal=>({...journal,receipts:{...journal.receipts,[command.id]:result}}));
    await request('ack',{sessionId:session.id,deviceId:deps.deviceId,commandId:command.id,result});
    await deps.mutate(session.id,journal=>({...journal,sequence:Math.max(journal.sequence,command.sequence)}));
  }
  async function apply(command:StudioRemoteCommand) {
    check();const session=state.session!;
    const receipt=(await deps.journal(session.id)).receipts[command.id];
    if(receipt){await ack(command,receipt);
      if(receipt.ok&&command.type==='start'){if(active&&active.id===receipt.takeId)active.acknowledged=true;if((await deps.journal(session.id)).takes.find(take=>take.id===receipt.takeId)?.metadata)void uploads(String(receipt.takeId));}
      if(receipt.ok&&['stop','resume_upload'].includes(command.type)&&receipt.uploadState!=='complete')void uploads(String(receipt.takeId));return;}
    if(!native)throw new Error('Aguarde a câmera preparar a imagem.');
    let result:Record<string,unknown>,startedTake:ActiveTake|undefined;
    try {
      if(command.type==='resume_upload') {
        const takeId=String(command.payload.takeId||'');
        if(active)throw new Error('Finalize o take antes de retomar o envio.');
        await recover(session);check();
        const take=(await deps.journal(session.id)).takes.find(value=>value.id===takeId);
        if(!take?.metadata)throw new Error('O original deste take ainda não está pronto para envio. Ele permanece no iPhone.');
        const complete=take.phase==='uploaded';
        publish({uploadState:complete?'complete':'uploading',uploadTakeId:takeId,uploadProgressBytes:complete?take.metadata.bytes:0,
          uploadTotalBytes:take.metadata.bytes,uploadError:null,error:null,uploadResumedAtServerMs:now()+offset});
        result={ok:true,takeId,...transferState(),state:transferState()};
      }else if(command.type==='configure') {
        if(active)throw new Error('Finalize o take antes de alterar a câmera.');
        const patch=command.payload as Partial<StudioRemoteConfiguration>;
        const owned=native;
        const configured=await settings(async()=>{
          check();if(native!==owned)throw new Error('A câmera mudou.');
          // Its target was applied over RTC, possibly before a newer drag. Read
          // current hardware instead of letting an older durable patch rewind it.
          const applied=liveApplied.get(command.id),skip=!!applied&&livePatchContains(applied,patch);
          const actual=skip?await owned.snapshot():await owned.configure(mergeRemoteCameraConfiguration(state.state?.configuration||session.deviceState?.configuration||session.configuration,patch));check();
          if(!skip)liveConfigurationId=undefined;
          const confirmed=stamped(actual);publish({state:confirmed,phase:'ready',error:null});return confirmed;
        });check();
        if(!state.previewConnected&&connection){await native.preview(connection);check();publish({previewConnected:true});}
        result={ok:true,state:configured};
      }else if(command.type==='start') {
        startingNative=true;
        const takeId=String(command.payload.takeId||'');
        const journal=await deps.journal(session.id);
        if(journal.takes.some(take=>take.id===takeId))throw new Error('Este take já foi iniciado. Recupere o original em vez de gravar novamente.');
        if(active)throw new Error('A câmera já está gravando outro take.');
        const uri=deps.masterUri(session.id,takeId);
        const beforeTake=await settings(()=>native!.snapshot());check();
        if(beforeTake.imageGradeConfirmed===false)throw new Error('Confirme o tratamento da imagem antes de gravar.');
        if(beforeTake.supportsAudioInputSelection===true&&(!beforeTake.audioInput?.confirmed||beforeTake.audioInput.selecting||!beforeTake.audioInput.current))throw new Error(beforeTake.audioInput?.warning||'Confirme o microfone antes de gravar.');
        const imageGrade=beforeTake.imageGrade ?? beforeTake.configuration?.imageGrade ?? session.configuration.imageGrade;
        await deps.mutate(session.id,value=>({...value,takes:[...value.takes,{id:takeId,uri,phase:'reserved',...(imageGrade?{imageGrade:structuredClone(imageGrade) as StudioRemoteConfiguration['imageGrade']}:{})}]}));check();
        const recording=await settings(()=>native!.begin(takeId));
        let owned:ActiveTake;
        const finished=recording.finished.then(file=>localReady(session,takeId,file.uri));
        owned={id:takeId,finished,stopping:false,acknowledged:false};active=owned;startedTake=owned;
        publish({phase:'starting'});
        void finished.then(()=>{
          if(active===owned){active=null;publish({phase:'ready',recordingStartedAtMs:undefined});if(!owned.stopping&&owned.acknowledged)void uploads(owned.id);}
        },cause=>{if(active===owned){active=null;publish({phase:'error',error:failure(cause)});}});
        const timestamp=await recording.started;check();
        if(!Number.isFinite(timestamp)||!Number.isFinite(bestRtt))throw new Error('A câmera não confirmou o instante de início. O original permanece salvo.');
        const startedAtServerMs=timestamp+offset;
        await deps.mutate(session.id,journal=>({...journal,takes:journal.takes.map(take=>take.id===takeId?{...take,startedAtServerMs,
          ...(take.metadata?{metadata:{...take.metadata,startedAtServerMs}}:{}),phase:take.phase==='reserved'?'recording':take.phase}:take)}));check();
        const snapshot=await native.snapshot();publish({...(active===owned&&!owned.stopping?{phase:'recording' as const,recordingStartedAtMs:timestamp}:{}),state:snapshot,error:null});
        result={ok:true,takeId,state:{...snapshot,syncUncertaintyMs:bestRtt/2},startedAtServerMs};
      }else if(command.type==='stop') {
        const takeId=String(command.payload.takeId||'');
        let take:RemoteTakeJournal|undefined;
        let preparationError:unknown;
        if(active?.id===takeId){active.stopping=true;publish({phase:'saving'});const owned=active;await native.stop(takeId);try{take=await owned.finished;}catch(cause){preparationError=cause;}}
        if(!take)take=(await deps.journal(session.id)).takes.find(value=>value.id===takeId);
        if(!take?.metadata){
          if(!take?.sourceMetadata)throw new Error('Não foi possível encontrar o original deste take. Os arquivos permanecem no iPhone.');
          const message=failure(preparationError||state.uploadError||'Retome a preparação da imagem com o app aberto. O original está preservado.');
          check();publish({phase:'ready',recordingStartedAtMs:undefined,processing:false,uploadState:'paused',uploadTakeId:takeId,uploadError:message,error:message,takeCount:(await deps.journal(session.id)).takes.filter(value=>value.metadata||value.sourceMetadata).length});
          // STOP succeeded physically. Do not pretend it is still recording when
          // a later image export failed; metadata becomes final only after retry.
          result={ok:true,takeId,state:{...await native.snapshot(),...transferState()}};
        }else{check();publish({phase:'ready'});result={ok:true,takeId,metadata:take.metadata,state:await native.snapshot()};}
      }else throw new Error('O comando não é compatível com este aplicativo.');
    }catch(cause){result={ok:false,error:failure(cause)};if(current()){
      publish({error:failure(cause)});
      const actual=await settings(async()=>stamped(await native!.snapshot())).catch(()=>undefined);check();
      if(actual){publish({state:actual});result.state=actual;}
    }}finally{if(command.type==='start')startingNative=false;}
    // ACKs carry the current telemetry too, so fast commands cannot erase upload
    // progress while the periodic camera heartbeat is waiting for its deadline.
    if(result.state)result.state={...(result.state as StudioRemoteDeviceState),...transferState()};
    check();await ack(command,result);
    if(startedTake&&result.ok){startedTake.acknowledged=true;if((await deps.journal(session.id)).takes.find(take=>take.id===startedTake!.id)?.metadata)void uploads(startedTake.id);}
    if(command.type==='stop'&&result.ok&&result.metadata)void uploads(String(result.takeId));
    if(command.type==='resume_upload'&&result.ok&&result.uploadState!=='complete')void uploads(String(result.takeId));
  }
  const controller={
    getSnapshot:()=>({...state}), subscribe(listener:(state:RemoteCameraSnapshot)=>void){listeners.add(listener);listener({...state});return()=>listeners.delete(listener);},
    async join(code:string){if(state.phase==='joining')return;publish({phase:'joining',error:null});
      try{const response=await request('join',{code,deviceId:deps.deviceId});connection=response.connection;if(!connection)throw new Error('O servidor não preparou a prévia privada.');publish({phase:'preparing'});await recover(response.session);}catch(cause){publish({phase:'error',error:failure(cause)});throw cause;}},
    async resume(sessionId:string){publish({phase:'joining',error:null});const response=await request('connect',{sessionId,role:'device',clientId:deps.deviceId});connection=response.connection;if(!connection)throw new Error('Não foi possível retomar a conexão privada.');publish({phase:'preparing'});await recover(response.session);},
    async resumePairing(controllerId?:string){if(!deps.discover)throw new Error('Atualize o aplicativo para retomar o vínculo com o computador.');
      if(native||active||uploadWork)throw new Error('Feche a câmera atual antes de retomar outro Studio.');
      publish({phase:'joining',session:null,error:null,previewConnected:false});
      try{const response=await deps.discover(controllerId);check();
        publish({linkedControllerId:response.controllerId});
        if(!response.paired){publish({phase:'unpaired',linkedControllerId:null});return false;}
        if(!response.session){publish({phase:'waiting'});return false;}
        await controller.resume(response.session.id);return true;
      }catch(cause){if(current())publish({phase:'error',error:failure(cause)});throw cause;}},
    async unpair(controllerId?:string){if(active)throw new Error('Finalize o take antes de desvincular o computador.');
      const browser=controllerId||state.linkedControllerId||state.session?.controllerId;
      if(!browser)throw new Error('Nenhum computador vinculado foi encontrado.');
      const response=await request('unpair',{controllerId:browser});
      if(response.unpaired!==true)throw new Error('O servidor não confirmou a desvinculação.');
      native?.setLiveConfigurationHandler?.(null);await native?.disconnect();native=null;liveApplied.clear();liveConfigurationId=undefined;connection=undefined;publish({phase:'unpaired',previewConnected:false,linkedControllerId:null,error:null});},
    async recoverLocal(sessionId:string){publish({phase:'joining',error:null});const response=await request('status',{sessionId,afterSequence:0});await recover(response.session);await uploads();publish({phase:'closed'});},
    async cameraReady(port:RemoteCameraNative){if(native||!state.session||!connection||!current())return;native=port;deviceHeartbeatAt=null;deviceHeartbeatKey=null;liveApplied.clear();liveConfigurationId=undefined;
      const sessionId=state.session.id;
      const liveAllowed=()=>{
        check();if(native!==port||state.session?.id!==sessionId)throw new Error('A câmera mudou.');
        if(active||startingNative||state.uploading||state.processing||!['ready','error'].includes(state.phase)||state.session.status!=='ready')throw new Error('Aguarde o iPhone estar pronto antes de ajustar a imagem.');
      };
      port.setLiveConfigurationHandler?.(async(id,patch)=>{
        if(!remoteCameraLiveId(id)||!validRemoteCameraLivePatch(patch))throw new Error('O ajuste remoto é inválido.');
        liveAllowed();
        try{return await settings(async()=>{
          liveAllowed();const applied=liveApplied.get(id);
          if(applied&&!livePatchContains(applied,patch))throw new Error('A identificação deste ajuste já foi usada.');
          if(state.state?.configurationConfirmed===false)throw new Error('Reconfirme os ajustes da câmera antes de continuar.');
          const base=state.state?.configuration||state.session!.deviceState?.configuration||state.session!.configuration;
          publish({state:{...state.state,configurationConfirmed:false,imageGradeConfirmed:false}});
          const configured=applied?await port.snapshot():await port.configure(mergeRemoteCameraConfiguration(base,patch));check();
          if(native!==port||state.session?.id!==sessionId)throw new Error('A câmera mudou.');
          if(configured.configurationConfirmed!==true||configured.imageGradeConfirmed!==true)throw new Error('O iPhone não confirmou o ajuste da imagem.');
          if(!applied){liveApplied.set(id,structuredClone(patch));if(liveApplied.size>256)liveApplied.delete(liveApplied.keys().next().value!);liveConfigurationId=id;}
          const actual=stamped(configured);publish({state:actual,phase:'ready',error:null});return {...actual,...transferState()};
        });}catch(cause){
          if(current()&&native===port&&state.session?.id===sessionId){
            const actual=await settings(async()=>stamped(await port.snapshot())).catch(()=>undefined);
            if(current()&&native===port)publish({...(actual?{state:actual}:{}),error:failure(cause)});
          }throw cause;
        }
      });
      try{const snapshot=await settings(()=>port.snapshot());publish({state:snapshot});const configured=await settings(()=>port.configure(state.session!.deviceState?.configuration||state.session!.configuration));check();publish({state:configured});await port.preview(connection);check();publish({phase:'ready',previewConnected:true});await controller.poll();void uploads();}
      catch(cause){publish({phase:'error',error:failure(cause)});if(current()&&state.session)void request('heartbeat',{sessionId:state.session.id,role:'device',clientId:deps.deviceId,state:{...state.state,error:failure(cause)}}).catch(()=>undefined);}},
    async poll(){if(polling||!state.session||!native||state.phase==='preparing'||!current())return polling;
      const work=(async()=>{const session=state.session!,journal=await deps.journal(session.id);check();
        let response:StudioRemoteResponse,snapshot:StudioRemoteDeviceState|undefined;
        if(heartbeatDue()){
          const owned=native!;
          // A heartbeat replaces this tick's status request and shares the native
          // command queue, so an old snapshot cannot overwrite a later focus ACK.
          const heartbeat=commandWork.catch(()=>undefined).then(async()=>{
            check();if(native!==owned)throw new Error('A câmera mudou.');
            // A local focus/audio ACK may have refreshed telemetry while this
            // heartbeat waited for its turn. Keep command delivery fast anyway.
            if(!heartbeatDue())return {envelope:await request('status',{sessionId:session.id,afterSequence:journal.sequence}),actual:undefined};
            const actual=await settings(async()=>stamped(await owned.snapshot()));check();if(native!==owned)throw new Error('A câmera mudou.');
            publish({state:actual,...(actual.previewConnection!==undefined?{previewConnected:actual.previewConnection==='connected'}:{})});
            const envelope=await request('heartbeat',{sessionId:session.id,role:'device',clientId:deps.deviceId,afterSequence:journal.sequence,
              state:{...actual,syncUncertaintyMs:state.syncUncertaintyMs,...transferState()}});
            return {envelope,actual};
          });
          commandWork=heartbeat.then(()=>undefined,()=>undefined);
          const received=await heartbeat;response=received.envelope;snapshot=received.actual;
        }else response=await request('status',{sessionId:session.id,afterSequence:journal.sequence});
        if(response.session.status==='closed'){await controller.disconnect();return;}
        for(const command of response.commands.filter(value=>value.status==='pending').sort((a,b)=>a.sequence-b.sequence)){commandWork=commandWork.catch(()=>undefined).then(()=>apply(command));await commandWork;}
        if(snapshot?.previewConnection==='disconnected'&&connection)await controller.reconnectPreview();
      })();polling=work;try{await work;}catch(cause){if(current())publish({error:failure(cause)});}finally{if(polling===work)polling=null;}},
    async retryUploads(){if(!state.session)throw new Error('Conecte ao Studio para enviar os originais.');
      publish({error:null,uploadError:null});await recover(state.session);check();
      const takes=(await deps.journal(state.session.id)).takes;
      if(!takes.some(take=>take.metadata))throw new Error(state.uploadError||(takes.some(take=>take.sourceMetadata)?'Retome a preparação da imagem. O original limpo está preservado.':'Nenhum original concluído está disponível para envio neste aparelho.'));
      if(!takes.some(take=>take.metadata&&take.phase!=='uploaded')){publish({uploadState:'complete',uploading:false,uploadPendingCount:0});return;}
      publish({uploadResumedAtServerMs:now()+offset});await uploads();},
    async reconnectPreview(){if(!native||!state.session)return;const response=await request('connect',{sessionId:state.session.id,role:'device',clientId:deps.deviceId});if(!response.connection)throw new Error('A prévia privada não foi renovada.');await native.disconnect();await native.preview(response.connection);connection=response.connection;publish({previewConnected:true,error:null});},
    async focusLocal(point:{x:number;y:number;locked:boolean}){
      check();if(!native?.focus||!state.session||!['ready','recording'].includes(state.phase))throw new Error('Aguarde a câmera estar pronta para focar.');
      const owned=native;
      const work=commandWork.catch(()=>undefined).then(async()=>{check();if(native!==owned)throw new Error('A câmera mudou.');
        const focused=await settings(async()=>stamped(await owned.focus!(point)));check();publish({state:focused,error:null});
        await request('heartbeat',{sessionId:state.session!.id,role:'device',clientId:deps.deviceId,state:{...focused,...transferState()}}).catch(cause=>{check();publish({error:failure(cause)});});check();return focused;});
      commandWork=work.then(()=>undefined,()=>undefined);return work;
    },
    async selectAudioInput(inputId:string|null){
      check();
      const canSelect=()=>!!native?.selectAudioInput&&!!state.session&&state.phase==='ready'&&!active&&!state.processing;
      if(!canSelect())throw new Error('Escolha o microfone antes de iniciar o take.');
      const owned=native!,sessionId=state.session!.id;
      const previous=state.state?.audioInput;
      if(previous)publish({state:{...state.state,audioInput:{...previous,selecting:true,confirmed:false}},error:null});
      const work=commandWork.catch(()=>undefined).then(async()=>{
        check();if(native!==owned||state.session?.id!==sessionId||!canSelect())throw new Error('Escolha o microfone antes de iniciar o take.');
        const selected=await settings(async()=>stamped(await owned.selectAudioInput!(inputId)));check();
        publish({state:selected,error:null});
        await request('heartbeat',{sessionId,role:'device',clientId:deps.deviceId,state:{...selected,...transferState()}});check();return selected;
      }).catch(async cause=>{
        if(current()&&native===owned&&state.session?.id===sessionId){
          const actual=await owned.snapshot().catch(()=>undefined);
          if(current())publish({...(actual?{state:actual}:{}),error:failure(cause)});
        }throw cause;
      });
      commandWork=work.then(()=>undefined,()=>undefined);return work;
    },
    async stopLocal(){if(active&&native){active.stopping=true;const owned=active;publish({phase:'saving'});await native.stop(owned.id);await owned.finished;publish({phase:'ready'});void uploads(owned.id);}},
    async disconnect(){if(active&&native)await controller.stopLocal();native?.setLiveConfigurationHandler?.(null);await native?.disconnect();native=null;liveApplied.clear();liveConfigurationId=undefined;connection=undefined;publish({phase:'closed',previewConnected:false});},
    async dispose(){closed=true;listeners.clear();native?.setLiveConfigurationHandler?.(null);liveApplied.clear();liveConfigurationId=undefined;if(active&&native){const owned=active;owned.stopping=true;await native.stop(owned.id).catch(()=>undefined);await owned.finished.catch(()=>undefined);}await native?.disconnect().catch(()=>undefined);native=null;},
  };return controller;
}
