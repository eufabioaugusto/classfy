import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',browser='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',session='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function harness(){
  const data=new Map(),writes=[];
  const code=ts.transpileModule(readFileSync(new URL('./remoteCameraPairing.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',code)(()=>({getItem:async key=>data.get(key)||null,setItem:async(key,value)=>{writes.push({key,value});data.set(key,value);},removeItem:async key=>data.delete(key)}),module,module.exports);
  return {api:module.exports,data,writes};
}
test('browser lembrado é separado da sessão; desvincular preserva referência de recuperação e originais',async()=>{
  const h=harness();await h.api.rememberRemoteBrowser(owner,browser,session);
  assert.deepEqual(await h.api.readRememberedRemoteBrowser(owner),{sessionId:session,controllerId:browser});
  h.data.set(`classfy:remote-camera:v1:${owner}:${session}`,'original-journal');await h.api.forgetRemoteBrowser(owner);
  assert.deepEqual(await h.api.readRememberedRemoteBrowser(owner),{sessionId:session,controllerId:null});assert.equal(h.data.get(`classfy:remote-camera:v1:${owner}:${session}`),'original-journal');
  assert.deepEqual(await h.api.readRememberedRemoteBrowser(browser),{sessionId:null,controllerId:null});
});
test('sessão antiga migra pelo discover sem QR e armazenamento não aceita identificadores inválidos',async()=>{
  const h=harness();h.data.set(`classfy:remote-camera:last:${owner}`,session);
  assert.deepEqual(await h.api.readRememberedRemoteBrowser(owner),{sessionId:session,controllerId:null});
  await h.api.rememberRemoteBrowser(owner,browser);assert.equal((await h.api.readRememberedRemoteBrowser(owner)).sessionId,session);
  await assert.rejects(h.api.rememberRemoteBrowser(owner,'token-not-browser',session),/vínculo/);assert.equal(h.writes.length,1);
});
test('reconexão automática exige rota focada, permissões, vínculo e intenção; cancelar persiste durante background',()=>{
  const {api}=harness(),connectedRoute={focused:true,foreground:true,permissionsGranted:true,hasSavedPairing:true,allowed:true,joining:false,connected:false,scanning:false,leaving:false,hasExplicitCode:false};
  assert.equal(api.mayResumeRemoteCameraAutomatically(connectedRoute),true);
  for(const key of ['focused','foreground','permissionsGranted','hasSavedPairing','allowed'])assert.equal(api.mayResumeRemoteCameraAutomatically({...connectedRoute,[key]:false}),false);
  for(const key of ['joining','connected','scanning','leaving','hasExplicitCode'])assert.equal(api.mayResumeRemoteCameraAutomatically({...connectedRoute,[key]:true}),false);
  const cancelled={...connectedRoute,allowed:false};assert.equal(api.mayResumeRemoteCameraAutomatically({...cancelled,foreground:false}),false);assert.equal(api.mayResumeRemoteCameraAutomatically({...cancelled,foreground:true}),false);
});
