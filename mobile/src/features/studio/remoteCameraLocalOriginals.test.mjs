import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import * as protocol from './remoteCameraProtocol.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',device='cccccccc-cccc-4ccc-8ccc-cccccccccccc',takeId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherSession='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const metadata={bytes:2747050311,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:777};
function compile(file,deps){const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,module={exports:{}};
  new Function('require','module','exports',code)(name=>{if(!(name in deps))throw Error(`Unexpected dependency ${name}`);return deps[name];},module,module.exports);return module.exports;}
function harness(){
  const disk=new Map(),files=new Map(),calls=[];let current=true,shareAction='shared',captured,thumbnailDependencies;
  const storage={getItem:async key=>disk.get(key)||null,setItem:async(key,value)=>disk.set(key,value),getAllKeys:async()=>[...disk.keys()]};
  const fs={documentDirectory:'file:///current/Documents/',getInfoAsync:async uri=>{calls.push({kind:'stat',uri});return files.has(uri)?{exists:true,size:files.get(uri)}:{exists:false};},readAsStringAsync:()=>{throw Error('Não carregar MOV inteiro');},copyAsync:()=>{throw Error('Não copiar MOV');},deleteAsync:()=>{throw Error('Não apagar original');}};
  const journal=compile('./remoteCameraJournal.ts',{'./remoteCameraProtocol':protocol,'@react-native-async-storage/async-storage':storage,'expo-file-system/legacy':fs});
  const store=compile('./store.ts',{'@react-native-async-storage/async-storage':storage,'expo-crypto':{randomUUID:()=> 'ffffffff-ffff-4fff-8fff-ffffffffffff'},'expo-file-system/legacy':fs,'./model':model});
  const runtime=compile('./remoteCameraRuntime.ts',{'@react-native-async-storage/async-storage':storage,'expo-file-system/legacy':fs,'expo-crypto':{randomUUID:()=>device},
    'react-native':{NativeModules:{},Share:{sharedAction:'shared',share:async value=>{calls.push({kind:'share',value});return {action:shareAction};}}},
    '@/features/live/request':{},'../../../modules/classfy-studio-media':{},'./remoteCameraController':{createRemoteCameraController:deps=>{captured=deps;return{};}},
    './remoteCameraApi':{assertRemoteCameraScope:scope=>{if(scope.isCurrent?.()===false)throw Error('Sessão mudou');}},'./model':model,'./remoteCameraGrade':{prepareRemoteCameraGradedMaster:()=>{throw Error('Não renderizar automaticamente');}},
    './remoteCameraJournal':journal,'./store':store,'./media':{persistStudioTake:()=>{throw Error('Não copiar original remoto');}},'./uploadTransport':{},'./remoteCameraUpload':{},
    './remoteCameraThumbnail':{},'./remoteCameraThumbnailQueue':{createRemoteThumbnailQueue:deps=>{thumbnailDependencies=deps;return {schedule(){},pause(){},dispose(){}};}}});
  const client=runtime.createRemoteCameraRuntime(owner,device,{isCurrent:()=>current});
  async function saved(sessionId=session,patch={}){const uri=journal.remoteMasterUri(owner,sessionId,takeId),take={id:takeId,uri,sourceUri:uri,sourceMetadata:metadata,phase:'local_ready',localSaved:true,...patch};files.set(uri,metadata.bytes);
    await journal.mutateRemoteCameraJournal(owner,sessionId,device,value=>({...value,takes:[take]}));return take;}
  return {runtime,client,journal,store,disk,files,calls,saved,deps:()=>captured,thumbnails:()=>thumbnailDependencies,dismiss:()=>{shareAction='dismissed';},invalidate:()=>{current=false;}};
}
test('descoberta de miniaturas limita24 recentes entre sessões e não toca MOV/catálogo heartbeat',async()=>{
  const h=harness();await h.saved(otherSession,{startedAtServerMs:1});
  const takes=Array.from({length:30},(_,i)=>{const id=`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,uri=h.journal.remoteMasterUri(owner,session,id);
    return {id,uri,sourceMetadata:metadata,phase:'local_ready',localSaved:true,startedAtServerMs:i+2,...(i===29?{thumbnail:{version:1,mime:'image/jpeg',width:320,height:180,bytes:80,hash:'a'.repeat(64)}}:{})};});
  await h.journal.mutateRemoteCameraJournal(owner,session,device,value=>({...value,takes}));
  const jobs=await h.thumbnails().list();assert.equal(jobs.length,23);assert.equal(jobs[0].takeId,takes[28].id);assert.ok(jobs.every(job=>job.sessionId===session));assert.deepEqual(h.calls,[]);
  await h.journal.mutateRemoteCameraJournal(owner,session,device,value=>({...value,takes:value.takes.slice(-2)}));
  const historical=await h.thumbnails().list();assert.ok(historical.some(job=>job.sessionId===otherSession));assert.deepEqual(h.calls,[]);
});
test('recibo de miniatura só vai ao journal do take/fonte corretos e cancelamento não grava recibo tardio',async()=>{
  const h=harness(),take=await h.saved(otherSession),thumbnail={version:1,mime:'image/jpeg',width:320,height:180,bytes:80,hash:'a'.repeat(64)},job={sessionId:otherSession,takeId,metadata,sourceUri:take.uri};
  await h.thumbnails().remember(job,thumbnail,{check(){}});assert.deepEqual((await h.journal.readRemoteCameraJournal(owner,otherSession,device)).takes[0].thumbnail,thumbnail);
  const before=[...h.disk.entries()];await assert.rejects(h.thumbnails().remember(job,{...thumbnail,hash:'b'.repeat(64)},{check(){throw Error('Novo REC');}}),/Novo REC/);assert.deepEqual([...h.disk.entries()],before);
  await assert.rejects(h.thumbnails().remember({...job,metadata:{...metadata,bytes:1}},thumbnail,{check(){}}),/original.*mudou/);assert.deepEqual([...h.disk.entries()],before);
});
test('STOP registra original de 2,7 GB no projeto sem copiar, renderizar ou ler bytes; look continua reversível',async()=>{
  const h=harness(),grade={preset:'cinematic',intensity:.7,exposure:-.5,contrast:.2,saturation:0,temperature:.3},take=await h.saved(session,{imageGrade:grade});
  assert.equal(h.deps().localTakeStorage,true);const saved=await h.deps().saveLocal({id:session,kind:'aula',title:'Aula longa'},take);
  const project=h.store.getStudioProject(owner,saved.projectId);assert.equal(project.takes.length,1);assert.equal(project.takes[0].uri,take.sourceUri);assert.equal(project.takes[0].duration,777);assert.deepEqual(project.takes[0].grade,grade);
  assert.deepEqual(h.calls,[]);assert.equal((await h.journal.readRemoteCameraJournal(owner,session,device)).takes[0].sourceMetadata.bytes,2747050311);
});
test('registro repetido conserva projeto existente e seus cortes sem duplicar o take',async()=>{
  const h=harness(),take=await h.saved(),sessionValue={id:session,kind:'aula'},saved=await h.deps().saveLocal(sessionValue,take);
  await h.journal.mutateRemoteCameraJournal(owner,session,device,value=>({...value,takes:value.takes.map(item=>({...item,...saved}))}));
  await h.store.mutateStudioProject(owner,saved.projectId,value=>({takes:value.takes.map(item=>({...item,start:10,end:750}))}));
  await h.deps().saveLocal(sessionValue,take);const project=h.store.getStudioProject(owner,saved.projectId);
  assert.equal(project.takes.length,1);assert.equal(project.takes[0].start,10);assert.equal(project.takes[0].end,750);
});
test('biblioteca reabre várias sessões, conserva erro e filtra outro proprietário e device',async()=>{
  const h=harness();await h.saved(session,{phase:'uploaded'});await h.saved(otherSession,{phase:'error',error:'Esta operação de live foi cancelada.'});
  const foreign=JSON.stringify({version:1,owner:device,sessionId:otherSession,deviceId:device,sequence:0,receipts:{},takes:[]});h.disk.set(`classfy:remote-camera:v1:${device}:${otherSession}`,foreign);
  h.disk.set(`classfy:remote-camera:v1:${owner}:${device}`,JSON.stringify({version:1,owner,sessionId:device,deviceId:owner,sequence:0,receipts:{},takes:[]}));
  const all=await h.runtime.listRemoteCameraOriginals(owner,device);assert.equal(all.length,2);assert.ok(all.every(take=>take.available));assert.ok(all.some(take=>take.error?.includes('transferência foi pausada')));
  assert.equal(JSON.stringify(all).includes('file:'),false);assert.ok(all.some(take=>take.phase==='uploaded'));assert.equal(h.calls.filter(call=>call.kind==='stat').length,2);
});
test('arquivo ausente continua visível para recuperação e compartilhar não abre arquivo inexistente',async()=>{
  const h=harness(),take=await h.saved();h.files.delete(take.uri);
  const list=await h.client.listLocalOriginals();assert.equal(list.length,1);assert.equal(list[0].available,false);assert.match(list[0].error,/não foi encontrado/);
  await assert.rejects(h.client.shareOriginal(session,takeId),/não foi encontrado/);assert.equal(h.calls.filter(call=>call.kind==='share').length,0);
});
test('Share usa original intacto; cancelar mantém diário e recibos, sem exportar',async()=>{
  const h=harness(),take=await h.saved(session,{phase:'error',partUrls:{0:'https://private.invalid/part'}}),before=[...h.disk.entries()];h.dismiss();
  assert.equal(await h.client.shareOriginal(session,takeId),false);assert.deepEqual(h.calls.find(call=>call.kind==='share').value,{url:take.sourceUri});assert.deepEqual([...h.disk.entries()],before);
  h.invalidate();await assert.rejects(h.client.shareOriginal(session,takeId),/Sessão mudou/);
});
test('remover projeto apaga apenas índice e mantém original/journal compartilhável de outra conexão',async()=>{
  const h=harness(),take=await h.saved(otherSession),saved=await h.deps().saveLocal({id:otherSession,kind:'aula'},take);
  assert.equal((await h.client.listLocalOriginals())[0].inProject,true);
  await h.store.removeStudioProject(owner,saved.projectId);assert.equal(h.store.getStudioProject(owner,saved.projectId),undefined);
  const list=await h.client.listLocalOriginals();assert.equal(list.length,1);assert.equal(list[0].inProject,false);assert.equal(await h.client.shareOriginal(otherSession,takeId),true);assert.equal(h.files.get(take.uri),2747050311);
});
test('dois takes nos projetos e sete históricos aparecem em grupos distintos sem renumerar nove ativos',async()=>{
  const h=harness(),project=await h.store.createStudioProject(owner,'aula');
  const takes=Array.from({length:9},(_,index)=>{const id=`11111111-1111-4111-8111-${String(index).padStart(12,'0')}`,uri=h.journal.remoteMasterUri(owner,session,id);h.files.set(uri,metadata.bytes);return {id,uri,sourceUri:uri,sourceMetadata:metadata,phase:'local_ready',projectId:project.id,localTakeId:id};});
  await h.journal.mutateRemoteCameraJournal(owner,session,device,value=>({...value,projectId:project.id,takes}));
  await h.store.mutateStudioProject(owner,project.id,()=>({title:'Meus dois takes',takes:takes.slice(0,2).map(take=>({id:take.id,uri:take.uri,name:'Take',duration:metadata.duration,start:0,end:metadata.duration,width:3840,height:2160}))}));
  const list=await h.client.listLocalOriginals();assert.equal(list.filter(take=>take.inProject).length,2);assert.equal(list.filter(take=>!take.inProject).length,7);
  const jsx=(type,props)=>({type,props:props||{}}),ui=compile('./StudioRemoteLocalTakes.tsx',{'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'react-native':{ActivityIndicator:'spinner',Modal:'modal',Pressable:'button',ScrollView:'scroll',StyleSheet:{create:value=>value},Text:'text',View:'view'},'./remoteCameraMonitorLayout':{remoteCameraModalOrientations:['portrait','landscape-left','landscape-right']}});
  const tree=ui.StudioRemoteLocalTakes({visible:true,takes:list,sharing:null,error:'',onClose(){},onShare(){}}),nodes=[];
  const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'){nodes.push(value);visit(value.props?.children);}};visit(tree);
  const text=value=>Array.isArray(value)?value.map(text).join(''):value&&typeof value==='object'?text(value.props?.children):value??'';
  const labels=nodes.filter(node=>node.type==='button').map(node=>node.props.accessibilityLabel||'');
  assert.ok(nodes.some(node=>node.type==='text'&&text(node)==='Takes dos seus projetos · 2'));assert.ok(nodes.some(node=>node.type==='text'&&text(node)==='Originais recuperados · 7'));
  assert.equal(labels.filter(label=>label.startsWith('Compartilhar take')).length,2);assert.equal(labels.filter(label=>label.startsWith('Compartilhar original recuperado')).length,7);assert.equal(labels.some(label=>label==='Compartilhar take 9'),false);
});
