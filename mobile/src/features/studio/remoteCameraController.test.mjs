import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteCameraController,validRemoteCameraLivePatch} from './remoteCameraController.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',takeId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function harness(patch={}){
  let current=true,time=10000,commands=[],failAck=false,writeGate,actualRecording=false,hardware=structuredClone(patch.nativeState||{}),liveHandler=null;
  let journal={version:1,owner:'owner',deviceId:'device',sessionId,sequence:0,receipts:{},takes:[],...patch.journal};
  const started=deferred(),finished=deferred(),ended=deferred(),calls=[],writes=[];
  const session={id:sessionId,ownerId:'owner',controllerId:'controller',deviceId:'device',kind:'aula',status:'ready',configuration:{resolution:'4k',fps:30,cameraFacing:'back'}};
  const clone=value=>structuredClone(value);
  const request=async(action,body)=>{
    calls.push({action,body:clone(body)});if(action==='ack'&&failAck){failAck=false;throw Error('Resposta desconhecida');}
    if(action==='unpair'&&patch.unpairError)throw Error(patch.unpairError);
    await patch.request?.(action,body);
    if(action==='status')time+=patch.requestLatencyMs??20;
    return{session:clone(session),commands:clone(commands),takes:[],serverAt:new Date(time+1200).toISOString(),
      ...(action==='unpair'?{unpaired:patch.unpaired===true}:{}),
      ...(['join','connect'].includes(action)?{connection:{url:'wss://private.invalid',token:'not-a-real-token',identity:'device'}}:{})};
  };
  const deps={owner:'owner',deviceId:'device',localTakeStorage:patch.localTakeStorage===true,current:()=>current,now:()=>time,request,...(patch.readCaptureReceipt?{readCaptureReceipt:patch.readCaptureReceipt}:{}),journal:async()=>clone(journal),
    discover:async controllerId=>{calls.push({action:'discover',body:{deviceId:'device',...(controllerId?{controllerId}:{})}});return patch.discover?await patch.discover():{ownerId:'owner',paired:true,controllerId:'controller',session:clone(session),commands:[],takes:[],serverAt:new Date(time+1200).toISOString()};},
    mutate:async(_id,change)=>{if(writeGate){const gate=writeGate;writeGate=undefined;gate.entered.resolve();await gate.promise;}journal=change(clone(journal));writes.push(clone(journal));return clone(journal);},
    ...(patch.prepareMaster?{prepareMaster:async(session,take,progress)=>{calls.push({action:'prepare-master',take:clone(take)});return patch.prepareMaster(session,take,progress);}}:{}),
    masterUri:(_session,id)=>`file:///Documents/classfy-studio-remote/owner/${sessionId}/${id}.mov`,
    inspect:async uri=>{calls.push({action:'inspect',uri});if(patch.inspect)return patch.inspect(uri);return{bytes:6291457,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4};},
    saveLocal:async(_session,take)=>{calls.push({action:'save-local',take:clone(take)});if(patch.saveFail?.())throw Error('Disco indisponível');return{projectId:'project',localTakeId:'local-take'};},
    upload:async(_session,take,onProgress)=>{calls.push({action:'upload',take:clone(take)});onProgress?.(5);await patch.upload?.(take);},
  };
  const native={configure:async configuration=>{calls.push({action:'configure',configuration});await patch.configure?.(configuration);if(patch.liveControls)hardware={...hardware,configuration:clone(configuration),configurationConfirmed:true,imageGradeConfirmed:true,pro:clone(configuration.pro||{})};return{width:3840,height:2160,fps:30,recording:false,...structuredClone(hardware)};},
    setLiveConfigurationHandler:handler=>{liveHandler=handler;},
    snapshot:async()=>{calls.push({action:'snapshot'});await patch.snapshot?.();return {width:3840,height:2160,fps:30,recording:actualRecording,previewConnection:'connected',...structuredClone(hardware)};},
    selectAudioInput:async inputId=>{calls.push({action:'select-audio',inputId});await patch.selectAudio?.(inputId);const currentInput=hardware.audioInput?.available.find(input=>input.id===(inputId??'builtin'));
      if(!currentInput)throw Error('Microfone não disponível');hardware={...hardware,audioInput:{...hardware.audioInput,preferredId:inputId,current:currentInput,confirmed:true,selecting:false},configuration:{...session.configuration,audioInputId:inputId}};
      return {width:3840,height:2160,fps:30,recording:false,...structuredClone(hardware)};},
    focus:async point=>{calls.push({action:'focus',point});await patch.focus?.(point);return {width:3840,height:2160,fps:30,recording:actualRecording,focusLocked:point.locked};},
    begin:id=>{calls.push({action:'native-start',id});actualRecording=true;return{started:started.promise,finished:finished.promise,...(patch.nativeEnded?{ended:ended.promise}:{})};},
    stop:async id=>{calls.push({action:'native-stop',id});actualRecording=false;finished.resolve({uri:`file:///Documents/classfy-studio-remote/owner/${sessionId}/${id}.mov`});},
    preview:async()=>{calls.push({action:'preview'});await patch.preview?.();},disconnect:async()=>{calls.push({action:'disconnect-preview'});await patch.disconnect?.();}};
  const controller=createRemoteCameraController(deps);
  const command=(type,id=type,sequence=1)=>({id,sequence,type,payload:type==='configure'?session.configuration:{takeId},status:'pending'});
  return{controller,calls,writes,started,finished,ended,native,command,
    live:(id,patch)=>liveHandler?liveHandler(id,patch):Promise.reject(Error('Canal desconectado')),hasLiveHandler:()=>!!liveHandler,
    configuration:value=>{session.configuration=value;},session:value=>Object.assign(session,value),journal:()=>clone(journal),queue:values=>{commands=values;},invalidate:()=>{current=false;},failAck:()=>{failAck=true;},
    advance:ms=>{time+=ms;},hardware:value=>{hardware={...hardware,...value};},
    mutateJournal:change=>{journal=change(clone(journal));},
    blockWrite:()=>{const gate=deferred();gate.entered=deferred();writeGate=gate;return gate;},
    ready:async()=>{await controller.join('opaque-code');await controller.cameraReady(native);},
  };
}

const selectedAudio=()=>({supportsAudioInputSelection:true,audioInput:{version:1,available:[{id:'builtin',name:'iPhone',type:'MicrophoneBuiltIn'},{id:'usb',name:'USB',type:'USBAudio'}],preferredId:null,current:{id:'builtin',name:'iPhone',type:'MicrophoneBuiltIn'},confirmed:true,selecting:false,warning:null}});
const fastId=index=>`22222222-2222-4222-8222-${String(index).padStart(12,'0')}`;
test('local-first confirma STOP bruto de 2,7 GB sem render ou upload e deixa novo REC disponível',async()=>{
  const h=harness({localTakeStorage:true,inspect:async()=>({bytes:2747050311,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:777}),prepareMaster:async()=>{throw Error('Render não deve iniciar');}});
  await h.ready();h.started.resolve(10050);h.queue([h.command('start')]);await h.controller.poll();h.queue([h.command('stop','stop',2)]);await h.controller.poll();await tick();
  const receipt=h.calls.find(call=>call.action==='ack'&&call.body.commandId==='stop').body.result;
  assert.equal(receipt.ok,true);assert.equal(receipt.metadata,undefined);assert.equal(receipt.state.capabilities.localTakeStorage,1);
  assert.equal(receipt.state.localTakes[0].metadata.bytes,2747050311);assert.equal(receipt.state.localTakes[0].metadata.duration,777);assert.equal(receipt.state.localTakes[0].localSaved,true);
  assert.equal(h.journal().takes[0].sourceMetadata.bytes,2747050311);assert.equal(h.journal().takes[0].metadata,undefined);assert.equal(h.controller.getSnapshot().phase,'ready');
  h.queue([{...h.command('start','start-2',3),payload:{takeId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}]);await h.controller.poll();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,2);assert.equal(h.calls.filter(call=>call.action==='prepare-master'||call.action==='upload').length,0);await h.controller.dispose();
});
test('local-first só prepara/envia por resume_upload explícito e outro REC não espera o worker de render',async()=>{
  const gate=deferred(),entered=deferred(),raw={bytes:6291457,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4};
  const h=harness({localTakeStorage:true,journal:{takes:[{id:takeId,uri:'file:///raw.mov',sourceUri:'file:///raw.mov',sourceMetadata:raw,localSaved:true,localTakeId:'saved',phase:'local_ready'}]},
    prepareMaster:async(_session,take)=>{entered.resolve();await gate.promise;return {uri:`file:///${take.id}-grade-12345678.mp4`,metadata:{...raw,bytes:77,mime:'video/mp4'}};}});
  await h.ready();await tick();assert.equal(h.calls.filter(call=>call.action==='upload'||call.action==='prepare-master').length,0);
  h.queue([h.command('resume_upload','send',1)]);await h.controller.poll();await entered.promise;
  assert.equal(h.calls.find(call=>call.action==='ack'&&call.body.commandId==='send').body.result.ok,true);
  h.started.resolve(10050);h.queue([{...h.command('start','next',2),payload:{takeId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}]);await h.controller.poll();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);gate.resolve();await tick();await tick();
  assert.equal(h.calls.filter(call=>call.action==='upload').length,1);assert.equal(h.calls.find(call=>call.action==='upload').take.sourceMetadata.bytes,raw.bytes);await h.controller.dispose();
});
test('local-first reabrir e repetir ACK STOP conserva cursor antigo sem retomar envio sozinho',async()=>{
  const raw={bytes:2747050311,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:777},uri='file:///raw.mov';
  const h=harness({localTakeStorage:true,journal:{receipts:{oldstop:{ok:true,takeId,state:{localTakes:[]}}},takes:[{id:takeId,uri,sourceUri:uri,sourceMetadata:raw,metadata:raw,localTakeId:'existing',phase:'error',partUrls:{107:'https://private.invalid/resume'}}]}});
  await h.ready();h.queue([h.command('stop','oldstop',1)]);await h.controller.poll();await tick();
  assert.equal(h.calls.filter(call=>call.action==='upload'||call.action==='prepare-master').length,0);assert.equal(h.journal().takes[0].partUrls[107],'https://private.invalid/resume');
  assert.equal(h.controller.getSnapshot().localTakes[0].metadata.duration,777);assert.equal(JSON.stringify(h.controller.getSnapshot().localTakes).includes('file:'),false);await h.controller.dispose();
});
test('reload local-first remove uploading órfão após verificar fonte e preserva bytes, partes e recibos',async()=>{
  const raw={bytes:2747050311,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:777},uri='file:///raw.mov';
  const receipt={ok:true,takeId,uploadState:'uploading',uploadResumedAtServerMs:1234},parts={107:'https://private.invalid/resume'};
  const original={id:takeId,uri,sourceUri:uri,sourceMetadata:raw,metadata:raw,localSaved:true,localTakeId:'existing',phase:'uploading',partUrls:parts,tusUrl:'https://private.invalid/tus'};
  const h=harness({localTakeStorage:true,journal:{receipts:{oldresume:receipt},takes:[original]}});await h.ready();await tick();
  assert.deepEqual(h.journal().takes[0],{...original,phase:'local_ready'});assert.deepEqual(h.journal().receipts,{oldresume:receipt});
  assert.equal(h.calls.filter(call=>call.action==='upload'||call.action==='prepare-master'||call.action==='ack').length,0);
  const state=h.calls.filter(call=>call.action==='heartbeat').at(-1).body.state;
  assert.equal(state.uploading,false);assert.equal(state.processing,false);assert.equal(state.uploadState,'idle');assert.equal(state.recording,false);assert.equal(state.localTakes[0].phase,'local_ready');
  h.started.resolve(10050);h.queue([{...h.command('start','next',1),payload:{takeId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}}]);await h.controller.poll();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);await h.controller.dispose();
});
test('recover durante worker ativo mantém uploading até a conclusão real',async()=>{
  const gate=deferred(),entered=deferred(),raw={bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4};
  let h;h=harness({localTakeStorage:true,journal:{takes:[{id:takeId,uri:'file:///raw.mov',sourceUri:'file:///raw.mov',sourceMetadata:raw,metadata:raw,localSaved:true,localTakeId:'saved',phase:'local_ready'}]},
    upload:async()=>{h.mutateJournal(value=>({...value,takes:value.takes.map(take=>({...take,phase:'uploading'}))}));entered.resolve();await gate.promise;}});
  await h.ready();h.queue([h.command('resume_upload','send',1)]);await h.controller.poll();await entered.promise;
  h.queue([h.command('resume_upload','send-again',2)]);await h.controller.poll();assert.equal(h.journal().takes[0].phase,'uploading');assert.equal(h.controller.getSnapshot().localTakes[0].phase,'uploading');
  gate.resolve();await tick();await tick();assert.equal(h.journal().takes[0].phase,'uploaded');await h.controller.dispose();
});
test('conclusão do worker durante inspect de recuperação não é rebaixada para local_ready',async()=>{
  const uploadGate=deferred(),uploadEntered=deferred(),inspectGate=deferred(),inspectEntered=deferred(),raw={bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4};let waitInspection=false,h;
  h=harness({localTakeStorage:true,journal:{takes:[{id:takeId,uri:'file:///raw.mov',sourceUri:'file:///raw.mov',sourceMetadata:raw,metadata:raw,localSaved:true,localTakeId:'saved',phase:'local_ready'}]},
    inspect:async()=>{if(waitInspection){inspectEntered.resolve();await inspectGate.promise;}return raw;},
    upload:async()=>{h.mutateJournal(value=>({...value,takes:value.takes.map(take=>({...take,phase:'uploading'}))}));uploadEntered.resolve();await uploadGate.promise;}});
  await h.ready();h.queue([h.command('resume_upload','send',1)]);await h.controller.poll();await uploadEntered.promise;
  waitInspection=true;h.queue([h.command('resume_upload','send-again',2)]);const recovery=h.controller.poll();await inspectEntered.promise;
  uploadGate.resolve();await tick();await tick();assert.equal(h.journal().takes[0].phase,'uploaded');inspectGate.resolve();await recovery;
  assert.equal(h.journal().takes[0].phase,'uploaded');assert.equal(h.calls.filter(call=>call.action==='upload').length,1);await h.controller.dispose();
});
test('catálogo wire fica abaixo de 4 KiB e mantém take mais recente; arquivo ausente não vira localSaved',async()=>{
  const raw={bytes:2747050311,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:777};
  const takes=Array.from({length:40},(_,index)=>({id:fastId(index),uri:`file:///raw-${index}.mov`,sourceMetadata:raw,localTakeId:'saved',phase:'local_ready'}));
  const h=harness({localTakeStorage:true,journal:{takes},inspect:async uri=>{if(uri.endsWith('0.mov'))throw Error('Arquivo ausente');return raw;}});await h.ready();
  const catalog=h.controller.getSnapshot().localTakes;assert.ok(catalog.length<=24);assert.ok(new TextEncoder().encode(JSON.stringify(catalog)).byteLength<=4096);
  assert.equal(catalog.at(-1).id,fastId(39));assert.equal(catalog.some(take=>take.id===fastId(0)),false);assert.equal(h.journal().takes[0].localSaved,false);await h.controller.dispose();
});
test('START aguarda hardware RTC pendente; canal rápido recusa controles enquanto o take está ativo',async()=>{
  const gate=deferred();let block=false;
  const h=harness({liveControls:true,configure:configuration=>block&&configuration.pro?.iso===300?gate.promise:undefined});
  h.configuration({resolution:'4k',fps:30,cameraFacing:'back',pro:{autoExposure:false,iso:200,shutterSeconds:1/90}});await h.ready();block=true;
  const adjusting=h.live(fastId(1),{pro:{iso:300}});await tick();assert.equal(h.controller.getSnapshot().state.configurationConfirmed,false);
  h.started.resolve(10050);h.queue([h.command('start')]);const starting=h.controller.poll();await tick();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);
  gate.resolve();const actual=await adjusting;await starting;assert.equal(actual.configuration.pro.iso,300);assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);
  const controls=h.calls.filter(call=>call.action==='configure').length;
  await assert.rejects(h.live(fastId(2),{pro:{iso:400}}),/pronto/);assert.equal(h.calls.filter(call=>call.action==='configure').length,controls);
  await h.controller.dispose();assert.equal(h.hasLiveHandler(),false);
});
test('RTC recusa controles durante upload e depois da troca de conta sem tocar o sensor',async()=>{
  const gate=deferred(),h=harness({liveControls:true,upload:()=>gate.promise,journal:{takes:[{id:takeId,uri:'file:///master.mov',phase:'local_ready',metadata:{bytes:6291457,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}]}});
  await h.ready();await tick();assert.equal(h.controller.getSnapshot().uploading,true);const controls=h.calls.filter(call=>call.action==='configure').length;
  await assert.rejects(h.live(fastId(3),{pro:{iso:200}}),/pronto/);assert.equal(h.calls.filter(call=>call.action==='configure').length,controls);
  gate.resolve();await tick();await tick();h.invalidate();await assert.rejects(h.live(fastId(4),{pro:{iso:200}}),/conexão mudou/);assert.equal(h.calls.filter(call=>call.action==='configure').length,controls);await h.controller.dispose();
});
test('cache RTC mantém 256 alvos e só pula configuração durável com payload coberto',async()=>{
  const h=harness({liveControls:true});await h.ready();
  for(let index=1;index<=257;index++)await h.live(fastId(index),{pro:{iso:index}});
  const controls=h.calls.filter(call=>call.action==='configure').length;
  h.queue([{...h.command('configure',fastId(257),1),payload:{pro:{iso:257}}}]);await h.controller.poll();assert.equal(h.calls.filter(call=>call.action==='configure').length,controls);
  h.queue([{...h.command('configure',fastId(1),2),payload:{pro:{iso:1}}}]);await h.controller.poll();assert.equal(h.calls.filter(call=>call.action==='configure').length,controls+1);
  assert.equal(h.controller.getSnapshot().state.liveConfigurationId,undefined);await h.controller.dispose();
});
test('allowlist RTC aceita somente números físicos finitos, modos compatíveis e grade completa',()=>{
  assert.equal(validRemoteCameraLivePatch({pro:{iso:20,shutterSeconds:1/47,zoom:1.5,autoExposure:false,focusPoint:{x:.2,y:.4,locked:false}}}),true);
  for(const patch of [{pro:{iso:NaN}},{pro:{lensPosition:2}},{pro:{autoExposure:'false'}},{pro:{iso:20,autoExposure:true}},{pro:{redGain:1,temperatureKelvin:5900}},{audioInputId:'usb'},{imageGrade:{preset:'natural'}}])assert.equal(validRemoteCameraLivePatch(patch),false);
});
test('consulta comandos a cada 300ms com um request por ciclo e heartbeat pronto limitado a 3s',async()=>{
  const h=harness({requestLatencyMs:0,nativeState:{previewConnection:'connected'}});await h.ready();
  assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,1);
  for(let i=0;i<10;i++){h.advance(300);await h.controller.poll();}
  const requests=h.calls.filter(call=>['status','heartbeat'].includes(call.action));
  assert.equal(requests.length,11);assert.equal(requests.filter(call=>call.action==='heartbeat').length,2);
  assert.equal(h.calls.filter(call=>call.action==='snapshot').length,4); // Initial, confirmed publication and two heartbeats.
  assert.equal(h.controller.getSnapshot().previewConnected,true);await h.controller.dispose();
});
test('heartbeat entrega configure pendente e ACK confirmado sem esperar outra telemetria',async()=>{
  const h=harness({requestLatencyMs:0});await h.ready();h.advance(3000);
  h.queue([{...h.command('configure'),payload:{pro:{iso:240}}}]);const before=h.calls.length;await h.controller.poll();
  const requests=h.calls.slice(before).filter(call=>['status','heartbeat','ack'].includes(call.action));
  assert.deepEqual(requests.map(call=>call.action),['heartbeat','ack']);assert.equal(h.journal().sequence,1);
  assert.equal(requests[1].body.result.ok,true);assert.equal(requests[1].body.result.state.width,3840);
  h.queue([]);h.advance(300);await h.controller.poll();assert.equal(h.calls.at(-1).action,'status');await h.controller.dispose();
});
test('timer rápido espera configuração inicial e prévia prontas antes de buscar comandos',async()=>{
  const gate=deferred(),h=harness({configure:()=>gate.promise,requestLatencyMs:0});await h.controller.join('opaque-code');
  const preparing=h.controller.cameraReady(h.native);await tick();h.queue([h.command('configure')]);
  h.advance(300);await h.controller.poll();assert.equal(h.calls.filter(call=>['status','heartbeat','ack'].includes(call.action)).length,0);
  h.queue([]);gate.resolve();await preparing;assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,1);
  assert.equal(h.calls.filter(call=>call.action==='configure').length,1);await h.controller.dispose();
});
test('polls rápidos compartilham configure pendente e só executam START depois do ACK',async()=>{
  const gate=deferred();let block=false;const h=harness({configure:()=>block?gate.promise:undefined,requestLatencyMs:0});await h.ready();block=true;
  h.queue([h.command('configure','image',1)]);const adjusting=h.controller.poll();await tick();
  const requests=h.calls.filter(call=>['status','heartbeat'].includes(call.action)).length;
  h.queue([h.command('start','start',2)]);h.advance(300);const repeated=h.controller.poll();await tick();
  assert.equal(h.calls.filter(call=>['status','heartbeat'].includes(call.action)).length,requests);
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);gate.resolve();await Promise.all([adjusting,repeated]);
  h.started.resolve(10050);await h.controller.poll();
  assert.ok(h.calls.findIndex(call=>call.action==='ack'&&call.body.commandId==='image')<h.calls.findIndex(call=>call.action==='native-start'));
  await h.controller.dispose();
});
test('ACK de configure perdido repete receipt integral sem reaplicar hardware',async()=>{
  const h=harness({requestLatencyMs:0});await h.ready();h.queue([h.command('configure')]);h.failAck();
  await h.controller.poll();const receipt=h.journal().receipts.configure;assert.equal(h.journal().sequence,0);
  h.advance(300);await h.controller.poll();assert.equal(h.journal().sequence,1);
  assert.equal(h.calls.filter(call=>call.action==='configure').length,2);
  const receipts=h.calls.filter(call=>call.action==='ack').map(call=>call.body.result);
  assert.deepEqual(receipts,[receipt,receipt]);await h.controller.dispose();
});
test('falha física publica confirmação negativa no ACK e próximo START não reserva take',async()=>{
  let fail=false;const h=harness({configure:()=>{if(fail)throw Error('ISO não confirmado');},requestLatencyMs:0});await h.ready();fail=true;
  h.hardware({configurationConfirmed:false,imageGradeConfirmed:false});h.queue([h.command('configure')]);await h.controller.poll();
  const ack=h.calls.find(call=>call.action==='ack').body.result;assert.equal(ack.ok,false);assert.equal(ack.state.configurationConfirmed,false);
  h.queue([h.command('start','start',2)]);await h.controller.poll();assert.equal(h.journal().takes.length,0);
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);await h.controller.dispose();
});
test('status tardio após cancelar não aplica comandos nem manda ACK ou heartbeat',async()=>{
  const gate=deferred();let block=false;const h=harness({request:action=>block&&action==='status'?gate.promise:undefined,requestLatencyMs:0});await h.ready();block=true;
  h.queue([h.command('configure')]);const run=h.controller.poll();await tick();h.invalidate();const before=h.calls.length;gate.resolve();await run;
  assert.equal(h.calls.length,before);assert.equal(h.calls.filter(call=>call.action==='configure').length,1);
  assert.equal(h.calls.filter(call=>call.action==='ack').length,0);await h.controller.dispose();
});
test('heartbeat com falha tenta novamente no próximo poll e só sucesso reinicia a cadência',async()=>{
  let fail=false;const h=harness({request:action=>{if(fail&&action==='heartbeat'){fail=false;throw Error('Rede indisponível');}},requestLatencyMs:0});await h.ready();
  fail=true;h.advance(3000);await h.controller.poll();assert.match(h.controller.getSnapshot().error,/Rede indisponível/);
  h.advance(300);await h.controller.poll();assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,3);
  h.advance(300);await h.controller.poll();assert.equal(h.calls.at(-1).action,'status');await h.controller.dispose();
});
test('cancelar durante snapshot de heartbeat não publica estado nem inicia outro request',async()=>{
  const gate=deferred();let block=false;const h=harness({snapshot:()=>block?gate.promise:undefined,requestLatencyMs:0});await h.ready();block=true;
  h.advance(3000);const before=h.controller.getSnapshot(),run=h.controller.poll();await tick();h.invalidate();const requests=h.calls.length;gate.resolve();await run;
  assert.equal(h.calls.length,requests);assert.deepEqual(h.controller.getSnapshot(),before);await h.controller.dispose();
});
test('foco imediato atualiza heartbeat sem snapshot atrasado ou segundo heartbeat no mesmo ciclo',async()=>{
  const gate=deferred(),h=harness({focus:()=>gate.promise,requestLatencyMs:0});await h.ready();
  const focused=h.controller.focusLocal({x:.3,y:.5,locked:true});await tick();h.advance(3000);
  const polling=h.controller.poll();await tick();assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,1);
  gate.resolve();await Promise.all([focused,polling]);assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,2);
  assert.equal(h.calls.at(-1).action,'status');assert.equal(h.controller.getSnapshot().state.focusLocked,true);await h.controller.dispose();
});
test('REC conserva heartbeat a cada 1,5s e inclui estado físico confirmado',async()=>{
  const h=harness({requestLatencyMs:0});await h.ready();h.queue([h.command('start')]);h.started.resolve(10050);await h.controller.poll();h.queue([]);
  const before=h.calls.filter(call=>call.action==='heartbeat').length;
  for(let i=0;i<4;i++){h.advance(300);await h.controller.poll();}assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,before);
  h.advance(300);await h.controller.poll();assert.equal(h.calls.filter(call=>call.action==='heartbeat').length,before+1);
  assert.equal(h.calls.at(-1).body.state.recording,true);await h.controller.dispose();
});
test('escolha local publica apenas a entrada nativa confirmada e sincroniza no navegador',async()=>{
  const h=harness({nativeState:selectedAudio()});await h.ready();
  const selected=await h.controller.selectAudioInput('usb');
  assert.equal(selected.audioInput.current.id,'usb');assert.equal(h.controller.getSnapshot().state.configuration.audioInputId,'usb');
  const heartbeat=h.calls.filter(c=>c.action==='heartbeat').at(-1);
  assert.equal(heartbeat.body.state.audioInput.current.id,'usb');assert.equal(heartbeat.body.state.configuration.audioInputId,'usb');
  assert.equal(h.calls.filter(c=>c.action==='native-start').length,0);await h.controller.dispose();
});
test('microfone desconectado impede reservar e começar um take; REC em andamento não aceita troca',async()=>{
  const disconnected={...selectedAudio(),audioInput:{...selectedAudio().audioInput,preferredId:'usb',current:null,confirmed:false,warning:'Microfone desconectado.'}};
  const h=harness({nativeState:disconnected});await h.ready();h.queue([h.command('start')]);await h.controller.poll();
  assert.equal(h.journal().takes.length,0);assert.equal(h.calls.filter(c=>c.action==='native-start').length,0);
  assert.match(h.calls.find(c=>c.action==='ack').body.result.error,/Microfone desconectado/);await h.controller.dispose();
  const rec=harness({nativeState:selectedAudio()});await rec.ready();rec.started.resolve(10050);rec.queue([rec.command('start')]);await rec.controller.poll();
  await assert.rejects(rec.controller.selectAudioInput('usb'),/antes de iniciar/);assert.equal(rec.calls.filter(c=>c.action==='select-audio').length,0);await rec.controller.dispose();
});
test('troca de conta durante ACK de microfone não publica preferência tardia nem heartbeat',async()=>{
  const gate=deferred(),h=harness({nativeState:selectedAudio(),selectAudio:()=>gate.promise});await h.ready();
  const selecting=h.controller.selectAudioInput('usb');await tick();const before=h.controller.getSnapshot(),requests=h.calls.length;
  h.invalidate();gate.resolve();await assert.rejects(selecting,/conexão mudou/);
  assert.deepEqual(h.controller.getSnapshot(),before);assert.equal(h.calls.length,requests);await h.controller.dispose();
});

test('START precisa de journal durável e didStart real; duplicate command reenvia ACK sem outra gravação',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);const gate=h.blockWrite();const run=h.controller.poll();await gate.entered.promise;
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);gate.resolve();await tick();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);assert.equal(h.calls.filter(call=>call.action==='ack').length,0);
  assert.equal(h.journal().takes[0].phase,'reserved');h.started.resolve(10050);await run;
  const ack=h.calls.find(call=>call.action==='ack');assert.equal(ack.body.result.ok,true);assert.equal(ack.body.result.startedAtServerMs,11250);
  await h.controller.poll();assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);
  h.queue([h.command('stop','stop',2)]);await h.controller.poll();await tick();
  const stop=h.calls.find(call=>call.action==='ack'&&call.body.commandId==='stop');assert.equal(stop.body.result.metadata.width,3840);assert.equal(stop.body.result.metadata.duration,4);
  assert.equal(h.journal().takes[0].phase,'uploaded');assert.equal(h.journal().takes[0].metadata.startedAtServerMs,11250);
  assert.ok(h.calls.findIndex(call=>call.action==='save-local')<h.calls.findIndex(call=>call.action==='ack'&&call.body.commandId==='stop'));
  await h.controller.dispose();
});

test('vínculo retoma sessão nova do mesmo navegador sem reenviar QR ou abrir hardware durante discovery',async()=>{
  const h=harness();h.session({id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'});
  assert.equal(await h.controller.resumePairing('controller'),true);
  assert.deepEqual(h.calls.filter(call=>['discover','connect'].includes(call.action)).map(call=>({action:call.action,body:call.body})),[
    {action:'discover',body:{deviceId:'device',controllerId:'controller'}},
    {action:'connect',body:{sessionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',role:'device',clientId:'device'}},
  ]);
  assert.equal(h.controller.getSnapshot().phase,'preparing');assert.equal(h.calls.filter(call=>['join','configure','preview','native-start'].includes(call.action)).length,0);
  await h.controller.cameraReady(h.native);assert.equal(h.controller.getSnapshot().phase,'ready');await h.controller.dispose();
});
test('computador vinculado sem Studio aberto espera sem câmera; vínculo revogado solicita QR',async()=>{
  for(const paired of [true,false]){
    const h=harness({discover:async()=>({ownerId:'owner',paired,controllerId:paired?'controller':null,session:null,commands:[],takes:[],serverAt:new Date().toISOString()})});
    assert.equal(await h.controller.resumePairing('controller'),false);
    assert.equal(h.controller.getSnapshot().phase,paired?'waiting':'unpaired');assert.equal(h.controller.getSnapshot().session,null);
    assert.equal(h.controller.getSnapshot().linkedControllerId,paired?'controller':null);
    assert.deepEqual(h.calls.map(call=>call.action),['discover']);await h.controller.dispose();
  }
});
test('cancelamento/troca de conta durante discovery não conecta a câmera ao resultado tardio',async()=>{
  const gate=deferred(),h=harness({discover:()=>gate.promise});const pending=h.controller.resumePairing('controller');
  h.invalidate();gate.resolve({ownerId:'owner',paired:true,controllerId:'controller',session:{id:sessionId},commands:[],takes:[],serverAt:new Date().toISOString()});
  await assert.rejects(pending,/conexão mudou/);assert.equal(h.calls.filter(call=>call.action==='connect'||call.action==='preview').length,0);await h.controller.dispose();
});
test('desvincular só confirma após servidor e preserva diário/original; falha mantém preview ativo',async()=>{
  for(const accepted of [true,false]){
    const uri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`;
    const h=harness({unpaired:accepted,journal:{takes:[{id:takeId,uri,phase:'reserved'}]}});await h.controller.join('opaque-code');await h.controller.cameraReady(h.native);await tick();
    const before=h.journal();
    if(accepted){await h.controller.unpair('controller');assert.equal(h.controller.getSnapshot().phase,'unpaired');assert.equal(h.calls.filter(call=>call.action==='disconnect-preview').length,1);}
    else{await assert.rejects(h.controller.unpair('controller'),/não confirmou a desvinculação/);assert.equal(h.calls.filter(call=>call.action==='disconnect-preview').length,0);assert.equal(h.controller.getSnapshot().previewConnected,true);}
    assert.deepEqual(h.journal(),before);assert.equal(h.journal().takes[0].uri,uri);await h.controller.dispose();
  }
});
test('desvincular durante REC não envia mutation ou interrompe original',async()=>{
  const h=harness({unpaired:true});await h.ready();h.queue([h.command('start')]);h.started.resolve(10050);await h.controller.poll();
  await assert.rejects(h.controller.unpair('controller'),/Finalize o take/);assert.equal(h.calls.filter(call=>call.action==='unpair'||call.action==='disconnect-preview').length,0);
  await h.controller.dispose();
});
test('resposta de ACK perdida conserva receipt e cursor para retry idempotente',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);h.failAck();h.started.resolve(10040);await h.controller.poll();
  assert.equal(h.journal().sequence,0);assert.equal(h.journal().receipts.start.ok,true);
  await h.controller.poll();assert.equal(h.journal().sequence,1);assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);
  h.queue([h.command('stop','stop',2)]);await h.controller.poll();await h.controller.dispose();
});
test('blur/conta trocada antes da reserva confirmar não abre câmera nem manda ACK',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);const gate=h.blockWrite();const run=h.controller.poll();await gate.entered.promise;
  h.invalidate();gate.resolve();await run;assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);assert.equal(h.calls.filter(call=>call.action==='ack').length,0);
  await h.controller.dispose();
});
test('reconexão da prévia não para o master; teardown interrompe e preserva original da mesma operação',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);h.started.resolve(10050);await h.controller.poll();
  await h.controller.reconnectPreview();assert.equal(h.calls.filter(call=>call.action==='native-stop').length,0);assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);
  h.invalidate();await h.controller.dispose();assert.equal(h.journal().takes[0].phase,'local_ready');assert.equal(h.journal().takes[0].metadata.bytes,6291457);
  assert.equal(h.calls.filter(call=>call.action==='upload').length,0);assert.equal(h.calls.filter(call=>call.action==='save-local').length,0);
});
test('botão e poll reconectam a prévia pelo mesmo trabalho sem duplicar sala ou interromper master',async()=>{
  const gate=deferred(),entered=deferred();let block=false;
  const h=harness({request:async action=>{if(block&&action==='connect'){entered.resolve();await gate.promise;}}});await h.ready();h.calls.length=0;
  h.hardware({previewConnection:'disconnected'});block=true;
  const manual=h.controller.reconnectPreview();await entered.promise;h.advance(3000);const polling=h.controller.poll();await tick();
  assert.equal(h.controller.getSnapshot().previewConnected,false);assert.equal(h.calls.filter(call=>call.action==='connect').length,1);
  h.hardware({previewConnection:'connected'});gate.resolve();await Promise.all([manual,polling]);
  assert.equal(h.calls.filter(call=>call.action==='disconnect-preview').length,1);assert.equal(h.calls.filter(call=>call.action==='preview').length,1);
  assert.equal(h.calls.filter(call=>call.action==='native-start'||call.action==='native-stop'||call.action==='upload').length,0);
  assert.equal(h.controller.getSnapshot().previewConnected,true);await h.controller.dispose();
});
test('dispose durante desconexão invalida reconexão pendente antes de reabrir a prévia',async()=>{
  const gate=deferred(),entered=deferred();let block=false;
  const h=harness({disconnect:async()=>{if(block){entered.resolve();await gate.promise;}}});await h.ready();h.calls.length=0;block=true;
  const reconnect=h.controller.reconnectPreview(),rejected=assert.rejects(reconnect,/câmera mudou|conexão mudou/i);await entered.promise;
  const disposing=h.controller.dispose();gate.resolve();await Promise.all([rejected,disposing]);
  assert.equal(h.calls.filter(call=>call.action==='preview').length,0);assert.equal(h.calls.filter(call=>call.action==='native-stop').length,0);
});
test('preview sem conexão confirmada não vira conectado e pode ser retomado sem repetir gravação',async()=>{
  const h=harness();await h.ready();h.hardware({previewConnection:'disconnected'});
  await assert.rejects(h.controller.reconnectPreview(),/não confirmou/);assert.equal(h.controller.getSnapshot().previewConnected,false);
  h.hardware({previewConnection:'connected'});await h.controller.reconnectPreview();assert.equal(h.controller.getSnapshot().previewConnected,true);
  assert.equal(h.calls.filter(call=>call.action==='native-start'||call.action==='native-stop').length,0);await h.controller.dispose();
});
test('conexão inicial consulta estado publicado antes de liberar a prévia e reconexão não duplica preparo',async()=>{
  const gate=deferred(),entered=deferred();let block=true;
  const h=harness({nativeState:{previewConnection:'disconnected'},preview:async()=>{if(block){entered.resolve();await gate.promise;}}});
  await h.controller.join('opaque-code');const preparing=h.controller.cameraReady(h.native);await entered.promise;await h.controller.reconnectPreview();
  assert.equal(h.calls.filter(call=>call.action==='connect').length,0);gate.resolve();await preparing;
  assert.equal(h.controller.getSnapshot().phase,'error');assert.equal(h.controller.getSnapshot().previewConnected,false);
  block=false;h.hardware({previewConnection:'connected'});await h.controller.reconnectPreview();assert.equal(h.controller.getSnapshot().previewConnected,true);await h.controller.dispose();
});
test('preparo antigo concluído depois da troca de porta não publica erro ou reabre a câmera anterior',async()=>{
  const entered=deferred(),gate=deferred();let block=true;
  const h=harness({configure:async()=>{if(block){entered.resolve();await gate.promise;}}});await h.controller.join('opaque-code');
  const old=h.controller.cameraReady(h.native);await entered.promise;await h.controller.disconnect();
  const states=[],unsubscribe=h.controller.subscribe(value=>states.push(value));block=false;await h.controller.resume(sessionId);
  const replacement=h.controller.cameraReady({...h.native});gate.resolve();await Promise.all([old,replacement]);
  assert.equal(states.some(value=>value.phase==='error'||value.error),false);assert.equal(h.controller.getSnapshot().phase,'ready');
  assert.equal(h.calls.filter(call=>call.action==='preview').length,1);assert.equal(h.calls.some(call=>call.action==='heartbeat'&&call.body.state.error),false);
  unsubscribe();await h.controller.dispose();
});
test('retomar câmera não herda Promise de reconexão anterior nem perde novo trabalho no finally antigo',async()=>{
  const oldEntered=deferred(),oldGate=deferred(),newEntered=deferred(),newGate=deferred();let holdOld=false,holdNew=false;
  const h=harness({request:async action=>{if(holdOld&&action==='connect'){holdOld=false;oldEntered.resolve();await oldGate.promise;}},
    preview:async()=>{if(holdNew){newEntered.resolve();await newGate.promise;}}});await h.ready();holdOld=true;
  const old=h.controller.reconnectPreview(),rejected=assert.rejects(old,/câmera mudou/);await oldEntered.promise;
  await h.controller.disconnect();await h.controller.resume(sessionId);await h.controller.cameraReady({...h.native});holdNew=true;
  const replacement=h.controller.reconnectPreview();await newEntered.promise;oldGate.resolve();await rejected;
  const connects=h.calls.filter(call=>call.action==='connect').length,duplicate=h.controller.reconnectPreview();await tick();
  assert.equal(h.calls.filter(call=>call.action==='connect').length,connects);newGate.resolve();await Promise.all([replacement,duplicate]);
  assert.equal(h.controller.getSnapshot().previewConnected,true);assert.equal(h.controller.getSnapshot().error,null);await h.controller.dispose();
});
test('restart recupera arquivo reservado sem repetir REC ou inventar horário de início',async()=>{
  const uri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`;
  const h=harness({journal:{takes:[{id:takeId,uri,phase:'reserved'}]}});await h.ready();await tick();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);assert.equal(h.journal().takes[0].metadata.startedAtServerMs,undefined);
  assert.equal(h.journal().takes[0].phase,'uploaded');assert.equal(h.calls.find(call=>call.action==='upload').take.uri,uri);await h.controller.dispose();
});
test('STOP de take diferente não encerra outra operação e produz falha explícita',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);h.started.resolve(10050);await h.controller.poll();
  const stop={...h.command('stop','wrong-stop',2),payload:{takeId:'different'}};h.queue([stop]);await h.controller.poll();
  assert.equal(h.calls.find(call=>call.action==='ack'&&call.body.commandId==='wrong-stop').body.result.ok,false);assert.equal(h.calls.filter(call=>call.action==='native-stop').length,0);
  h.queue([]);await h.controller.stopLocal();await h.controller.dispose();
});

test('connect usa clientId e configure parcial conserva resolução/FPS/câmera e demais ajustes PRO',async()=>{
  const h=harness();h.configuration({resolution:'4k',fps:30,cameraFacing:'back',pro:{iso:120,autoFocus:false,lensPosition:0.5}});
  await h.controller.resume(sessionId);const resume=h.calls.find(call=>call.action==='connect');assert.equal(resume.body.clientId,'device');assert.equal(resume.body.deviceId,undefined);
  await h.controller.cameraReady(h.native);h.queue([{...h.command('configure'),payload:{pro:{iso:250}}}]);await h.controller.poll();
  const request=h.calls.filter(call=>call.action==='configure').at(-1);
  assert.deepEqual(request.configuration,{resolution:'4k',fps:30,cameraFacing:'back',pro:{iso:250,autoFocus:false,lensPosition:0.5}});
  await h.controller.reconnectPreview();assert.ok(h.calls.filter(call=>call.action==='connect').every(call=>call.body.clientId==='device'&&!('deviceId'in call.body)));
  await h.controller.dispose();
});
test('recuperação usa somente status, sem nova conexão/Premium/permissão, e repete cópia local que falhou',async()=>{
  let fails=true;const uri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`;
  const h=harness({saveFail:()=>fails,journal:{takes:[{id:takeId,uri,phase:'local_ready',metadata:{bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}]}});
  await h.controller.recoverLocal(sessionId);assert.equal(h.calls.filter(call=>['join','connect','native-start','configure','preview'].includes(call.action)).length,0);
  assert.equal(h.journal().takes[0].localTakeId,undefined);assert.equal(h.journal().takes[0].phase,'uploaded');
  fails=false;await h.controller.retryUploads();assert.equal(h.journal().takes[0].localTakeId,'local-take');assert.equal(h.calls.filter(call=>call.action==='upload').length,1);
  await h.controller.dispose();
});
test('ACK perdido e término sem STOP conservam horário e parcial sem liberar envio automático',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);h.failAck();h.started.resolve(10050);await h.controller.poll();
  h.finished.resolve({uri:`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`});await tick();
  assert.equal(h.calls.filter(call=>call.action==='upload').length,0);await h.controller.poll();await tick();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);assert.equal(h.calls.filter(call=>call.action==='upload').length,0);
  assert.equal(h.journal().takes[0].recordingEnd.interrupted,true);assert.equal(h.journal().takes[0].metadata.startedAtServerMs,11250);await h.controller.dispose();
});

test('heartbeat conserva bytes/ID do envio e erro pausado sanitizado, só completa após servidor confirmar',async()=>{
  const gate=deferred();let first=true;const uri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`;
  const h=harness({upload:()=>first?gate.promise:undefined,journal:{takes:[{id:takeId,uri,localTakeId:'local-take',phase:'local_ready',metadata:{bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}]}});
  await h.ready();await tick();await h.controller.poll();
  let status=h.calls.filter(call=>call.action==='heartbeat').at(-1).body.state;
  assert.equal(status.uploadState,'uploading');assert.equal(status.uploadProgressBytes,5);assert.equal(status.uploadTakeId,takeId);assert.equal(status.uploading,true);
  gate.reject(Error('Envio perdeu conexão file:///private/master.mov'));await tick();await h.controller.poll();
  status=h.calls.filter(call=>call.action==='heartbeat').at(-1).body.state;assert.equal(status.uploadState,'paused');assert.equal(status.uploading,false);assert.ok(!status.uploadError.includes('file:'));
  assert.equal(h.journal().takes[0].phase,'error');assert.ok(!h.journal().takes[0].error.includes('file:'));assert.equal(status.uploadTotalBytes,32);
  first=false;await h.controller.retryUploads();await h.controller.poll();
  status=h.calls.filter(call=>call.action==='heartbeat').at(-1).body.state;assert.equal(status.uploadState,'complete');assert.equal(status.uploadProgressBytes,32);assert.equal(h.journal().takes[0].phase,'uploaded');
  await h.controller.dispose();
});

test('Mac retoma envio por comando com ACK fresco e progresso, preservando original sem repetir REC',async()=>{
  let fails=true;const gate=deferred();const uri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`;
  const h=harness({upload:()=>fails?Promise.reject(Error('HTTP 403; InvalidSignature')):gate.promise,
    journal:{takes:[{id:takeId,uri,localTakeId:'local-take',phase:'local_ready',metadata:{bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}]}});
  await h.ready();await tick();assert.equal(h.controller.getSnapshot().uploadState,'paused');
  fails=false;h.queue([h.command('resume_upload','resume',1)]);await h.controller.poll();await tick();
  const ack=h.calls.find(call=>call.action==='ack'&&call.body.commandId==='resume').body.result;
  assert.equal(ack.ok,true);assert.equal(ack.takeId,takeId);assert.equal(ack.uploadState,'uploading');assert.equal(ack.uploadError,null);
  assert.ok(Number.isFinite(ack.uploadResumedAtServerMs));assert.equal(ack.state.uploadResumedAtServerMs,ack.uploadResumedAtServerMs);
  h.queue([]);h.advance(1500);await h.controller.poll();
  let status=h.calls.filter(call=>call.action==='heartbeat').at(-1).body.state;
  assert.equal(status.uploadResumedAtServerMs,ack.uploadResumedAtServerMs);assert.equal(status.uploadError,null);assert.equal(status.uploadTotalBytes,32);
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,0);assert.equal(h.journal().takes[0].uri,uri);
  await h.controller.poll();assert.equal(h.calls.filter(call=>call.action==='upload').length,2);
  gate.resolve();await tick();await h.controller.poll();status=h.calls.filter(call=>call.action==='heartbeat').at(-1).body.state;
  assert.equal(status.uploadState,'complete');assert.equal(h.journal().takes[0].phase,'uploaded');assert.equal(h.controller.getSnapshot().error,null);
  await h.controller.dispose();
});
test('resume_upload com resposta ACK perdida continua somente após confirmar receipt e não duplica bytes',async()=>{
  let fails=true;const uri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`;
  const h=harness({upload:()=>fails?Promise.reject(Error('Falha de preparo')):undefined,
    journal:{takes:[{id:takeId,uri,localTakeId:'local-take',phase:'local_ready',metadata:{bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}]}});
  await h.ready();await tick();fails=false;h.queue([h.command('resume_upload','resume',1)]);h.failAck();await h.controller.poll();
  assert.equal(h.journal().sequence,0);assert.equal(h.calls.filter(call=>call.action==='upload').length,1);
  const resumedAt=h.journal().receipts.resume.uploadResumedAtServerMs;
  await h.controller.poll();await tick();assert.equal(h.journal().sequence,1);assert.equal(h.calls.filter(call=>call.action==='upload').length,2);
  assert.equal(h.journal().receipts.resume.uploadResumedAtServerMs,resumedAt);assert.equal(h.journal().takes[0].phase,'uploaded');
  await h.controller.dispose();
});
test('retomar envio sem original concluído informa motivo e resume_upload de outro take não faz upload',async()=>{
  const h=harness();await h.ready();await tick();await assert.rejects(h.controller.retryUploads(),/Nenhum original concluído/);
  h.queue([h.command('resume_upload','resume',1)]);await h.controller.poll();
  assert.equal(h.calls.find(call=>call.action==='ack'&&call.body.commandId==='resume').body.result.ok,false);
  assert.equal(h.calls.filter(call=>call.action==='upload').length,0);await h.controller.dispose();
});
test('take concluído durante outro envio entra na mesma fila sem upload concorrente ou ficar pendente',async()=>{
  const firstId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',gate=deferred();let transfers=0,maxTransfers=0;
  const firstUri=`file:///Documents/classfy-studio-remote/owner/${sessionId}/${firstId}.mov`;
  const h=harness({upload:async take=>{transfers++;maxTransfers=Math.max(maxTransfers,transfers);try{if(take.id===firstId)await gate.promise;}finally{transfers--; }},
    journal:{takes:[{id:firstId,uri:firstUri,localTakeId:'first-local',phase:'local_ready',metadata:{bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}]}});
  await h.ready();await tick();assert.equal(h.calls.filter(call=>call.action==='upload').length,1);
  h.queue([h.command('start','start',1)]);h.started.resolve(10050);await h.controller.poll();
  h.queue([h.command('stop','stop',2)]);await h.controller.poll();await tick();assert.equal(h.calls.filter(call=>call.action==='upload').length,1);
  gate.resolve();await tick();await tick();
  assert.deepEqual(h.calls.filter(call=>call.action==='upload').map(call=>call.take.id),[firstId,takeId]);assert.equal(maxTransfers,1);
  assert.ok(h.journal().takes.every(take=>take.phase==='uploaded'));await h.controller.dispose();
});
test('original antigo recusado não impede novo take nem resume_upload direcionado',async()=>{
  const oldId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',uri=id=>`file:///Documents/classfy-studio-remote/owner/${sessionId}/${id}.mov`;
  let failures=0;
  const h=harness({upload:take=>{if(take.id===oldId){failures++;throw Error('Original antigo: HTTP 403');}},
    journal:{takes:[oldId,takeId].map(id=>({id,uri:uri(id),localTakeId:`local-${id}`,phase:'local_ready',metadata:{bytes:32,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}}))}});
  await h.ready();await tick();assert.equal(h.journal().takes.find(take=>take.id===oldId).phase,'error');
  assert.equal(h.journal().takes.find(take=>take.id===takeId).phase,'uploaded');assert.equal(failures,1);assert.equal(h.controller.getSnapshot().uploadPendingCount,1);
  h.queue([h.command('resume_upload','resume',1)]);await h.controller.poll();await tick();
  assert.equal(failures,1);assert.equal(h.calls.find(call=>call.action==='ack'&&call.body.commandId==='resume').body.result.uploadState,'complete');await h.controller.dispose();
});

test('Manual→Auto não envia ISO/obturador, WB/gains ou foco manual incompatíveis ao setter',async()=>{
  const h=harness();h.configuration({resolution:'4k',fps:30,cameraFacing:'back',pro:{autoExposure:false,iso:400,shutterSeconds:1/60,autoWhiteBalance:false,temperatureKelvin:4000,whiteBalanceTint:10,redGain:2,greenGain:1,blueGain:2,autoFocus:false,lensPosition:0.6,zoom:2}});
  await h.ready();h.queue([{...h.command('configure'),payload:{pro:{autoExposure:true,autoWhiteBalance:true,autoFocus:true}}}]);await h.controller.poll();
  assert.deepEqual(h.calls.filter(call=>call.action==='configure').at(-1).configuration.pro,{autoExposure:true,autoWhiteBalance:true,autoFocus:true,zoom:2});await h.controller.dispose();
});

test('toque local foca durante REC sem encerrar take; blur descarta ACK tardio',async()=>{
  const h=harness();await h.ready();await h.controller.focusLocal({x:.3,y:.5,locked:false});
  h.queue([h.command('start')]);const start=h.controller.poll();await tick();h.started.resolve(10050);await start;
  await h.controller.focusLocal({x:.4,y:.6,locked:true});assert.equal(h.controller.getSnapshot().phase,'recording');assert.equal(h.controller.getSnapshot().state.focusLocked,true);
  assert.equal(h.calls.filter(x=>x.action==='native-stop').length,0);await h.controller.dispose();
  const gate=deferred(),late=harness({focus:()=>gate.promise});await late.ready();const pending=late.controller.focusLocal({x:.5,y:.5,locked:false});await tick();late.invalidate();gate.resolve();await assert.rejects(pending,/conexão mudou/);await late.controller.dispose();
});
test('look congelado antesREC conserva clean e só envia derivado preparado commetadatafinal',async()=>{
  const grade={preset:'cinematic',intensity:1,exposure:.5,contrast:.2,saturation:0,temperature:.3},gate=deferred();
  const h=harness({prepareMaster:async(_session,take,onProgress)=>{onProgress(.4,'rendering');await gate.promise;return {uri:take.uri.replace('.mov','-grade-12345678.mp4'),metadata:{bytes:7000000,mime:'video/mp4',width:3840,height:2160,fps:30,duration:4},signature:'12345678'};}});
  h.configuration({resolution:'4k',fps:30,cameraFacing:'back',imageGrade:grade});await h.ready();h.queue([h.command('start')]);const start=h.controller.poll();await tick();h.started.resolve(10050);await start;
  h.configuration({resolution:'4k',fps:30,cameraFacing:'back',imageGrade:{...grade,preset:'natural'}});
  h.queue([h.command('stop','stop',2)]);const stop=h.controller.poll();await tick();await tick();
  assert.deepEqual(h.journal().takes[0].imageGrade,grade);assert.ok(h.journal().takes[0].sourceMetadata);assert.equal(h.journal().takes[0].metadata,undefined);
  assert.equal(h.calls.filter(x=>x.action==='upload').length,0);assert.equal(h.controller.getSnapshot().processing,true);
  gate.resolve();await stop;await tick();const uploaded=h.calls.find(x=>x.action==='upload').take;
  assert.match(uploaded.uri,/-grade-12345678.mp4$/);assert.match(uploaded.sourceUri,/\.mov$/);assert.equal(uploaded.metadata.mime,'video/mp4');assert.equal(uploaded.metadata.width,3840);await h.controller.dispose();
});
test('falha preparando imagem confirmaSTOPfísico semenviarclean e Retomar prepara o mesmo take',async()=>{
  let fail=true;const h=harness({prepareMaster:async(_session,take)=>{if(fail)throw Error('Encoder pausado');return {uri:take.uri.replace('.mov','-grade-12345678.mp4'),metadata:{bytes:7000000,mime:'video/mp4',width:3840,height:2160,fps:30,duration:4}};}});
  await h.ready();h.queue([h.command('start')]);const start=h.controller.poll();await tick();h.started.resolve(10050);await start;h.queue([h.command('stop','stop',2)]);await h.controller.poll();await tick();
  const ack=h.calls.find(x=>x.action==='ack'&&x.body.commandId==='stop').body.result;
  assert.equal(ack.ok,true);assert.equal(ack.metadata,undefined);assert.equal(ack.state.uploadState,'paused');assert.equal(h.controller.getSnapshot().phase,'ready');assert.equal(h.calls.filter(x=>x.action==='upload').length,0);
  fail=false;await h.controller.retryUploads();assert.equal(h.journal().takes.length,1);assert.equal(h.journal().takes[0].phase,'uploaded');assert.match(h.calls.find(x=>x.action==='upload').take.uri,/\.mp4$/);await h.controller.dispose();
});

const interruptedReceipt=(patch={})=>({version:1,operationId:takeId,requestedAtEpochMs:10000,startedAtEpochMs:10050,finishedAtEpochMs:76203.333,mediaDurationSeconds:66.153333,wallDurationSeconds:66.153333,stopReason:'capture_interrupted',interrupted:true,...patch});
test('fim nativo antecipado congela REC antes da inspeção, persiste parcial e comunica sem STOP ou envio',async()=>{
  const inspected=deferred(),entered=deferred(),raw={bytes:234567890,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:66.153333};
  const h=harness({localTakeStorage:true,nativeEnded:true,inspect:async()=>{entered.resolve();return inspected.promise;}});
  await h.ready();h.started.resolve(10050);h.queue([h.command('start')]);await h.controller.poll();
  const receipt=interruptedReceipt();h.advance(67000);h.hardware({recording:false});h.ended.resolve(receipt);await tick();await tick();
  assert.equal(h.controller.getSnapshot().phase,'saving');assert.equal(h.controller.getSnapshot().recordingStartedAtMs,undefined);
  assert.equal(h.controller.getSnapshot().recordingEnd.durationSeconds,66.153333);assert.deepEqual(h.journal().takes[0].captureReceipt,receipt);
  h.finished.resolve({uri:'file:///raw.mov',captureReceipt:receipt});await entered.promise;inspected.resolve(raw);await tick();await tick();await tick();
  assert.equal(h.controller.getSnapshot().phase,'error');assert.match(h.controller.getSnapshot().error,/interrompida/);assert.equal(h.journal().takes[0].sourceMetadata.duration,66.153333);
  assert.equal(h.journal().takes[0].recordingEnd.interrupted,true);assert.equal(h.journal().takes[0].localSaved,true);
  h.queue([]);h.advance(100000);await h.controller.poll();
  const end=h.calls.filter(call=>call.action==='heartbeat'&&call.body.state.recordingEnd).at(-1).body.state;
  assert.equal(end.recording,false);assert.equal(end.recordingEnd.durationSeconds,66.153333);assert.equal(end.localTakes[0].localSaved,true);
  assert.equal(h.calls.filter(call=>['native-stop','upload','prepare-master'].includes(call.action)).length,0);await h.controller.dispose();
});
test('STOP solicitado persiste recibo normal sem anunciar interrupção nem disparar envio',async()=>{
  const h=harness({localTakeStorage:true});await h.ready();h.started.resolve(10050);h.queue([h.command('start')]);await h.controller.poll();
  h.queue([h.command('stop','stop',2)]);await h.controller.poll();await tick();
  assert.equal(h.controller.getSnapshot().phase,'ready');assert.equal(h.controller.getSnapshot().error,null);assert.equal(h.controller.getSnapshot().recordingEnd.interrupted,false);
  assert.equal(h.journal().takes[0].recordingEnd.reason,'user_stop');assert.equal(h.calls.filter(call=>call.action==='upload').length,0);await h.controller.dispose();
});
test('recibo de fim antecipado volta do journal no heartbeat após reabrir sem novo REC ou envio',async()=>{
  const raw={bytes:234567890,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:66.153333};
  const recordingEnd={version:1,takeId,finishedAtServerMs:77403.333,durationSeconds:raw.duration,reason:'capture_interrupted',interrupted:true};
  const h=harness({localTakeStorage:true,journal:{takes:[{id:takeId,uri:'file:///raw.mov',sourceUri:'file:///raw.mov',sourceMetadata:raw,localSaved:true,localTakeId:'old',phase:'local_ready',recordingEnd}]}});
  await h.ready();const heartbeat=h.calls.find(call=>call.action==='heartbeat'&&call.body.state.recordingEnd);
  assert.deepEqual(heartbeat.body.state.recordingEnd,recordingEnd);assert.equal(heartbeat.body.state.recording,false);assert.equal(heartbeat.body.state.localTakes[0].metadata.duration,raw.duration);
  assert.equal(h.calls.filter(call=>['native-start','native-stop','upload','prepare-master'].includes(call.action)).length,0);await h.controller.dispose();
});

test('recupera sidecar após perda do bridge com relógio monotônico e inspeção real, sem REC ou envio',async()=>{
  const raw={bytes:234567890,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:66.153333},receipt=interruptedReceipt({finishedAtEpochMs:999999,wallDurationSeconds:66.153333});
  const h=harness({localTakeStorage:true,readCaptureReceipt:async(id,take)=>{assert.equal(id,sessionId);assert.equal(take,takeId);return receipt;},inspect:async()=>raw,journal:{takes:[{id:takeId,uri:'file:///raw.mov',sourceUri:'file:///raw.mov',sourceMetadata:raw,startedAtServerMs:11250,phase:'recording'}]}});
  await h.ready();const restored=h.journal().takes[0];assert.deepEqual(restored.captureReceipt,receipt);assert.equal(restored.recordingEnd.finishedAtServerMs,77403.333);assert.equal(restored.recordingEnd.durationSeconds,raw.duration);
  assert.equal(restored.localSaved,true);assert.ok(h.calls.some(call=>call.action==='heartbeat'&&call.body.state.recordingEnd?.takeId===takeId));
  assert.equal(h.calls.filter(call=>['native-start','native-stop','upload'].includes(call.action)).length,0);await h.controller.dispose();
});
test('sidecar sem início confiável ou fonte inválida não cria confirmação de término nem libera REC',async()=>{
  for(const noClock of [true,false]){
    const raw={bytes:100,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:66};
    const h=harness({localTakeStorage:true,readCaptureReceipt:async()=>interruptedReceipt(),inspect:async()=>{if(!noClock)throw Error('Raw incompleto');return raw;},journal:{takes:[{id:takeId,uri:'file:///raw.mov',sourceMetadata:raw,...(!noClock?{startedAtServerMs:11250}:{}),phase:'recording'}]}});
    await h.ready();assert.equal(h.journal().takes[0].recordingEnd,undefined);assert.equal(h.controller.getSnapshot().recordingEnd,undefined);
    assert.equal(h.calls.filter(call=>call.action==='native-start'||call.action==='upload').length,0);await h.controller.dispose();
  }
});
test('snapshot START atrasado não volta a REC depois do término físico enquanto AVAsset inspeciona',async()=>{
  const gate=deferred(),entered=deferred();let snapshots=0;
  const h=harness({localTakeStorage:true,nativeEnded:true,snapshot:async()=>{if(++snapshots===5){entered.resolve();await gate.promise;}}});
  await h.ready();h.started.resolve(10050);h.queue([h.command('start')]);const start=h.controller.poll();await entered.promise;
  h.ended.resolve(interruptedReceipt());await tick();await tick();assert.equal(h.controller.getSnapshot().phase,'saving');
  gate.resolve();await start;assert.notEqual(h.controller.getSnapshot().phase,'recording');assert.equal(h.controller.getSnapshot().recordingStartedAtMs,undefined);
  h.finished.resolve({uri:'file:///raw.mov',captureReceipt:interruptedReceipt()});await tick();await tick();await h.controller.dispose();
});
