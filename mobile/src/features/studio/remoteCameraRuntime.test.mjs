import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as controller from './remoteCameraController.ts';
import {mergeRemoteCameraConfiguration} from './remoteCameraConfiguration.ts';
import * as upload from './remoteCameraUpload.ts';
import * as transfer from './uploadTransport.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const liveId=index=>`11111111-1111-4111-8111-${String(index).padStart(12,'0')}`;
function compile(file,dependencies){
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name];},module,module.exports);return module.exports;
}
function nativeHarness(options={}){
  const calls=[],recording=deferred(),data=new Map(),rooms=[];let current=true;
  const state={position:'back',qualities:[{quality:'2160p',width:3840,height:2160,fps:[24,30,60]},{quality:'1080p',width:1920,height:1080,fps:[24,30,60]}],quality:'2160p',width:3840,height:2160,fps:30,isRecording:false,
    minZoom:1,maxZoom:7.5,zoom:1,generation:2,proConfirmed:true,pro:{supportsExposure:true,autoExposure:true,iso:100,shutterSeconds:1/60},
    ...(options.audioState?{supportsAudioInputSelection:true,audioInput:structuredClone(options.audioState)}:{})};
  const native={getStudioNativeCameraCapabilitiesAsync:async()=>state,
    configureStudioNativeCameraAsync:async(tag,config)=>{
      calls.push({kind:'configure',tag,config});state.position=config.position;state.quality=config.quality;state.fps=config.fps;state.generation++;
      const profile=state.qualities.find(profile=>profile.quality===config.quality);state.width=profile.width;state.height=profile.height;
      if(options.resetOnConfigure){state.pro={...state.pro,autoExposure:true,autoWhiteBalance:true,autoFocus:true};state.exposureLocked=false;state.focusLocked=false;state.zoom=1;}
      return state;
    },
    isStudioNativeCameraEffectsAvailable:()=>true,isStudioCompositionAvailable:()=>true,
    isStudioNativeAudioInputSelectionAvailable:()=>options.audioSupport!==false,
    setStudioNativeAudioInputAsync:async(tag,inputId)=>{
      calls.push({kind:'audio-input',tag,inputId});
      if(!state.audioInput)throw Error('Entradas indisponíveis');
      const actual=state.audioInput.available.find(input=>input.id===(inputId??'builtin'));
      if(!actual)throw Error('Microfone desconectado');
      state.audioInput={...state.audioInput,selecting:true,confirmed:false};await options.audioGate?.();
      state.audioInput={...state.audioInput,preferredId:inputId,current:options.wrongAudio?state.audioInput.available[0]:actual,selecting:false,confirmed:!options.failAudioAck};
      return state;
    },
    setStudioNativeCameraEffectAsync:async(tag,json)=>{calls.push({kind:'grade',tag,grade:JSON.parse(json)});if(options.failGrade?.())throw Error('Imagem recusada');state.imageGrade=JSON.parse(json);state.imageGradeConfirmed=true;return {previewProcessed:true,grade:state.imageGrade,generation:state.generation,effectRevision:1};},
    setStudioNativeCameraFocusAsync:async(tag,point)=>{
      calls.push({kind:'focus',tag,point});state.supportsFocus=true;state.focusLocked=point.locked;state.pro.autoFocus=!point.locked;
      // The native focus setter meters only Auto/locked exposure, never custom.
      if(state.pro.autoExposure!==false||state.exposureLocked){state.pro.autoExposure=!point.locked;state.exposureLocked=point.locked;}
      return options.focusReceipt?options.focusReceipt(state,point):state;
    },
    setStudioNativeCameraProSettingsAsync:async(tag,pro)=>{
      calls.push({kind:'pro',tag,pro});await options.proGate?.(pro);if(options.failPro?.())throw Error('Ajuste recusado');state.pro={...state.pro,...pro};
      if(['redGain','greenGain','blueGain'].some(key=>pro[key]!==undefined)&&['temperatureKelvin','whiteBalanceTint'].some(key=>pro[key]!==undefined))throw Error('Representações de branco incompatíveis');
      if(pro.iso!==undefined||pro.shutterSeconds!==undefined)state.pro.autoExposure=false;
      if(['redGain','greenGain','blueGain','temperatureKelvin','whiteBalanceTint'].some(key=>pro[key]!==undefined))state.pro.autoWhiteBalance=false;
      if(pro.lensPosition!==undefined)state.pro.autoFocus=false;
      if(typeof pro.autoExposure==='boolean'||pro.iso!==undefined||pro.shutterSeconds!==undefined)state.exposureLocked=false;
      options.confirmPro?.(state,pro);return state;
    },
    setStudioNativeCameraZoomAsync:async(tag,value)=>{calls.push({kind:'zoom',tag,value});state.zoom=Math.min(state.maxZoom,Math.max(state.minZoom,value));return state;},
    startStudioRemoteCameraRecordingAsync:(...args)=>{calls.push({kind:'REC',args});return recording.promise;},
    stopStudioNativeCameraRecordingAsync:async(...args)=>{calls.push({kind:'STOP',args});},
    startStudioRemoteCameraPreviewAsync:async tag=>{calls.push({kind:'native-preview',tag});await options.nativePreview?.();return {streamId:'native-stream',streamReactTag:'native-stream',tracks:[{id:'native-track',kind:'video'}]};},
    stopStudioRemoteCameraPreviewAsync:async tag=>{calls.push({kind:'stop-native-preview',tag});},
  };
  const sdk={Track:{Source:{Camera:'camera'}},RoomEvent:{DataReceived:'dataReceived'},LogLevel:{silent:'silent'},setLogLevel(){},
    LocalVideoTrack:class{constructor(media,_constraints,provided){calls.push({kind:'user-track',media,provided});}},
    Room:class{state='disconnected';listeners=new Map();localParticipant={publishTrack:async(_track,value)=>{calls.push({kind:'publish',options:value});await options.publish?.();},publishData:async(bytes,options)=>{calls.push({kind:'data-ack',value:JSON.parse(new TextDecoder().decode(bytes)),options});}};
      constructor(options){rooms.push(this);calls.push({kind:'room',options});}
      on(event,listener){this.listeners.set(event,listener);return this;}off(event,listener){if(this.listeners.get(event)===listener)this.listeners.delete(event);return this;}
      emit(bytes,identity='studio-controller-session-controller',topic=controller.REMOTE_CAMERA_LIVE_CONTROL_TOPIC,participantIdentity){this.listeners.get('dataReceived')?.(bytes,identity===null?undefined:{identity},0,topic,undefined,participantIdentity);}
      async connect(url,_token,value){calls.push({kind:'connect',url,options:value});await options.connect?.();this.state='connected';}async disconnect(){calls.push({kind:'disconnect'});await options.disconnect?.();this.state='disconnected';}},
  };
  const runtime=compile('./remoteCameraRuntime.ts',{
    '@react-native-async-storage/async-storage':{getItem:async key=>data.get(key)||null,setItem:async(key,value)=>data.set(key,value)},'expo-file-system/legacy':{},'expo-crypto':{randomUUID:()=> 'device'},
    'react-native':{NativeModules:{WebRTCModule:{audioDeviceModuleSetAutomaticAudioSessionConfiguration:value=>calls.push({kind:'audio-policy',value})}}},
    '@/features/live/request':{withLiveDeadline:run=>run()},'../../../modules/classfy-studio-media':native,
    './remoteCameraController':controller,'./remoteCameraUpload':upload,'./remoteCameraApi':{assertRemoteCameraScope:()=>{if(!current)throw Error('stale');}},
    './model':model,'./remoteCameraGrade':{prepareRemoteCameraGradedMaster:async()=>{throw Error('unused');}},
    './remoteCameraJournal':{},'./store':{},'./media':{},'./uploadTransport':transfer,
    'livekit-client':sdk,'@livekit/react-native-webrtc':{MediaStream:class{constructor(descriptor){calls.push({kind:'stream',descriptor});}getVideoTracks(){return [{id:'native-track'}];}release(){calls.push({kind:'release-stream'});}}},
    '@livekit/react-native':{registerGlobals:options=>calls.push({kind:'register',options}),setupIOSAudioManagement:()=>calls.push({kind:'restore-audio-policy'})},
  });
  const session={id:'session',controllerId:'controller',deviceId:'device',kind:'short',configuration:{resolution:'4k',fps:30,cameraFacing:'back'}};
  const port=runtime.createRemoteNativePort('owner',session,()=>77,{isCurrent:()=>current});
  return {runtime,port,session,state,calls,recording,rooms,invalidate:()=>{current=false;},
    data:(value,identity,topic,participantIdentity)=>rooms.at(-1).emit(value instanceof Uint8Array?value:new TextEncoder().encode(JSON.stringify(value)),identity,topic,participantIdentity),
    async reply(id){for(let index=0;index<20;index++){const ack=calls.find(call=>call.kind==='data-ack'&&call.value.id===id);if(ack)return ack;await tick();}throw Error('ACK RTC não recebido');}};
}
async function linkedController(h,configuration,options={}){
  let journal={version:1,owner:'owner',deviceId:'device',sessionId:h.session.id,sequence:0,receipts:{},takes:[]},commands=[];
  const server={...h.session,status:'ready',sequence:0,configuration},requests=[];
  const camera=controller.createRemoteCameraController({owner:'owner',deviceId:'device',current:()=>true,
    request:async(action,body)=>{
      requests.push({action,body:structuredClone(body)});
      await options.request?.(action,body);
      if(action==='heartbeat')server.deviceState=structuredClone(body.state);
      if(action==='ack'){
        const command=commands.find(command=>command.id===body.commandId);server.sequence=command.sequence;
        if(body.result.state)server.deviceState=structuredClone(body.result.state);
        commands=commands.filter(command=>command.id!==body.commandId);
      }
      return {session:structuredClone(server),commands:structuredClone(commands),takes:[],serverAt:new Date().toISOString(),
        ...(action==='connect'?{connection:{url:'wss://private.invalid',token:'not-real',identity:'device'}}:{})};
    },journal:async()=>structuredClone(journal),mutate:async(_id,change)=>{await options.mutate?.();return journal=change(structuredClone(journal));},
    masterUri:()=>{throw Error('Não deve iniciar REC');},inspect:async()=>{throw Error('Não deve inspecionar take');},
    saveLocal:async()=>{throw Error('Não deve salvar take');},upload:async()=>{throw Error('Não deve enviar take');}});
  await camera.resume(h.session.id);await camera.cameraReady(h.port.port);
  return {camera,server,requests,async configure(...patches){commands=patches.map((payload,index)=>({id:`configure-${server.sequence+index+1}`,sequence:server.sequence+index+1,type:'configure',payload,status:'pending'}));await camera.poll();},
    async durable(id,payload){commands=[{id,sequence:server.sequence+1,type:'configure',payload,status:'pending'}];await camera.poll();}};
}
test('pista remota é fornecida pelo mesmo native view, apenas vídeo; SDK não abre câmera ou microfone',async()=>{
  const h=nativeHarness();await h.port.port.configure(h.session.configuration);
  await h.port.port.preview({url:'wss://private.invalid',token:'not-real',identity:'device'});
  assert.equal(h.calls.find(call=>call.kind==='native-preview').tag,77);
  assert.equal(h.calls.find(call=>call.kind==='user-track').provided,true);
  assert.deepEqual(h.calls.find(call=>call.kind==='register').options,{autoConfigureAudioSession:false});
  assert.equal(h.calls.find(call=>call.kind==='audio-policy').value,null);
  assert.equal(h.calls.filter(call=>call.kind==='publish').length,1);assert.equal(h.calls.find(call=>call.kind==='publish').options.source,'camera');
  const publish=h.calls.find(call=>call.kind==='publish').options;
  assert.equal(publish.simulcast,false);assert.equal(publish.videoCodec,'h264');
  assert.deepEqual(publish.videoEncoding,{maxBitrate:6_000_000,maxFramerate:30,priority:'high'});
  assert.equal(publish.degradationPreference,'maintain-framerate');
  assert.equal(h.calls.find(call=>call.kind==='configure').config.orientation,'portrait');
  await h.port.port.disconnect();assert.equal(h.calls.filter(call=>call.kind==='STOP').length,0);assert.equal(h.calls.filter(call=>call.kind==='release-stream').length,1);
});
test('REC master usa owner/session/take duráveis e começou somente com timestamp nativo da mesma operação',async()=>{
  const h=nativeHarness();await h.port.port.configure(h.session.configuration);const record=h.port.port.begin('take');let resolved=false;void record.started.then(()=>{resolved=true;});
  h.port.onRecordingState({phase:'recording',operationId:'other',startedAtEpochMs:10});await Promise.resolve();assert.equal(resolved,false);
  h.port.onRecordingState({phase:'stopping',operationId:'take',startedAtEpochMs:10050});assert.equal(await record.started,10050);
  assert.deepEqual(h.calls.find(call=>call.kind==='REC').args,[77,'take','owner','session']);
  h.recording.resolve({uri:'file:///private/master.mov'});assert.deepEqual(await record.finished,{uri:'file:///private/master.mov'});
});
test('prévia insegura é rejeitada, fontes/room são liberadas, master não recebe STOP',async()=>{
  const h=nativeHarness();await assert.rejects(h.port.port.preview({url:'ws://private.invalid',token:'test',identity:'device'}),/prévia privada/);
  assert.equal(h.calls.filter(call=>call.kind==='connect').length,0);assert.equal(h.calls.filter(call=>call.kind==='stop-native-preview').length,1);assert.equal(h.calls.filter(call=>call.kind==='STOP').length,0);
});
test('prévia concorrente compartilha início nativo e só confirma após publicar a pista',async()=>{
  const entered=deferred(),gate=deferred(),h=nativeHarness({nativePreview:async()=>{entered.resolve();await gate.promise;}});
  const connection={url:'wss://private.invalid',token:'test',identity:'device'};
  const first=h.port.port.preview(connection),second=h.port.port.preview(connection);await entered.promise;
  assert.equal(h.calls.filter(call=>call.kind==='native-preview').length,1);assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
  gate.resolve();await Promise.all([first,second]);assert.equal(h.rooms.length,1);assert.equal(h.calls.filter(call=>call.kind==='publish').length,1);
  assert.equal((await h.port.port.snapshot()).previewConnection,'connected');await h.port.port.disconnect();
});
test('disconnect durante connect cancela tentativa antiga e nova prévia aguarda cleanup sem deadlock',async()=>{
  const entered=deferred(),gate=deferred();let first=true;
  const h=nativeHarness({connect:async()=>{if(first){first=false;entered.resolve();await gate.promise;}}});
  const connection={url:'wss://private.invalid',token:'test',identity:'device'};
  const opening=h.port.port.preview(connection),rejected=assert.rejects(opening,/prévia privada/);await entered.promise;
  const closing=h.port.port.disconnect(),replacement=h.port.port.preview(connection);await tick();
  assert.equal(h.calls.filter(call=>call.kind==='native-preview').length,1);assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
  gate.resolve();await Promise.all([rejected,closing,replacement]);
  assert.equal(h.rooms.length,2);assert.equal(h.rooms[0].listeners.size,0);assert.equal(h.rooms[1].listeners.size,1);
  assert.equal(h.calls.filter(call=>call.kind==='stop-native-preview').length,1);assert.equal(h.calls.filter(call=>call.kind==='release-stream').length,1);
  assert.equal(h.calls.filter(call=>call.kind==='publish').length,1);assert.equal((await h.port.port.snapshot()).previewConnection,'connected');
  assert.equal(h.calls.filter(call=>call.kind==='STOP'||call.kind==='REC').length,0);await h.port.port.disconnect();
});
test('fechar novamente durante cleanup também invalida prévia que aguardava na fila',async()=>{
  const entered=deferred(),gate=deferred();let block=true;
  const h=nativeHarness({disconnect:async()=>{if(block){entered.resolve();await gate.promise;}}}),connection={url:'wss://private.invalid',token:'test',identity:'device'};
  await h.port.port.preview(connection);const closing=h.port.port.disconnect();await entered.promise;
  const queued=h.port.port.preview(connection),rejected=assert.rejects(queued,/desconectada/),again=h.port.port.disconnect();
  block=false;gate.resolve();await Promise.all([closing,rejected,again]);assert.equal(h.rooms.length,1);
  assert.equal(h.calls.filter(call=>call.kind==='stop-native-preview').length,1);assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
});
test('room conectada sem publish confirmado continua desconectada no snapshot',async()=>{
  const entered=deferred(),gate=deferred(),h=nativeHarness({publish:async()=>{entered.resolve();await gate.promise;}});
  const opening=h.port.port.preview({url:'wss://private.invalid',token:'test',identity:'device'});await entered.promise;
  assert.equal(h.rooms[0].state,'connected');assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
  gate.resolve();await opening;assert.equal((await h.port.port.snapshot()).previewConnection,'connected');await h.port.port.disconnect();
});
test('room desconectada é substituída em vez de confirmar sucesso sem vídeo',async()=>{
  const h=nativeHarness(),connection={url:'wss://private.invalid',token:'test',identity:'device'};await h.port.port.preview(connection);
  const old=h.rooms[0];old.state='disconnected';assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
  await h.port.port.preview(connection);assert.equal(h.rooms.length,2);assert.equal(old.listeners.size,0);assert.equal(h.rooms[1].listeners.size,1);
  assert.equal(h.calls.filter(call=>call.kind==='stop-native-preview').length,1);assert.equal(h.calls.filter(call=>call.kind==='publish').length,2);await h.port.port.disconnect();
});
test('falha de publish libera apenas a tentativa e próxima conexão pode publicar a mesma captura',async()=>{
  let fail=true;const h=nativeHarness({publish:async()=>{if(fail)throw Error('Publicação interrompida');}}),connection={url:'wss://private.invalid',token:'test',identity:'device'};
  await assert.rejects(h.port.port.preview(connection),/prévia privada/);assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
  assert.equal(h.rooms[0].listeners.size,0);assert.equal(h.calls.filter(call=>call.kind==='release-stream').length,1);
  fail=false;await h.port.port.preview(connection);assert.equal((await h.port.port.snapshot()).previewConnection,'connected');
  assert.equal(h.calls.filter(call=>call.kind==='native-preview').length,2);assert.equal(h.calls.filter(call=>call.kind==='STOP').length,0);await h.port.port.disconnect();
});
test('cancelamento durante início nativo espera término e libera preview sem publicar ou parar master',async()=>{
  const entered=deferred(),gate=deferred(),h=nativeHarness({nativePreview:async()=>{entered.resolve();await gate.promise;}});
  const opening=h.port.port.preview({url:'wss://private.invalid',token:'test',identity:'device'}),rejected=assert.rejects(opening,/prévia privada/);await entered.promise;
  const firstClose=h.port.port.disconnect(),secondClose=h.port.port.disconnect();gate.resolve();await Promise.all([rejected,firstClose,secondClose]);
  assert.equal(h.calls.filter(call=>call.kind==='stop-native-preview').length,1);assert.equal(h.calls.filter(call=>call.kind==='publish'||call.kind==='STOP'||call.kind==='REC').length,0);
  assert.equal(h.rooms.length,0);assert.equal((await h.port.port.snapshot()).previewConnection,'disconnected');
});
test('scope inválido não configura hardware nem publica; capabilities PRO permanecem snapshot real',async()=>{
  const h=nativeHarness(),snapshot=await h.port.port.snapshot();assert.equal(snapshot.pro.iso,100);assert.equal(snapshot.capabilities.qualityProfiles[0].resolution,'4k');
  h.invalidate();await assert.rejects(h.port.port.configure(h.session.configuration),/stale/);assert.equal(h.calls.length,0);
});

test('zoom passa pelo setter físico separado e ACK publica fator confirmado/ranges reais',async()=>{
  const h=nativeHarness(),snapshot=await h.port.port.configure({...h.session.configuration,pro:{zoom:10,autoExposure:true}});
  assert.deepEqual(h.calls.find(call=>call.kind==='pro').pro,{autoExposure:true});assert.equal(h.calls.find(call=>call.kind==='zoom').value,10);
  assert.equal(snapshot.pro.zoom,7.5);assert.equal(snapshot.pro.minZoom,1);assert.equal(snapshot.pro.maxZoom,7.5);assert.equal(snapshot.pro.supportsZoom,true);
  assert.equal(snapshot.configuration.pro.zoom,7.5);
});
test('falha PRO após mudar formato não libera REC com configuração não confirmada; retry íntegro recupera',async()=>{
  let failed=true;const h=nativeHarness({failPro:()=>failed});
  await assert.rejects(h.port.port.configure({...h.session.configuration,pro:{iso:100,autoExposure:false}}),/recusado/);
  assert.equal((await h.port.port.snapshot()).configurationConfirmed,false);assert.throws(()=>h.port.port.begin('take'),/Reconfirme/);assert.equal(h.calls.filter(call=>call.kind==='REC').length,0);
  failed=false;await h.port.port.configure({...h.session.configuration,pro:{autoExposure:true}});const operation=h.port.port.begin('take');
  h.port.onRecordingState({phase:'recording',operationId:'take',startedAtEpochMs:123});assert.equal(await operation.started,123);
  h.recording.resolve({uri:'file:///private/master.mov'});await operation.finished;
});

test('grade esperaACK e falha não liberaREC; prévia reaplica mesma grade sem alterar master',async()=>{
  let fail=true;const h=nativeHarness({failGrade:()=>fail});const grade=model.studioGrade('cinematic');
  await assert.rejects(h.port.port.configure({...h.session.configuration,imageGrade:grade}),/Imagem recusada/);
  assert.equal((await h.port.port.snapshot()).configurationConfirmed,false);assert.throws(()=>h.port.port.begin('take'),/Reconfirme/);
  fail=false;await h.port.port.configure({...h.session.configuration,imageGrade:grade});await h.port.port.preview({url:'wss://private.invalid',token:'not-real',identity:'device'});
  assert.deepEqual(h.calls.filter(x=>x.kind==='grade').at(-1).grade,grade);assert.deepEqual((await h.port.port.snapshot()).imageGrade,grade);assert.equal(h.calls.filter(x=>x.kind==='REC').length,0);await h.port.port.disconnect();
});
test('ponto remoto usa imagem orientada; toque local usa view e não reenvia manual antigo',async()=>{
  const h=nativeHarness();await h.port.port.configure({...h.session.configuration,pro:{autoFocus:false,lensPosition:.2,autoExposure:false,iso:200,shutterSeconds:.01,focusPoint:{x:.3,y:.7,locked:false}}});
  const remote=h.calls.find(x=>x.kind==='focus');assert.deepEqual(remote.point,{x:.3,y:.7,locked:false,imageCoordinates:true});
  const configured=(await h.port.port.snapshot()).configuration;assert.equal(configured.pro.focusPoint,undefined);assert.equal(configured.pro.autoFocus,true);assert.equal(configured.pro.lensPosition,undefined);
  await h.port.port.focus({x:.4,y:.6,locked:false});assert.deepEqual(h.calls.filter(x=>x.kind==='focus').at(-1).point,{x:.4,y:.6,locked:false});
  await assert.rejects(h.port.port.focus({x:Infinity,y:.5,locked:false}),/Toque/);await h.port.port.disconnect();
});
test('exposição custom preserva ISO/obturador após foco remoto e local, ajuste de branco e retomada da sessão',async()=>{
  const h=nativeHarness({resetOnConfigure:true}),manual={autoExposure:false,iso:20,shutterSeconds:1/47};
  let journal={version:1,owner:'owner',deviceId:'device',sessionId:h.session.id,sequence:0,receipts:{},takes:[]};
  let commands=[];
  const server={...h.session,status:'ready',sequence:0,configuration:{...h.session.configuration,pro:{...manual,focusPoint:{x:.3,y:.7,locked:false}}}};
  const requests=[],request=async(action,body)=>{
    requests.push({action,body:structuredClone(body)});
    if(action==='heartbeat')server.deviceState=structuredClone(body.state);
    if(action==='ack'){server.deviceState=structuredClone(body.result.state);server.sequence=commands.find(command=>command.id===body.commandId).sequence;commands=[];}
    return {session:structuredClone(server),commands:structuredClone(commands),takes:[],serverAt:new Date().toISOString(),
      ...(action==='connect'?{connection:{url:'wss://private.invalid',token:'not-real',identity:'device'}}:{})};
  };
  const makeController=()=>controller.createRemoteCameraController({owner:'owner',deviceId:'device',current:()=>true,request,
    journal:async()=>structuredClone(journal),mutate:async(_id,change)=>(journal=change(structuredClone(journal))),
    masterUri:()=>{throw Error('Não deve iniciar REC');},inspect:async()=>{throw Error('Não deve inspecionar take');},
    saveLocal:async()=>{throw Error('Não deve salvar take');},upload:async()=>{throw Error('Não deve enviar take');}});
  let camera=makeController();await camera.resume(h.session.id);await camera.cameraReady(h.port.port);
  const exposure=()=>{const pro=camera.getSnapshot().state.configuration.pro;assert.equal(pro.autoExposure,false);assert.equal(pro.iso,20);assert.equal(pro.shutterSeconds,1/47);};
  exposure();assert.equal(h.state.exposureLocked,false);assert.equal(h.state.pro.autoExposure,false);
  await camera.focusLocal({x:.4,y:.6,locked:false});exposure();
  const focusHeartbeat=requests.filter(call=>call.action==='heartbeat').at(-1).body.state.configuration.pro;
  assert.equal(focusHeartbeat.autoExposure,false);assert.equal(focusHeartbeat.iso,20);assert.equal(focusHeartbeat.shutterSeconds,1/47);
  const whiteBalance={autoWhiteBalance:false,temperatureKelvin:5900,whiteBalanceTint:8};
  commands=[{id:'white-balance',sequence:1,type:'configure',payload:{pro:whiteBalance},status:'pending'}];await camera.poll();exposure();
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').at(-1).pro,whiteBalance);
  assert.equal(h.calls.filter(call=>call.kind==='configure').length,1);
  assert.equal(server.deviceState.configuration.pro.autoExposure,false);
  await camera.disconnect();await camera.dispose();
  // Recreate both JS coordinators; only the server-confirmed receipt survives.
  camera=makeController();const resumed=h.runtime.createRemoteNativePort('owner',structuredClone(server),()=>77,{isCurrent:()=>true});
  await camera.resume(h.session.id);await camera.cameraReady(resumed.port);exposure();
  assert.equal(h.state.pro.autoExposure,false);assert.equal(h.calls.filter(call=>call.kind==='pro').at(-1).pro.iso,20);
  assert.equal(h.calls.filter(call=>call.kind==='pro').some(call=>call.pro.autoExposure===true),false);
  assert.equal(h.calls.filter(call=>call.kind==='REC').length,0);
  await camera.dispose();
});
test('Auto explícito após custom elimina ISO/obturador salvos e permanece Auto após focar',async()=>{
  const h=nativeHarness();await h.port.port.configure({...h.session.configuration,pro:{autoExposure:false,iso:20,shutterSeconds:1/47}});
  await h.port.port.focus({x:.4,y:.6,locked:false});
  const current=(await h.port.port.snapshot()).configuration;
  await h.port.port.configure(mergeRemoteCameraConfiguration(current,{pro:{autoExposure:true}}));
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').at(-1).pro,{autoExposure:true});
  const focused=await h.port.port.focus({x:.5,y:.5,locked:false});
  assert.equal(focused.configuration.pro.autoExposure,true);assert.equal(focused.configuration.pro.iso,undefined);assert.equal(focused.configuration.pro.shutterSeconds,undefined);
  await h.port.port.disconnect();
});
test('ACK antigo sem modo Pro usa exposureLocked e conserva leitura manual; novo modo confirmado prevalece',async()=>{
  const h=nativeHarness({focusReceipt:(state,point)=>({...state,exposureLocked:point.locked,pro:{iso:80,shutterSeconds:1/90,lensPosition:.3}})});
  await h.port.port.configure(h.session.configuration);
  const locked=await h.port.port.focus({x:.5,y:.5,locked:true});
  assert.equal(locked.configuration.pro.autoExposure,false);assert.equal(locked.configuration.pro.iso,80);assert.equal(locked.configuration.pro.shutterSeconds,1/90);assert.equal(locked.configuration.pro.lensPosition,.3);
  const automatic=await h.port.port.focus({x:.5,y:.5,locked:false});
  assert.equal(automatic.configuration.pro.autoExposure,true);assert.equal(automatic.configuration.pro.iso,undefined);assert.equal(automatic.configuration.pro.shutterSeconds,undefined);assert.equal(automatic.configuration.pro.lensPosition,undefined);
  const confirmed=nativeHarness({focusReceipt:state=>({...state,exposureLocked:true,pro:{...state.pro,autoExposure:true}})});
  await confirmed.port.port.configure(confirmed.session.configuration);
  const receipt=await confirmed.port.port.focus({x:.5,y:.5,locked:false});assert.equal(receipt.configuration.pro.autoExposure,true);assert.equal(receipt.configuration.pro.iso,undefined);
  await h.port.port.disconnect();await confirmed.port.port.disconnect();
});
const audioState=()=>({version:1,available:[{id:'builtin',name:'Microfone do iPhone',type:'MicrophoneBuiltIn'},{id:'usb',name:'Microfone USB',type:'USBAudio'}],preferredId:null,current:{id:'builtin',name:'Microfone do iPhone',type:'MicrophoneBuiltIn'},confirmed:true,selecting:false,warning:null});
test('microfone externo confirmado após câmera/grade persiste na configuração e não altera captura do master',async()=>{
  const h=nativeHarness({audioState:audioState()});
  const configured=await h.port.port.configure({...h.session.configuration,audioInputId:'usb'});
  assert.ok(h.calls.findIndex(c=>c.kind==='audio-input')>h.calls.findIndex(c=>c.kind==='grade'));
  assert.equal(configured.audioInput.current.id,'usb');assert.equal(configured.configuration.audioInputId,'usb');assert.equal(configured.capabilities.audioInputSelection,true);
  const count=h.calls.filter(c=>c.kind==='configure').length;
  const automatic=await h.port.port.selectAudioInput(null);
  assert.equal(automatic.configuration.audioInputId,null);assert.equal(automatic.audioInput.current.id,'builtin');
  assert.equal(h.calls.filter(c=>c.kind==='configure').length,count);assert.equal(h.calls.filter(c=>c.kind==='REC').length,0);
});
test('seleção pendente bloqueia REC e ACK de outro microfone não confirma a preferência',async()=>{
  const gate=deferred(),h=nativeHarness({audioState:audioState(),audioGate:()=>gate.promise});await h.port.port.configure(h.session.configuration);
  const selection=h.port.port.selectAudioInput('usb');await Promise.resolve();
  assert.throws(()=>h.port.port.begin('take'),/Confirme o microfone/);assert.equal(h.calls.filter(c=>c.kind==='REC').length,0);
  gate.resolve();await selection;
  const wrong=nativeHarness({audioState:audioState(),wrongAudio:true});await wrong.port.port.configure(wrong.session.configuration);
  await assert.rejects(wrong.port.port.selectAudioInput('usb'),/não confirmou/);assert.equal((await wrong.port.port.snapshot()).configuration.audioInputId,undefined);
});
test('microfone removido ou confirmação falha conserva configuração e não inventa entrada',async()=>{
  const h=nativeHarness({audioState:audioState(),failAudioAck:true});await h.port.port.configure(h.session.configuration);
  await assert.rejects(h.port.port.selectAudioInput('missing'),/desconectado/);
  await assert.rejects(h.port.port.selectAudioInput('usb'),/não confirmou/);assert.throws(()=>h.port.port.begin('take'),/Confirme o microfone/);
  assert.equal((await h.port.port.snapshot()).configuration.audioInputId,undefined);assert.equal(h.calls.filter(c=>c.kind==='REC').length,0);
  h.invalidate();await assert.rejects(h.port.port.selectAudioInput(null),/stale/);
});
test('controller aplica último ISO/obturador, conserva clamps no ACK e mantém prévia contínua',async()=>{
  const h=nativeHarness({resetOnConfigure:true,confirmPro:state=>{state.pro.iso=Math.min(600,state.pro.iso);state.pro.shutterSeconds=Math.min(1/30,state.pro.shutterSeconds);}});
  const linked=await linkedController(h,{...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/120,autoWhiteBalance:false,temperatureKelvin:5900,whiteBalanceTint:8,zoom:2},imageGrade:model.studioGrade('cinematic')});
  h.calls.length=0;
  await linked.configure({pro:{iso:300}},{pro:{iso:500}},{pro:{shutterSeconds:1/100}},{pro:{iso:900}},{pro:{shutterSeconds:1/10}});
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').map(call=>call.pro),[{iso:300},{iso:500},{shutterSeconds:1/100},{iso:900},{shutterSeconds:1/10}]);
  const acknowledged=linked.requests.filter(call=>call.action==='ack').at(-1).body.result.state;
  assert.equal(acknowledged.configuration.pro.iso,600);assert.equal(acknowledged.configuration.pro.shutterSeconds,1/30);assert.equal(acknowledged.configurationConfirmed,true);
  assert.equal(linked.camera.getSnapshot().state.configuration.pro.iso,600);
  assert.equal(h.state.pro.temperatureKelvin,5900);assert.equal(h.state.zoom,2);
  assert.equal(h.calls.some(call=>['configure','grade','zoom','focus','audio-input','native-preview','stop-native-preview','connect','disconnect'].includes(call.kind)),false);
  const count=h.calls.length;await linked.configure({pro:{iso:600,shutterSeconds:1/30}});assert.equal(h.calls.length,count);
  await linked.camera.dispose();
});
test('branco, zoom, grade e microfone alteram apenas seus setters sem reiniciar exposição/foco',async()=>{
  const h=nativeHarness({resetOnConfigure:true,audioState:audioState()}),manual={autoExposure:false,iso:250,shutterSeconds:1/90,autoFocus:false,lensPosition:.4};
  const linked=await linkedController(h,{...h.session.configuration,pro:{...manual,autoWhiteBalance:false,temperatureKelvin:5500,whiteBalanceTint:3,zoom:2},audioInputId:'usb'});
  h.calls.length=0;
  const grade=model.studioGrade('cinematic');
  await linked.configure({pro:{temperatureKelvin:6500,whiteBalanceTint:9}},{pro:{zoom:4}},{imageGrade:grade},{audioInputId:null});
  assert.deepEqual(h.calls.map(call=>call.kind),['pro','zoom','grade','audio-input']);
  assert.deepEqual(h.calls[0].pro,{temperatureKelvin:6500,whiteBalanceTint:9});
  const actual=linked.camera.getSnapshot().state.configuration;
  assert.deepEqual(Object.fromEntries(Object.keys(manual).map(key=>[key,actual.pro[key]])),manual);
  assert.equal(actual.pro.zoom,4);assert.equal(actual.pro.temperatureKelvin,6500);assert.deepEqual(actual.imageGrade,grade);assert.equal(actual.audioInputId,null);
  assert.equal(h.state.pro.autoExposure,false);assert.equal(h.state.pro.iso,250);assert.equal(h.state.pro.shutterSeconds,1/90);assert.equal(h.state.pro.lensPosition,.4);
  await linked.camera.dispose();
});
test('primeira confirmação e mudanças de resolução/FPS/câmera reconfiguram captura e restauram Pro',async()=>{
  const h=nativeHarness({resetOnConfigure:true,audioState:audioState()}),manual={autoExposure:false,iso:250,shutterSeconds:1/90,autoWhiteBalance:false,temperatureKelvin:5500,whiteBalanceTint:3,autoFocus:false,lensPosition:.4,zoom:2};
  const linked=await linkedController(h,{...h.session.configuration,pro:manual,audioInputId:'usb'});
  assert.equal(h.calls.filter(call=>call.kind==='configure').length,1);
  await linked.configure({});assert.equal(h.calls.filter(call=>call.kind==='configure').length,1);
  await linked.configure({resolution:'1080p'},{fps:60},{cameraFacing:'front'});
  assert.deepEqual(h.calls.filter(call=>call.kind==='configure').map(call=>[call.config.quality,call.config.fps,call.config.position]),[
    ['2160p',30,'back'],['1080p',30,'back'],['1080p',60,'back'],['1080p',60,'front']]);
  assert.equal(h.calls.filter(call=>call.kind==='pro').length,4);assert.equal(h.calls.filter(call=>call.kind==='zoom').length,4);assert.equal(h.calls.filter(call=>call.kind==='audio-input').length,4);
  assert.deepEqual(linked.camera.getSnapshot().state.configuration.pro,manual);
  assert.equal(h.state.width,1920);assert.equal(h.state.fps,60);assert.equal(h.state.position,'front');assert.equal(h.state.pro.autoExposure,false);assert.equal(h.state.zoom,2);
  await linked.camera.dispose();
});
test('falha depois de aplicar ISO invalida ACK/REC e retry restaura todos os valores confirmados',async()=>{
  let fail=false;const h=nativeHarness({resetOnConfigure:true,failGrade:()=>fail});
  const initial={...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90,zoom:2}};
  const confirmed=await h.port.port.configure(initial);fail=true;
  await assert.rejects(h.port.port.configure(mergeRemoteCameraConfiguration(confirmed.configuration,{pro:{iso:400},imageGrade:model.studioGrade('cinematic')})),/Imagem recusada/);
  assert.equal(h.state.pro.iso,400);const partial=await h.port.port.snapshot();assert.equal(partial.configurationConfirmed,false);assert.equal(partial.imageGradeConfirmed,false);assert.equal(partial.configuration,undefined);
  assert.throws(()=>h.port.port.begin('take'),/Reconfirme/);assert.equal(h.calls.filter(call=>call.kind==='REC').length,0);
  fail=false;const retried=await h.port.port.configure(confirmed.configuration);
  assert.equal(retried.configuration.pro.iso,200);assert.equal(retried.configuration.pro.shutterSeconds,1/90);assert.equal(retried.configuration.pro.zoom,2);
  assert.equal(retried.configurationConfirmed,true);assert.equal(h.calls.filter(call=>call.kind==='configure').length,2);
});
test('ajuste Pro pendente bloqueia REC e snapshot só confirma depois do ACK físico',async()=>{
  const entered=deferred(),gate=deferred(),h=nativeHarness({proGate:pro=>{if(pro.iso===300){entered.resolve();return gate.promise;}}});
  const configured=await h.port.port.configure({...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}});
  const pending=h.port.port.configure(mergeRemoteCameraConfiguration(configured.configuration,{pro:{iso:300}}));await entered.promise;
  const snapshot=await h.port.port.snapshot();assert.equal(snapshot.configurationConfirmed,false);assert.equal(snapshot.imageGradeConfirmed,false);
  assert.throws(()=>h.port.port.begin('take'),/Reconfirme/);assert.equal(h.calls.filter(call=>call.kind==='REC').length,0);
  gate.resolve();const actual=await pending;assert.equal(actual.configurationConfirmed,true);assert.equal(actual.configuration.pro.iso,300);
  assert.equal(h.calls.filter(call=>call.kind==='configure').length,1);
});
test('WB alterna Kelvin/RGB sem salvar representações conflitantes e conserva ACK após novo formato',async()=>{
  const h=nativeHarness({resetOnConfigure:true,confirmPro:(state,pro)=>{if(pro.temperatureKelvin!==undefined)state.pro.temperatureKelvin=Math.min(7000,pro.temperatureKelvin);if(pro.redGain!==undefined)state.pro.redGain=Math.min(4,pro.redGain);}});
  const linked=await linkedController(h,{...h.session.configuration,pro:{autoWhiteBalance:false,temperatureKelvin:6000,whiteBalanceTint:5}});
  await linked.configure({pro:{redGain:7,greenGain:2,blueGain:3}},{resolution:'1080p'});
  let actual=linked.camera.getSnapshot().state.configuration.pro;
  assert.deepEqual(actual,{autoWhiteBalance:false,redGain:4,greenGain:2,blueGain:3});
  const rgb=h.calls.filter(call=>call.kind==='pro').at(-1).pro;assert.equal(rgb.temperatureKelvin,undefined);assert.equal(rgb.whiteBalanceTint,undefined);
  await linked.configure({pro:{temperatureKelvin:9000,whiteBalanceTint:8}},{fps:60});
  actual=linked.camera.getSnapshot().state.configuration.pro;assert.deepEqual(actual,{autoWhiteBalance:false,temperatureKelvin:7000,whiteBalanceTint:8});
  const temperature=h.calls.filter(call=>call.kind==='pro').at(-1).pro;assert.equal(temperature.redGain,undefined);assert.equal(temperature.greenGain,undefined);assert.equal(temperature.blueGain,undefined);
  assert.equal(linked.requests.filter(call=>call.action==='ack').every(call=>call.body.result.ok),true);
  await linked.camera.dispose();
});
test('snapshot expõe perda de confirmação nativa e nova geração exige reconfiguração',async()=>{
  const h=nativeHarness();await h.port.port.configure({...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}});
  h.state.proConfirmed=false;let snapshot=await h.port.port.snapshot();assert.equal(snapshot.configurationConfirmed,false);assert.equal(snapshot.imageGradeConfirmed,false);assert.throws(()=>h.port.port.begin('take'),/Reconfirme/);
  h.state.proConfirmed=true;h.state.imageGradeConfirmed=false;snapshot=await h.port.port.snapshot();assert.equal(snapshot.configurationConfirmed,false);assert.throws(()=>h.port.port.begin('take'),/Reconfirme/);
  h.state.imageGradeConfirmed=true;h.state.generation++;snapshot=await h.port.port.snapshot();assert.equal(snapshot.configurationConfirmed,false);
  await h.port.port.configure({...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}});assert.equal(h.calls.filter(call=>call.kind==='configure').length,2);
});
test('RTC privado confirma ISO/clamp imediatamente e recibo durável antigo não desfaz ajuste mais recente',async()=>{
  const h=nativeHarness({confirmPro:state=>{state.pro.iso=Math.min(600,state.pro.iso);}}),linked=await linkedController(h,{...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90,zoom:2}});
  assert.equal(linked.camera.getSnapshot().state.capabilities.liveControls,1);h.calls.length=0;const requests=linked.requests.length;
  h.data({v:1,id:liveId(1),patch:{pro:{iso:900}}});const first=await h.reply(liveId(1));
  assert.equal(first.value.ok,true);assert.equal(first.value.state.configuration.pro.iso,600);assert.equal(first.value.state.liveConfigurationId,liveId(1));assert.equal(first.value.state.configurationConfirmed,true);
  assert.deepEqual(first.options,{reliable:true,topic:controller.REMOTE_CAMERA_LIVE_ACK_TOPIC,destinationIdentities:['studio-controller-session-controller']});assert.equal(linked.requests.length,requests);
  h.data({v:1,id:liveId(2),patch:{pro:{iso:250,shutterSeconds:1/100}}});await h.reply(liveId(2));
  await linked.durable(liveId(1),{pro:{iso:900}});
  let ack=linked.requests.filter(call=>call.action==='ack').at(-1).body.result;
  assert.equal(ack.ok,true);assert.equal(ack.state.configuration.pro.iso,250);assert.equal(ack.state.configuration.pro.shutterSeconds,1/100);assert.equal(ack.state.liveConfigurationId,liveId(2));
  await linked.durable(liveId(2),{pro:{iso:250,shutterSeconds:1/100}});
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').map(call=>call.pro),[{iso:900},{iso:250,shutterSeconds:1/100}]);
  assert.equal(h.calls.some(call=>['configure','grade','zoom','audio-input','native-preview','stop-native-preview'].includes(call.kind)),false);
  await linked.camera.dispose();
});
test('ACK HTTP anterior pendente não bloqueia novo ajuste RTC nem perde snapshot canônico',async()=>{
  let block=false;const entered=deferred(),gate=deferred(),h=nativeHarness(),linked=await linkedController(h,{...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}},{request:(action)=>{if(block&&action==='ack'){entered.resolve();return gate.promise;}}});
  h.data({v:1,id:liveId(3),patch:{pro:{iso:300}}});await h.reply(liveId(3));block=true;
  const durable=linked.durable(liveId(3),{pro:{iso:300}});await entered.promise;
  h.data({v:1,id:liveId(4),patch:{pro:{iso:20}}});const fast=await h.reply(liveId(4));
  assert.equal(fast.value.ok,true);assert.equal(h.state.pro.iso,20);assert.equal(linked.camera.getSnapshot().state.configuration.pro.iso,20);
  gate.resolve();await durable;assert.equal(linked.camera.getSnapshot().state.configuration.pro.iso,20);
  await linked.durable(liveId(4),{pro:{iso:20}});assert.equal(h.calls.filter(call=>call.kind==='pro').length,3);
  await linked.camera.dispose();
});
test('RTC perdido usa configure durável e payload ampliado só pula se todo alvo foi aplicado',async()=>{
  const h=nativeHarness(),linked=await linkedController(h,{...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}});h.calls.length=0;
  h.data({v:1,id:liveId(5),patch:{pro:{iso:300}}},'outro-computador');await linked.durable(liveId(5),{pro:{iso:300}});
  assert.equal(h.state.pro.iso,300);assert.deepEqual(h.calls.filter(call=>call.kind==='pro').map(call=>call.pro),[{iso:300}]);
  h.data({v:1,id:liveId(6),patch:{pro:{iso:400}}});await h.reply(liveId(6));
  await linked.durable(liveId(6),{pro:{iso:400,autoWhiteBalance:false,temperatureKelvin:5900,whiteBalanceTint:8}});
  assert.equal(h.state.pro.temperatureKelvin,5900);assert.equal(linked.camera.getSnapshot().state.liveConfigurationId,undefined);
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').at(-1).pro,{autoWhiteBalance:false,temperatureKelvin:5900,whiteBalanceTint:8});
  await linked.camera.dispose();
});
test('RTC rejeita identidade ausente/errada, tópico, captura/áudio, JSON/UUID/Pro/grade inválidos e payload grande',async()=>{
  const h=nativeHarness(),linked=await linkedController(h,h.session.configuration);h.calls.length=0;
  const packet={v:1,id:liveId(7),patch:{pro:{iso:200}}};
  h.data(packet,null);h.data(packet,'studio-controller-outra-session-controller');h.data(packet,undefined,'outro-topic');
  for(const patch of [{resolution:'1080p'},{fps:60},{cameraFacing:'front'},{audioInputId:null},{pro:{supportsExposure:true}},{pro:{iso:-1}},{pro:{zoom:0}},{pro:{autoExposure:true,iso:200}},{pro:{focusPoint:{x:2,y:.5,locked:false}}},{imageGrade:{...model.studioGrade('natural'),intensity:2}},{imageGrade:{...model.studioGrade('natural'),audioInputId:'usb'}}])h.data({...packet,patch});
  h.data({...packet,id:'invalid'});h.data({...packet,v:2});h.data(new TextEncoder().encode('{invalid'));h.data(new Uint8Array(8193));await tick();await tick();
  assert.equal(h.calls.length,0);await linked.camera.dispose();
});
test('RTC aceita identidade formal do transporte antes do RemoteParticipant e confirma sensor no ACK',async()=>{
  const h=nativeHarness(),linked=await linkedController(h,h.session.configuration);h.calls.length=0;
  const sender='studio-controller-session-controller',requests=linked.requests.length;
  h.data({v:1,id:liveId(11),patch:{pro:{iso:420}}},null,undefined,sender);
  const first=await h.reply(liveId(11));assert.equal(first.value.ok,true);assert.equal(first.value.state.pro.iso,420);
  h.data({v:1,id:liveId(12),patch:{pro:{iso:280}}},sender,undefined,sender);
  const second=await h.reply(liveId(12));assert.equal(second.value.ok,true);assert.equal(second.value.state.pro.iso,280);
  assert.equal(linked.requests.length,requests);await linked.camera.dispose();
});
test('RTC rejeita identidade formal ausente/errada, divergência e identidade alegada no JSON',async()=>{
  const h=nativeHarness(),linked=await linkedController(h,h.session.configuration);h.calls.length=0;
  const sender='studio-controller-session-controller',other='studio-controller-outra-session-controller';
  const packet={v:1,id:liveId(13),patch:{pro:{iso:450}}};
  h.data(packet,null);h.data(packet,null,undefined,other);
  h.data(packet,other,undefined,sender);h.data(packet,sender,undefined,other);
  h.data({...packet,participantIdentity:sender},null);h.data({...packet,participantIdentity:sender},null,undefined,sender);
  await tick();await tick();assert.equal(h.calls.length,0);await linked.camera.dispose();
});
test('RTC duplica UUID sem reaplicar, rejeita novo alvo com mesmo UUID e remove listeners/ACK tardio no teardown',async()=>{
  const entered=deferred(),gate=deferred(),h=nativeHarness({proGate:pro=>{if(pro.iso===350){entered.resolve();return gate.promise;}}}),linked=await linkedController(h,{...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}});
  const packet={v:1,id:liveId(8),patch:{pro:{iso:300}}};h.data(packet);await h.reply(liveId(8));const count=h.calls.filter(call=>call.kind==='pro').length;
  h.data(packet);await tick();await tick();assert.equal(h.calls.filter(call=>call.kind==='pro').length,count);
  h.data({...packet,patch:{pro:{iso:400}}});await tick();await tick();assert.equal(h.calls.filter(call=>call.kind==='pro').length,count);assert.equal(h.calls.filter(call=>call.kind==='data-ack').at(-1).value.ok,false);
  const old=h.rooms.at(-1);h.data({v:1,id:liveId(9),patch:{pro:{iso:350}}});await entered.promise;
  await linked.camera.disconnect();assert.equal(old.listeners.size,0);gate.resolve();await tick();await tick();assert.equal(h.calls.some(call=>call.kind==='data-ack'&&call.value.id===liveId(9)),false);
  const calls=h.calls.length;old.emit(new TextEncoder().encode(JSON.stringify(packet)));await tick();assert.equal(h.calls.length,calls);await linked.camera.dispose();
});
test('troca de conta durante ajuste RTC descarta confirmação e reconectar prévia mantém exatamente um listener',async()=>{
  const h=nativeHarness(),linked=await linkedController(h,{...h.session.configuration,pro:{autoExposure:false,iso:200,shutterSeconds:1/90}}),old=h.rooms.at(-1);
  await linked.camera.reconnectPreview();assert.equal(old.listeners.size,0);assert.equal(h.rooms.at(-1).listeners.size,1);
  const calls=h.calls.length;h.invalidate();h.data({v:1,id:liveId(10),patch:{pro:{iso:300}}});await tick();assert.equal(h.calls.length,calls);
  await linked.camera.dispose();assert.equal(h.rooms.at(-1).listeners.size,0);
});
