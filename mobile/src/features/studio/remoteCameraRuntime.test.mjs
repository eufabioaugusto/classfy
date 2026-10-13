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
function compile(file,dependencies){
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw Error(`Unexpected dependency ${name}`);return dependencies[name];},module,module.exports);return module.exports;
}
function nativeHarness(options={}){
  const calls=[],recording=deferred(),data=new Map();let current=true;
  const state={position:'back',qualities:[{quality:'2160p',width:3840,height:2160,fps:[30]}],quality:'2160p',width:3840,height:2160,fps:30,isRecording:false,
    minZoom:1,maxZoom:7.5,zoom:1,generation:2,proConfirmed:true,pro:{supportsExposure:true,autoExposure:true,iso:100,shutterSeconds:1/60},
    ...(options.audioState?{supportsAudioInputSelection:true,audioInput:structuredClone(options.audioState)}:{})};
  const native={getStudioNativeCameraCapabilitiesAsync:async()=>state,
    configureStudioNativeCameraAsync:async(tag,config)=>{calls.push({kind:'configure',tag,config});if(options.resetOnConfigure){state.pro.autoExposure=true;state.exposureLocked=false;}return state;},
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
      calls.push({kind:'focus',tag,point});state.supportsFocus=true;state.focusLocked=point.locked;
      // The native focus setter meters only Auto/locked exposure, never custom.
      if(state.pro.autoExposure!==false||state.exposureLocked){state.pro.autoExposure=!point.locked;state.exposureLocked=point.locked;}
      return options.focusReceipt?options.focusReceipt(state,point):state;
    },
    setStudioNativeCameraProSettingsAsync:async(tag,pro)=>{calls.push({kind:'pro',tag,pro});if(options.failPro?.())throw Error('Ajuste recusado');state.pro={...state.pro,...pro};if(typeof pro.autoExposure==='boolean')state.exposureLocked=false;return state;},
    setStudioNativeCameraZoomAsync:async(tag,value)=>{calls.push({kind:'zoom',tag,value});state.zoom=Math.min(state.maxZoom,Math.max(state.minZoom,value));return state;},
    startStudioRemoteCameraRecordingAsync:(...args)=>{calls.push({kind:'REC',args});return recording.promise;},
    stopStudioNativeCameraRecordingAsync:async(...args)=>{calls.push({kind:'STOP',args});},
    startStudioRemoteCameraPreviewAsync:async tag=>{calls.push({kind:'native-preview',tag});return {streamId:'native-stream',streamReactTag:'native-stream',tracks:[{id:'native-track',kind:'video'}]};},
    stopStudioRemoteCameraPreviewAsync:async tag=>{calls.push({kind:'stop-native-preview',tag});},
  };
  const sdk={Track:{Source:{Camera:'camera'}},LogLevel:{silent:'silent'},setLogLevel(){},
    LocalVideoTrack:class{constructor(media,_constraints,provided){calls.push({kind:'user-track',media,provided});}},
    Room:class{state='disconnected';localParticipant={publishTrack:async(_track,options)=>{calls.push({kind:'publish',options});}};
      constructor(options){calls.push({kind:'room',options});}async connect(url,_token,options){calls.push({kind:'connect',url,options});this.state='connected';}async disconnect(){calls.push({kind:'disconnect'});this.state='disconnected';}},
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
  const session={id:'session',kind:'short',configuration:{resolution:'4k',fps:30,cameraFacing:'back'}};
  const port=runtime.createRemoteNativePort('owner',session,()=>77,{isCurrent:()=>current});
  return {runtime,port,session,state,calls,recording,invalidate:()=>{current=false;}};
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
test('scope inválido não configura hardware nem publica; capabilities PRO permanecem snapshot real',async()=>{
  const h=nativeHarness(),snapshot=await h.port.port.snapshot();assert.equal(snapshot.pro.iso,100);assert.equal(snapshot.capabilities.qualityProfiles[0].resolution,'4k');
  h.invalidate();await assert.rejects(h.port.port.configure(h.session.configuration),/stale/);assert.equal(h.calls.length,0);
});

test('zoom passa pelo setter físico separado e ACK publica fator confirmado/ranges reais',async()=>{
  const h=nativeHarness(),snapshot=await h.port.port.configure({...h.session.configuration,pro:{zoom:10,autoExposure:true}});
  assert.deepEqual(h.calls.find(call=>call.kind==='pro').pro,{autoExposure:true});assert.equal(h.calls.find(call=>call.kind==='zoom').value,10);
  assert.equal(snapshot.pro.zoom,7.5);assert.equal(snapshot.pro.minZoom,1);assert.equal(snapshot.pro.maxZoom,7.5);assert.equal(snapshot.pro.supportsZoom,true);
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
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').at(-1).pro,{...manual,autoFocus:true,...whiteBalance});
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
  assert.deepEqual(h.calls.filter(call=>call.kind==='pro').at(-1).pro,{autoExposure:true,autoFocus:true});
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
