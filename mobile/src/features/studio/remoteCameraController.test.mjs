import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteCameraController} from './remoteCameraController.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const sessionId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',takeId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function harness(patch={}){
  let current=true,time=10000,commands=[],failAck=false,writeGate,actualRecording=false;
  let journal={version:1,owner:'owner',deviceId:'device',sessionId,sequence:0,receipts:{},takes:[],...patch.journal};
  const started=deferred(),finished=deferred(),calls=[],writes=[];
  const session={id:sessionId,ownerId:'owner',controllerId:'controller',deviceId:'device',kind:'aula',status:'ready',configuration:{resolution:'4k',fps:30,cameraFacing:'back'}};
  const clone=value=>structuredClone(value);
  const request=async(action,body)=>{
    calls.push({action,body:clone(body)});if(action==='ack'&&failAck){failAck=false;throw Error('Resposta desconhecida');}
    if(action==='unpair'&&patch.unpairError)throw Error(patch.unpairError);
    if(action==='status')time+=20;
    return{session:clone(session),commands:clone(commands),takes:[],serverAt:new Date(time+1200).toISOString(),
      ...(action==='unpair'?{unpaired:patch.unpaired===true}:{}),
      ...(['join','connect'].includes(action)?{connection:{url:'wss://private.invalid',token:'not-a-real-token',identity:'device'}}:{})};
  };
  const deps={owner:'owner',deviceId:'device',current:()=>current,now:()=>time,request,journal:async()=>clone(journal),
    discover:async controllerId=>{calls.push({action:'discover',body:{deviceId:'device',...(controllerId?{controllerId}:{})}});return patch.discover?await patch.discover():{ownerId:'owner',paired:true,controllerId:'controller',session:clone(session),commands:[],takes:[],serverAt:new Date(time+1200).toISOString()};},
    mutate:async(_id,change)=>{if(writeGate){const gate=writeGate;writeGate=undefined;gate.entered.resolve();await gate.promise;}journal=change(clone(journal));writes.push(clone(journal));return clone(journal);},
    masterUri:(_session,id)=>`file:///Documents/classfy-studio-remote/owner/${sessionId}/${id}.mov`,
    inspect:async uri=>{calls.push({action:'inspect',uri});return{bytes:6291457,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4};},
    saveLocal:async(_session,take)=>{calls.push({action:'save-local',take:clone(take)});if(patch.saveFail?.())throw Error('Disco indisponível');return{projectId:'project',localTakeId:'local-take'};},
    upload:async(_session,take,onProgress)=>{calls.push({action:'upload',take:clone(take)});onProgress?.(5);await patch.upload?.(take);},
  };
  const native={configure:async configuration=>{calls.push({action:'configure',configuration});return{width:3840,height:2160,fps:30,recording:false};},
    snapshot:async()=>({width:3840,height:2160,fps:30,recording:actualRecording}),
    begin:id=>{calls.push({action:'native-start',id});actualRecording=true;return{started:started.promise,finished:finished.promise};},
    stop:async id=>{calls.push({action:'native-stop',id});actualRecording=false;finished.resolve({uri:`file:///Documents/classfy-studio-remote/owner/${sessionId}/${id}.mov`});},
    preview:async()=>{calls.push({action:'preview'});},disconnect:async()=>{calls.push({action:'disconnect-preview'});}};
  const controller=createRemoteCameraController(deps);
  const command=(type,id=type,sequence=1)=>({id,sequence,type,payload:type==='configure'?session.configuration:{takeId},status:'pending'});
  return{controller,calls,writes,started,finished,native,command,
    configuration:value=>{session.configuration=value;},session:value=>Object.assign(session,value),journal:()=>clone(journal),queue:values=>{commands=values;},invalidate:()=>{current=false;},failAck:()=>{failAck=true;},
    blockWrite:()=>{const gate=deferred();gate.entered=deferred();writeGate=gate;return gate;},
    ready:async()=>{await controller.join('opaque-code');await controller.cameraReady(native);},
  };
}

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
test('ACK perdido após take terminar conserva horário e libera envio quando receipt de START é confirmado',async()=>{
  const h=harness();await h.ready();h.queue([h.command('start')]);h.failAck();h.started.resolve(10050);await h.controller.poll();
  h.finished.resolve({uri:`file:///Documents/classfy-studio-remote/owner/${sessionId}/${takeId}.mov`});await tick();
  assert.equal(h.calls.filter(call=>call.action==='upload').length,0);await h.controller.poll();await tick();
  assert.equal(h.calls.filter(call=>call.action==='native-start').length,1);assert.equal(h.calls.filter(call=>call.action==='upload').length,1);
  assert.equal(h.journal().takes[0].metadata.startedAtServerMs,11250);await h.controller.dispose();
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
