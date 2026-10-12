import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as liveModel from '../live/model.ts';
function compile(file,dependencies) {
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(name=>{if(!(name in dependencies))throw Error(`Unknown import ${name}`);return dependencies[name];},module,module.exports);return module.exports;
}
function harness(options={}) {
  let owner='owner',listener,current=true,afterRequest;const calls=[];
  const deadlines=compile('../live/request.ts',{'./model':liveModel});
  const api=compile('./remoteCameraApi.ts',{
    '@/features/live/request':deadlines,
    '@/lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'test-only'}}}),
      onAuthStateChange:callback=>{listener=callback;return {data:{subscription:{unsubscribe:()=>calls.push('unsubscribe')}}};}}}},
    '@supabase/supabase-js':{createClient:(_url,_key,config)=>{calls.push({config});return {functions:{invoke:async(name,args)=>{calls.push({name,args});afterRequest?.();return options.response||{data:{session:{id:'session',ownerId:'owner'},serverAt:new Date().toISOString(),commands:[],takes:[]},error:null};}}};}},
  });
  return {api,calls,scope:{isCurrent:()=>current},owner:next=>{owner=next;listener?.('SIGNED_IN',{user:{id:next}});},invalidate:()=>{current=false;},after:fn=>{afterRequest=fn;}};
}
test('QR somente Classfy e código opaco completo; URLs estrangeiras/credenciais não são abertas',()=>{
  const {api}=harness(),code='X'.repeat(43);
  assert.equal(api.readRemotePairingCode(code),code);
  assert.equal(api.readRemotePairingCode(`classfy://studio/remote-camera?code=${code}`),code);
  assert.equal(api.readRemotePairingCode(`https://classfy.com.br/studio/iphone?code=${code}`),code);
  for(const value of [`https://foreign.invalid/studio/iphone?code=${code}`,`https://user@classfy.com.br/studio/iphone?code=${code}`,`https://classfy.com.br:123/studio/iphone?code=${code}`,'short'])assert.throws(()=>api.readRemotePairingCode(value));
});
test('auth proprietário antes de qualquer ação, cliente capturado e response owner verificado',async()=>{
  const h=harness();await h.api.remoteCameraRequest('owner','status',{sessionId:'session'},h.scope);
  assert.equal(h.calls.find(call=>call.name).name,'studio-camera');assert.equal(h.calls.at(-1),'unsubscribe');
  h.owner('another');await assert.rejects(h.api.remoteCameraRequest('owner','status',{},h.scope),/mesma conta/);
  const foreign=harness({response:{data:{session:{id:'session',ownerId:'another'},serverAt:new Date().toISOString(),commands:[],takes:[]},error:null}});
  await assert.rejects(foreign.api.remoteCameraRequest('owner','status',{},foreign.scope),/desta conta/);
});
test('conta muda ou foco acaba durante resposta: nada é entregue ao novo scope e listener é removido',async()=>{
  for(const mode of ['owner','focus']){const h=harness();h.after(()=>mode==='owner'?h.owner('another'):h.invalidate());
    await assert.rejects(h.api.remoteCameraRequest('owner','join',{code:'test-only'},h.scope));assert.equal(h.calls.at(-1),'unsubscribe');}
});
test('erro de servidor preserva causa útil removendo credenciais/URL da mensagem',async()=>{
  const h=harness({response:{error:{context:new Response(JSON.stringify({error:'Premium necessário https://private.invalid/path Bearer private-test'}))}}});
  await assert.rejects(h.api.remoteCameraRequest('owner','join',{},h.scope),error=>error.message.includes('Premium necessário')&&!error.message.includes('private-test')&&!error.message.includes('private.invalid'));
});
test('upload tem deadline independente e cancela mesmo provider que ignora AbortController',async()=>{
  const h=harness(),scope={signal:new AbortController().signal};
  const upload=h.api.createRemoteUploadFetch(scope,()=>new Promise(()=>{}),5);await assert.rejects(upload('https://private.invalid'),/demorou/);
  const abort=new AbortController();let transportSignal;const cancelled=h.api.createRemoteUploadFetch({signal:abort.signal},(_url,init)=>{transportSignal=init.signal;return new Promise(()=>{});},1000);
  const pending=cancelled('https://private.invalid');await Promise.resolve();abort.abort();await assert.rejects(pending);assert.equal(transportSignal.aborted,true);
});
