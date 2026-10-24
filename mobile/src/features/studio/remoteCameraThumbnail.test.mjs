import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRemoteThumbnailQueue} from './remoteCameraThumbnailQueue.ts';
import * as queue from './remoteCameraThumbnailQueue.ts';
import * as transport from './uploadTransport.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',takeId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const metadata={bytes:2_747_050_311,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:777};
const job={sessionId,takeId,sourceUri:`file:///current/Documents/classfy-studio-remote/${owner}/${sessionId}/${takeId}.mov`,metadata};
const descriptor={version:1,mime:'image/jpeg',bytes:80,width:320,height:180,hash:'a'.repeat(64)};
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
const flush=()=>new Promise(resolve=>setTimeout(resolve,8));
function jpeg(width,height,bytes=80){const data=Buffer.alloc(bytes,1);Buffer.from([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0]).copy(data);data[bytes-2]=255;data[bytes-1]=217;return data;}
function producerHarness(options={}){
  const files=new Map([[job.sourceUri,metadata.bytes]]),calls=[];let sequence=0,current=true;
  const fileSystem={documentDirectory:'file:///current/Documents/',cacheDirectory:'file:///cache/',EncodingType:{Base64:'base64'},
    getInfoAsync:async uri=>{calls.push(['stat',uri]);const file=files.get(uri);return file===undefined?{exists:false}:{exists:true,isDirectory:false,size:typeof file==='number'?file:file.length};},
    readAsStringAsync:async uri=>{calls.push(['read',uri]);const file=files.get(uri);assert.ok(Buffer.isBuffer(file),'Não ler MOV');return file.toString('base64');},
    copyAsync:async({from,to})=>{calls.push(['copy',from,to]);assert.ok(from.endsWith('.jpg')&&to.endsWith('.jpg'));files.set(to,files.get(from));},
    deleteAsync:async uri=>{calls.push(['delete',uri]);assert.ok(uri.startsWith('file:///cache/'),'Nunca apagar original/cache durável');files.delete(uri);},
  };
  const code=ts.transpileModule(readFileSync(new URL('./remoteCameraThumbnail.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}};
  const deps={'expo-file-system/legacy':fileSystem,'expo-crypto':{randomUUID:()=>String(++sequence)},'./uploadTransport':transport,'./remoteCameraThumbnailQueue':queue,
    './remoteCameraJournal':{remoteMasterUri:(_owner,session,take)=>`file:///current/Documents/classfy-studio-remote/${_owner}/${session}/${take}.mov`},
    '../../../modules/classfy-studio-media':{generateThumbnailAsync:async(source,target,time)=>{calls.push(['decode',source,target,time]);await options.decode?.();files.set(target,jpeg(960,540));return {uri:target};}},
    'expo-image-manipulator':{SaveFormat:{JPEG:'jpeg'},ImageManipulator:{manipulate:uri=>{calls.push(['manipulate',uri]);let width=options.portrait?540:960,height=options.portrait?960:540;return {
      resize:size=>{width=size.width;height=size.height;calls.push(['resize',width,height]);},release:()=>calls.push(['release-context']),
      renderAsync:async()=>({width,height,release:()=>calls.push(['release-image']),saveAsync:async({compress})=>{const output=`file:///cache/saved-${++sequence}.jpg`;calls.push(['save',width,height,compress]);files.set(output,jpeg(width,height,options.bytes?.(compress,width,height)||80));return {uri:output,width,height};}}),
    };}}},
  };
  new Function('require','module','exports',code)(name=>{if(!(name in deps))throw Error(name);return deps[name];},module,module.exports);
  const helper=module.exports,scope={check:()=>{if(!current)throw Object.assign(Error('Pausado'),{name:'AbortError'});}};
  return {helper,files,calls,scope,invalidate:()=>{current=false;},prepare:()=>helper.prepareRemoteCameraThumbnail(owner,job,scope)};
}
test('JPEG real é limitado por bytes e dimensões; PNG, data URI e conteúdo truncado são recusados',()=>{
  const h=producerHarness(),parse=data=>h.helper.readRemoteThumbnailJpeg(data.toString('base64'));
  assert.equal(parse(jpeg(320,180)).width,320);assert.equal(parse(jpeg(180,320)).height,320);
  for(const bad of [jpeg(321,180),jpeg(320,180,16385),Buffer.from('not a jpeg'),jpeg(320,180).subarray(0,50)])assert.equal(parse(bad),null);
  assert.equal(h.helper.readRemoteThumbnailJpeg('data:image/jpeg;base64,'+jpeg(320,180).toString('base64')),null);
});
test('um quadro do MOV de 2,7GB vira JPEG pequeno; cache durável evita novo decode e retry usa os mesmos bytes',async()=>{
  const h=producerHarness({bytes:compress=>compress>.28?17000:8000}),image=await h.prepare();
  assert.equal(image.bytes,8000);assert.equal(image.width,320);assert.equal(image.height,180);assert.equal(h.calls.filter(call=>call[0]==='decode').length,1);
  assert.equal(h.calls.find(call=>call[0]==='decode')[3],.5);
  const calls=h.calls.length;assert.deepEqual(await h.prepare(),image);assert.equal(h.calls.slice(calls).filter(call=>call[0]==='decode'||call[0]==='copy'||call[0]==='save').length,0);
  assert.equal(h.files.get(job.sourceUri),2_747_050_311);assert.ok([...h.files.keys()].some(uri=>uri.includes('.thumb-v1-')&&uri.startsWith('file:///current/Documents/')));
  assert.ok(h.calls.filter(call=>call[0]==='read').every(call=>!call[1].endsWith('.mov')));
});
test('quadro portrait conserva proporção e os dois lados ficam limitados a320',async()=>{
  const h=producerHarness({portrait:true}),image=await h.prepare();assert.equal(image.width,180);assert.equal(image.height,320);
});
test('fonte ausente/tamanho divergente não decodifica nem apaga original',async()=>{
  for(const missing of [true,false]){const h=producerHarness();if(missing)h.files.delete(job.sourceUri);else h.files.set(job.sourceUri,7);
    await assert.rejects(h.prepare(),/original/);assert.equal(h.calls.some(call=>call[0]==='decode'||call[0]==='delete'),false);}
});
test('novo REC durante decode nativo descarta quadro tardio e limpa apenas temporários',async()=>{
  const entered=deferred(),gate=deferred(),h=producerHarness({decode:async()=>{entered.resolve();await gate.promise;}}),pending=h.prepare();
  await entered.promise;h.invalidate();gate.resolve();await assert.rejects(pending,/Pausado/);
  assert.equal(h.calls.some(call=>call[0]==='copy'||call[0]==='save'),false);assert.equal(h.files.get(job.sourceUri),metadata.bytes);assert.equal([...h.files.keys()].length,1);
});
test('fila única só roda idle; erro de um frame não bloqueia próximo e trabalho não repete a cada heartbeat',async()=>{
  let idle=false,list=0;const calls=[];
  const worker=createRemoteThumbnailQueue({current:()=>true,idle:()=>idle,delayMs:0,list:async()=>{list++;return [job,{...job,takeId:'second'}];},
    prepare:async target=>{calls.push(['prepare',target.takeId]);if(target.takeId===takeId)throw Error('Sem quadro');return {};},
    publish:async target=>{calls.push(['put',target.takeId]);return descriptor;},remember:async target=>{calls.push(['remember',target.takeId]);}});
  worker.schedule(sessionId);await flush();assert.equal(list,0);idle=true;worker.schedule(sessionId);await flush();
  assert.deepEqual(calls,[['prepare',takeId],['prepare','second'],['put','second'],['remember','second']]);worker.schedule(sessionId);await flush();assert.equal(list,1);worker.dispose();
});
test('START não aguarda thumbnail em voo; publicação/recibo antigos são descartados e a próxima fila permanece única',async()=>{
  const gate=deferred(),entered=deferred(),calls=[];let preparations=0,idle=true;
  const worker=createRemoteThumbnailQueue({current:()=>true,idle:()=>idle,delayMs:0,list:async()=>[job],prepare:async()=>{preparations++;entered.resolve();await gate.promise;return {};},
    publish:async(_job,_image,scope)=>{scope.check();calls.push('put');return descriptor;},remember:async()=>calls.push('remember')});
  worker.schedule(sessionId);await entered.promise;idle=false;worker.pause();idle=true;worker.schedule(sessionId);await flush();assert.equal(preparations,1);
  gate.resolve();await flush();assert.equal(preparations,2);assert.deepEqual(calls,['put','remember']);worker.dispose();
});
test('background/fechamento aborta request e ignora ACK tardio sem gravar recibo',async()=>{
  const entered=deferred(),gate=deferred(),calls=[];let signal;
  const worker=createRemoteThumbnailQueue({current:()=>true,idle:()=>true,delayMs:0,list:async()=>[job],prepare:async()=>({}),publish:async(_job,_image,scope)=>{signal=scope.signal;entered.resolve();await gate.promise;return descriptor;},remember:async()=>calls.push('remember')});
  worker.schedule(sessionId);await entered.promise;worker.dispose();assert.equal(signal.aborted,true);gate.resolve();await flush();assert.deepEqual(calls,[]);
});
test('rede retorna no mesmo idle: backoff repete JPEG idêntico sem precisar novo REC',async()=>{
  const calls=[],done=deferred();let online=false;const image={base64:'cached-same-bytes'};
  const worker=createRemoteThumbnailQueue({current:()=>true,idle:()=>true,delayMs:1,retryDelayMs:1,list:async()=>[job],prepare:async()=>image,
    publish:async(_job,payload)=>{calls.push(payload.base64);if(!online){online=true;throw Error('offline');}return descriptor;},remember:async()=>done.resolve()});
  worker.schedule(sessionId);await done.promise;assert.deepEqual(calls,['cached-same-bytes','cached-same-bytes']);worker.dispose();
});
test('janela de backfill não prepara mais que24 originais nem roda em paralelo',async()=>{
  let prepared=0,inFlight=0,max=0;const worker=createRemoteThumbnailQueue({current:()=>true,idle:()=>true,delayMs:0,list:async()=>Array.from({length:40},(_,i)=>({...job,takeId:String(i)})),
    prepare:async()=>{prepared++;inFlight++;max=Math.max(max,inFlight);await Promise.resolve();inFlight--;return {};},publish:async()=>descriptor,remember:async()=>{}});
  worker.schedule(sessionId);await flush();assert.equal(prepared,24);assert.equal(max,1);worker.dispose();
});
