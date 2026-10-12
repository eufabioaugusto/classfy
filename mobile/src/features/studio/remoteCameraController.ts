import type { StudioRemoteCommand, StudioRemoteConfiguration, StudioRemoteDeviceState, StudioRemoteResponse, StudioRemoteSession } from './remoteCameraProtocol';
import type { RemoteCameraJournal, RemoteTakeJournal } from './remoteCameraJournal';
import {mergeRemoteCameraConfiguration} from './remoteCameraConfiguration.ts';

export type RemoteCameraNative = {
  configure(configuration:StudioRemoteConfiguration):Promise<StudioRemoteDeviceState>;
  snapshot():Promise<StudioRemoteDeviceState>;
  begin(takeId:string):{started:Promise<number>;finished:Promise<{uri:string}>};
  stop(takeId:string):Promise<void>;
  preview(connection:NonNullable<StudioRemoteResponse['connection']>):Promise<void>;
  disconnect():Promise<void>;
};
export type RemoteCameraDependencies = {
  owner:string;deviceId:string;current():boolean;now?():number;
  request(action:string,body:Record<string,unknown>):Promise<StudioRemoteResponse>;
  journal(sessionId:string):Promise<RemoteCameraJournal>;
  mutate(sessionId:string,change:(latest:RemoteCameraJournal)=>RemoteCameraJournal):Promise<RemoteCameraJournal>;
  masterUri(sessionId:string,takeId:string):string;
  inspect(uri:string):Promise<NonNullable<RemoteTakeJournal['metadata']>>;
  saveLocal(session:StudioRemoteSession,take:RemoteTakeJournal):Promise<{projectId:string;localTakeId:string}>;
  upload(session:StudioRemoteSession,take:RemoteTakeJournal,onProgress?:(bytes:number)=>void):Promise<void>;
};
export type RemoteCameraSnapshot={phase:'idle'|'joining'|'preparing'|'ready'|'starting'|'recording'|'saving'|'error'|'closed';session:StudioRemoteSession|null;
  state:StudioRemoteDeviceState|null;error:string|null;previewConnected:boolean;uploading:boolean;takeCount:number;syncUncertaintyMs:number|null;recordingStartedAtMs?:number;
  uploadState?:'uploading'|'paused'|'idle'|'complete';uploadProgressBytes?:number;uploadTakeId?:string|null;uploadError?:string|null};
const failure=(cause:unknown)=>(cause instanceof Error?cause.message:'A conexão foi interrompida. Os originais permanecem no iPhone.')
  .replace(/(?:https?|wss?|file):\/\/\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gi,'[dado privado omitido]').slice(0,500);

/** Coordinates actual camera events and durable receipts; no media/network mocks in production. */
export function createRemoteCameraController(deps:RemoteCameraDependencies) {
  const now=deps.now||Date.now, listeners=new Set<(state:RemoteCameraSnapshot)=>void>();
  let state:RemoteCameraSnapshot={phase:'idle',session:null,state:null,error:null,previewConnected:false,uploading:false,takeCount:0,syncUncertaintyMs:null};
  let closed=false, native:RemoteCameraNative|null=null, connection:StudioRemoteResponse['connection'], polling:Promise<void>|null=null;
  let commandWork:Promise<void>=Promise.resolve(), uploadWork:Promise<void>|null=null, bestRtt=Infinity, offset=0;
  type ActiveTake={id:string;finished:Promise<RemoteTakeJournal>;stopping:boolean;acknowledged:boolean};
  let active:ActiveTake|null=null;
  const current=()=>!closed&&deps.current();
  const check=()=>{if(!current())throw Object.assign(new Error('A conexão mudou. O original permanece no iPhone.'),{name:'AbortError'});};
  const publish=(patch:Partial<RemoteCameraSnapshot>)=>{state={...state,...patch};if(current())listeners.forEach(listener=>listener({...state}));};
  const request=async(action:string,body:Record<string,unknown>)=>{
    check();const before=now(), response=await deps.request(action,body),after=now();check();
    const rtt=after-before, server=Date.parse(response.serverAt);
    const observedOffset=server-(before+after)/2;
    if(rtt>=0&&Number.isFinite(server)){
      if(Number.isFinite(bestRtt)&&Math.abs(observedOffset-offset)>Math.max(1000,bestRtt+rtt))bestRtt=Infinity;
      if(rtt<bestRtt){bestRtt=rtt;offset=observedOffset;publish({syncUncertaintyMs:rtt/2});}
    }
    if(state.session&&response.session.id!==state.session.id)throw new Error('A resposta pertence a outra conexão.');
    publish({session:response.session});return response;
  };
  const patchTake=(sessionId:string,id:string,patch:Partial<RemoteTakeJournal>)=>deps.mutate(sessionId,journal=>({...journal,takes:journal.takes.map(take=>take.id===id?{...take,...patch}:take)}));
  const transferState=()=>({uploadState:state.uploadState||'idle',uploadProgressBytes:state.uploadProgressBytes||0,
    uploadTakeId:state.uploadTakeId||null,uploadError:state.uploadError||null,uploading:state.uploading});
  let lastTransferHeartbeat=0;
  async function transferHeartbeat(force=false){if(native||!current()||!state.session||!force&&now()-lastTransferHeartbeat<1500)return;
    lastTransferHeartbeat=now();await request('heartbeat',{sessionId:state.session.id,role:'device',clientId:deps.deviceId,
      state:{recording:false,cameraConnected:false,...transferState()}}).catch(()=>undefined);}
  async function localReady(session:StudioRemoteSession,id:string,uri:string) {
    const metadata=await deps.inspect(uri);
    const journal=await deps.journal(session.id), existing=journal.takes.find(take=>take.id===id);
    if(!existing)throw new Error('O original não possui diário local.');
    const take={...existing,uri,metadata:{...metadata,...(existing.startedAtServerMs!==undefined?{startedAtServerMs:existing.startedAtServerMs}:{})},phase:'local_ready' as const};
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
      try {await localReady(session,take.id,take.uri);}catch {/* Empty/incomplete originals remain in the journal; never overwrite them. */}
    }
    publish({takeCount:(await deps.journal(session.id)).takes.filter(take=>take.metadata).length});
  }
  async function uploads() {
    if(uploadWork||!state.session||!current())return uploadWork;
    const session=state.session;
    let work!:Promise<void>;
    work=(async()=>{
      publish({uploading:true,uploadState:'uploading',uploadError:null});
      try {
        for(const take of (await deps.journal(session.id)).takes) {
          if(!take.metadata||take.phase==='uploaded')continue;
          check();publish({uploadState:'uploading',uploadTakeId:take.id,uploadProgressBytes:0});void transferHeartbeat(true);
          await deps.upload(session,take,bytes=>{if(current()){publish({uploadProgressBytes:Math.max(state.uploadProgressBytes||0,bytes)});void transferHeartbeat();}});check();
          await patchTake(session.id,take.id,{phase:'uploaded',error:undefined});publish({uploadState:'complete',uploadProgressBytes:take.metadata.bytes});
        }
        if(state.uploadState==='uploading')publish({uploadState:state.uploadTakeId?'complete':'idle'});
      }catch(cause){if(current())publish({uploadState:'paused',uploadError:failure(cause),error:`Envio pausado. Os originais estão salvos. ${failure(cause)}`});}
      finally{if(uploadWork===work)uploadWork=null;publish({uploading:false});await transferHeartbeat(true);}
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
      if(receipt.ok&&command.type==='start'){if(active&&active.id===receipt.takeId)active.acknowledged=true;if((await deps.journal(session.id)).takes.find(take=>take.id===receipt.takeId)?.metadata)void uploads();}
      if(receipt.ok&&command.type==='stop')void uploads();return;}
    if(!native)throw new Error('Aguarde a câmera preparar a imagem.');
    let result:Record<string,unknown>,startedTake:ActiveTake|undefined;
    try {
      if(command.type==='configure') {
        if(active)throw new Error('Finalize o take antes de alterar a câmera.');
        const patch=command.payload as Partial<StudioRemoteConfiguration>;
        const configured=await native.configure(mergeRemoteCameraConfiguration(session.configuration,patch));check();
        if(!state.previewConnected&&connection){await native.preview(connection);check();publish({previewConnected:true});}
        publish({state:configured,phase:'ready',error:null});result={ok:true,state:configured};
      }else if(command.type==='start') {
        const takeId=String(command.payload.takeId||'');
        const journal=await deps.journal(session.id);
        if(journal.takes.some(take=>take.id===takeId))throw new Error('Este take já foi iniciado. Recupere o original em vez de gravar novamente.');
        if(active)throw new Error('A câmera já está gravando outro take.');
        const uri=deps.masterUri(session.id,takeId);
        await deps.mutate(session.id,value=>({...value,takes:[...value.takes,{id:takeId,uri,phase:'reserved'}]}));check();
        const recording=native.begin(takeId);
        let owned:ActiveTake;
        const finished=recording.finished.then(file=>localReady(session,takeId,file.uri));
        owned={id:takeId,finished,stopping:false,acknowledged:false};active=owned;startedTake=owned;
        publish({phase:'starting'});
        void finished.then(()=>{
          if(active===owned){active=null;publish({phase:'ready',recordingStartedAtMs:undefined});if(!owned.stopping&&owned.acknowledged)void uploads();}
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
        if(active?.id===takeId){active.stopping=true;publish({phase:'saving'});const owned=active;await native.stop(takeId);take=await owned.finished;}
        else take=(await deps.journal(session.id)).takes.find(value=>value.id===takeId&&value.metadata);
        if(!take?.metadata)throw new Error('Não foi possível encontrar o original deste take. Os arquivos permanecem no iPhone.');
        check();publish({phase:'ready'});result={ok:true,takeId,metadata:take.metadata,state:await native.snapshot()};
      }else throw new Error('O comando não é compatível com este aplicativo.');
    }catch(cause){result={ok:false,error:failure(cause)};if(current())publish({error:failure(cause)});}
    check();await ack(command,result);
    if(startedTake&&result.ok){startedTake.acknowledged=true;if((await deps.journal(session.id)).takes.find(take=>take.id===startedTake!.id)?.metadata)void uploads();}
    if(command.type==='stop'&&result.ok)void uploads();
  }
  const controller={
    getSnapshot:()=>({...state}), subscribe(listener:(state:RemoteCameraSnapshot)=>void){listeners.add(listener);listener({...state});return()=>listeners.delete(listener);},
    async join(code:string){if(state.phase==='joining')return;publish({phase:'joining',error:null});
      try{const response=await request('join',{code,deviceId:deps.deviceId});connection=response.connection;if(!connection)throw new Error('O servidor não preparou a prévia privada.');publish({phase:'preparing'});await recover(response.session);}catch(cause){publish({phase:'error',error:failure(cause)});throw cause;}},
    async resume(sessionId:string){publish({phase:'joining',error:null});const response=await request('connect',{sessionId,role:'device',clientId:deps.deviceId});connection=response.connection;if(!connection)throw new Error('Não foi possível retomar a conexão privada.');publish({phase:'preparing'});await recover(response.session);},
    async recoverLocal(sessionId:string){publish({phase:'joining',error:null});const response=await request('status',{sessionId,afterSequence:0});await recover(response.session);await uploads();publish({phase:'closed'});},
    async cameraReady(port:RemoteCameraNative){if(native||!state.session||!connection||!current())return;native=port;
      try{const snapshot=await port.snapshot();publish({state:snapshot});const configured=await port.configure(state.session.configuration);check();publish({state:configured});await port.preview(connection);check();publish({phase:'ready',previewConnected:true});await controller.poll();void uploads();}
      catch(cause){publish({phase:'error',error:failure(cause)});if(current()&&state.session)void request('heartbeat',{sessionId:state.session.id,role:'device',clientId:deps.deviceId,state:{...state.state,error:failure(cause)}}).catch(()=>undefined);}},
    async poll(){if(polling||!state.session||!native||!current())return polling;
      const work=(async()=>{const session=state.session!,journal=await deps.journal(session.id);const response=await request('status',{sessionId:session.id,afterSequence:journal.sequence});
        if(response.session.status==='closed'){await controller.disconnect();return;}
        for(const command of response.commands.filter(value=>value.status==='pending').sort((a,b)=>a.sequence-b.sequence)){commandWork=commandWork.catch(()=>undefined).then(()=>apply(command));await commandWork;}
        const snapshot=await native!.snapshot();publish({state:snapshot,...(snapshot.previewConnection!==undefined?{previewConnected:snapshot.previewConnection==='connected'}:{})});await request('heartbeat',{sessionId:session.id,role:'device',clientId:deps.deviceId,state:{...snapshot,syncUncertaintyMs:state.syncUncertaintyMs,
          ...transferState()}});
        if(snapshot.previewConnection==='disconnected'&&connection)await controller.reconnectPreview();
      })();polling=work;try{await work;}catch(cause){if(current())publish({error:failure(cause)});}finally{if(polling===work)polling=null;}},
    async retryUploads(){if(state.session){await recover(state.session);await uploads();}},
    async reconnectPreview(){if(!native||!state.session)return;const response=await request('connect',{sessionId:state.session.id,role:'device',clientId:deps.deviceId});if(!response.connection)throw new Error('A prévia privada não foi renovada.');await native.disconnect();await native.preview(response.connection);connection=response.connection;publish({previewConnected:true,error:null});},
    async stopLocal(){if(active&&native){active.stopping=true;const owned=active;publish({phase:'saving'});await native.stop(owned.id);await owned.finished;publish({phase:'ready'});void uploads();}},
    async disconnect(){if(active&&native)await controller.stopLocal();await native?.disconnect();native=null;connection=undefined;publish({phase:'closed',previewConnected:false});},
    async dispose(){closed=true;listeners.clear();if(active&&native){const owned=active;owned.stopping=true;await native.stop(owned.id).catch(()=>undefined);await owned.finished.catch(()=>undefined);}await native?.disconnect().catch(()=>undefined);native=null;},
  };return controller;
}
