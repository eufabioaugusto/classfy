import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as controller from './remoteCameraController.ts';
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
    minZoom:1,maxZoom:7.5,zoom:1,generation:2,proConfirmed:true,pro:{supportsExposure:true,iso:100,shutterSeconds:1/60}};
  const native={getStudioNativeCameraCapabilitiesAsync:async()=>state,
    configureStudioNativeCameraAsync:async(tag,config)=>{calls.push({kind:'configure',tag,config});return state;},
    setStudioNativeCameraProSettingsAsync:async(tag,pro)=>{calls.push({kind:'pro',tag,pro});if(options.failPro?.())throw Error('Ajuste recusado');return state;},
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
    './remoteCameraJournal':{},'./store':{},'./media':{},'./uploadTransport':transfer,
    'livekit-client':sdk,'@livekit/react-native-webrtc':{MediaStream:class{constructor(descriptor){calls.push({kind:'stream',descriptor});}getVideoTracks(){return [{id:'native-track'}];}release(){calls.push({kind:'release-stream'});}}},
    '@livekit/react-native':{registerGlobals:options=>calls.push({kind:'register',options}),setupIOSAudioManagement:()=>calls.push({kind:'restore-audio-policy'})},
  });
  const session={id:'session',kind:'short',configuration:{resolution:'4k',fps:30,cameraFacing:'back'}};
  const port=runtime.createRemoteNativePort('owner',session,()=>77,{isCurrent:()=>current});
  return {runtime,port,session,calls,recording,invalidate:()=>{current=false;}};
}
test('pista remota é fornecida pelo mesmo native view, apenas vídeo; SDK não abre câmera ou microfone',async()=>{
  const h=nativeHarness();await h.port.port.configure(h.session.configuration);
  await h.port.port.preview({url:'wss://private.invalid',token:'not-real',identity:'device'});
  assert.equal(h.calls.find(call=>call.kind==='native-preview').tag,77);
  assert.equal(h.calls.find(call=>call.kind==='user-track').provided,true);
  assert.deepEqual(h.calls.find(call=>call.kind==='register').options,{autoConfigureAudioSession:false});
  assert.equal(h.calls.find(call=>call.kind==='audio-policy').value,null);
  assert.equal(h.calls.filter(call=>call.kind==='publish').length,1);assert.equal(h.calls.find(call=>call.kind==='publish').options.source,'camera');
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
