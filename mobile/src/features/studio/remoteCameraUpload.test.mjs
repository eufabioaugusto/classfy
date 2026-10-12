import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadRemoteCameraOriginal,REMOTE_CAMERA_PART_BYTES as partSize} from './remoteCameraUpload.ts';

function harness(options={}) {
  const take={id:'take',uri:'file:///private/master.mov',phase:'local_ready',metadata:{bytes:options.bytes||partSize+3,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:4}};
  let journal={takes:[structuredClone(take)]},complete=false,current=true,losePatch=!!options.losePatch,loseComplete=!!options.loseComplete;
  const calls=[],reads=[],offsets=new Map(options.offsets),endpoint='https://storage.invalid/upload/resumable';
  const deps={sessionId:'session',deviceId:'device',take,check(){if(!current)throw Error('cancelled');},
    journal:async()=>structuredClone(journal),mutate:async change=>{if(options.failJournal)throw Error('disk-full');journal=change(structuredClone(journal));return journal;},
    read:async(position,length)=>{reads.push({position,length});if(options.blurOnRead)current=false;return new Uint8Array(length);},
    request:async(action,body)=>{
      calls.push({action,body});
      if(action==='upload-complete'){complete=true;if(loseComplete){loseComplete=false;throw Error('response-lost');}return {takes:[{id:take.id,status:'uploaded'}]};}
      if(complete)return {takes:[{id:take.id,status:'uploaded'}]};
      const index=body.partIndex;
      return {takes:[],upload:{endpoint,bucket:'private',path:`owner/session/take/${index}`,token:'test-signature',chunkSize:partSize,
        partIndex:index,partOffset:index*partSize,partBytes:Math.min(partSize,take.metadata.bytes-index*partSize),totalParts:Math.ceil(take.metadata.bytes/partSize),
        mime:'application/octet-stream',uploaded:options.uploaded?.includes(index)||false,...(options.uploaded?.includes(index)?{token:''}:{}),...options.target}};
    },
    fetch:async(url,init)=>{
      calls.push({action:init.method,url,headers:init.headers,bytes:init.body?.byteLength});
      if(init.method==='POST')return new Response(null,{status:201,headers:{Location:options.location||`${endpoint}/part-${calls.filter(call=>call.action==='POST').length-1}`}});
      if(init.method==='HEAD')return new Response(null,{status:options.expired&&url.endsWith('old')?410:200,headers:{'Upload-Offset':String(offsets.get(url)||0)}});
      const offset=Number(init.headers['Upload-Offset'])+init.body.byteLength;offsets.set(url,offset);
      if(losePatch){losePatch=false;throw Error('patch-response-lost');}
      return new Response(null,{status:204,headers:{'Upload-Offset':String(offset)}});
    },
  };
  return {deps,take,calls,reads,offsets,journal:()=>structuredClone(journal),retry:()=>uploadRemoteCameraOriginal(deps),
    setPartUrl:(index,url)=>{journal.takes[0].partUrls={...journal.takes[0].partUrls,[index]:url};}};
}

test('original maior que parte usa offsets exatos, arquivos privados e memória limitada a 6 MiB',async()=>{
  const h=harness();await h.retry();
  assert.deepEqual(h.reads,[{position:0,length:partSize},{position:partSize,length:3}]);
  assert.deepEqual(h.calls.filter(call=>call.action==='PATCH').map(call=>call.bytes),[partSize,3]);
  assert.equal(h.calls.at(-1).action,'upload-complete');assert.deepEqual(h.calls.at(-1).body,{sessionId:'session',takeId:'take',deviceId:'device'});
  assert.ok(h.calls.filter(call=>['POST','HEAD','PATCH'].includes(call.action)).every(call=>call.headers['x-signature']==='test-signature'));
  assert.equal(JSON.stringify(h.journal()).includes('test-signature'),false);assert.equal(h.journal().takes[0].uri,h.take.uri);
});
test('PATCH recebido com resposta perdida usa HEAD durável, sem repetir bytes ou criar outra parte',async()=>{
  const h=harness({bytes:17,losePatch:true});await assert.rejects(h.retry(),/patch-response-lost/);await h.retry();
  assert.equal(h.calls.filter(call=>call.action==='POST').length,1);assert.equal(h.calls.filter(call=>call.action==='PATCH').length,1);
  assert.equal(h.calls.at(-1).action,'upload-complete');
});
test('upload-complete recebido com resposta perdida é recuperado pelo take uploaded sem target/novo envio',async()=>{
  const h=harness({bytes:17,loseComplete:true});await assert.rejects(h.retry(),/response-lost/);await h.retry();
  assert.equal(h.calls.filter(call=>call.action==='POST').length,1);assert.equal(h.calls.filter(call=>call.action==='upload-complete').length,1);
  assert.equal(h.calls.at(-1).action,'upload-start');
});
test('parte já verificada não é sobrescrita; a seguinte ainda é enviada e soma confirmada',async()=>{
  const h=harness({uploaded:[0]});await h.retry();assert.deepEqual(h.reads,[{position:partSize,length:3}]);assert.equal(h.calls.at(-1).action,'upload-complete');
});
test('retomada lê somente restante da parte no offset absoluto do original',async()=>{
  const h=harness({bytes:20});const url='https://storage.invalid/upload/resumable/known';h.setPartUrl(0,url);h.offsets.set(url,9);await h.retry();
  assert.deepEqual(h.reads,[{position:9,length:11}]);assert.equal(h.calls.filter(call=>call.action==='POST').length,0);
});
test('TUS expirado é reaberto com assinatura atual e novo cursor persistido',async()=>{
  const h=harness({bytes:20,expired:true});h.setPartUrl(0,'https://storage.invalid/upload/resumable/old');await h.retry();
  assert.equal(h.calls.filter(call=>call.action==='POST').length,1);assert.ok(!h.journal().takes[0].partUrls[0].endsWith('old'));
});
test('quota de journal impede PATCH antes de salvar endereço de retomada',async()=>{
  const h=harness({bytes:20,failJournal:true});await assert.rejects(h.retry(),/disk-full/);assert.equal(h.reads.length,0);assert.equal(h.calls.filter(call=>call.action==='PATCH').length,0);
});
test('troca de conta/foco durante leitura não envia bytes nem confirma original',async()=>{
  const h=harness({bytes:20,blurOnRead:true});await assert.rejects(h.retry(),/cancelled/);assert.equal(h.calls.filter(call=>call.action==='PATCH'||call.action==='upload-complete').length,0);
});
test('Location de outro origin não recebe assinatura e range adulterado nunca abre TUS',async()=>{
  const foreign=harness({bytes:20,location:'https://foreign.invalid/path'});await assert.rejects(foreign.retry(),/inválido/);
  assert.equal(foreign.calls.filter(call=>call.url?.includes('foreign')).length,0);
  const bad=harness({bytes:20,target:{partBytes:19}});await assert.rejects(bad.retry(),/partes/);assert.equal(bad.calls.filter(call=>call.action==='POST').length,0);
});
