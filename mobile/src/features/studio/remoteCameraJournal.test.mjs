import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',session='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',device='cccccccc-cccc-4ccc-8ccc-cccccccccccc',take='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
function harness(){
  const disk=new Map();let fail=false;
  const code=ts.transpileModule(readFileSync(new URL('./remoteCameraJournal.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}},deps={'@react-native-async-storage/async-storage':{getItem:async key=>disk.get(key)||null,setItem:async(key,value)=>{if(fail){fail=false;throw Error('quota');}disk.set(key,value);}},'expo-file-system/legacy':{documentDirectory:'file:///current/Documents/'}};
  new Function('require','module','exports',code)(name=>deps[name],module,module.exports);
  const journal=module.exports;return {journal,disk,fail:()=>{fail=true;},read:()=>journal.readRemoteCameraJournal(owner,session,device),write:change=>journal.mutateRemoteCameraJournal(owner,session,device,change)};
}
test('diário é owner/session/device scoped e troca de container rebaseia original sem duplicar entrada',async()=>{
  const h=harness(),uri=`file:///old/Documents/classfy-studio-remote/${owner}/${session}/${take}.mov`;
  await h.write(value=>({...value,takes:[{id:take,uri,phase:'reserved'}]}));const actual=await h.read();assert.equal(actual.takes[0].uri,h.journal.remoteMasterUri(owner,session,take));
  assert.equal((await h.journal.readRemoteCameraJournal(device,session,device)).takes.length,0);
  await assert.rejects(h.journal.readRemoteCameraJournal(owner,session,owner),/recuperação/);
});
test('gravações concorrentes preservam ambos recibos; quota falha antes de saved e retry não fica preso',async()=>{
  const h=harness();await Promise.all([h.write(value=>({...value,sequence:1})),h.write(value=>({...value,takes:[{id:take,uri:h.journal.remoteMasterUri(owner,session,take),phase:'reserved'}]}))]);
  assert.equal((await h.read()).sequence,1);assert.equal((await h.read()).takes.length,1);
  h.fail();await assert.rejects(h.write(value=>({...value,sequence:2})),/quota/);assert.equal((await h.read()).sequence,1);
  await h.write(value=>({...value,sequence:3}));assert.equal((await h.read()).sequence,3);
});
test('URI fora do proprietário, path traversal e metadados truncados não viram original pronto',async()=>{
  for(const patch of [{uri:`file:///current/Documents/classfy-studio-remote/${device}/${session}/${take}.mov`},{uri:`file:///current/Documents/classfy-studio-remote/${owner}/${session}/../${take}.mov`},
    {metadata:{bytes:0,mime:'video/quicktime',width:3840,height:2160,fps:30,duration:3}}]){
    const h=harness();await h.write(value=>({...value,takes:[{id:take,uri:h.journal.remoteMasterUri(owner,session,take),phase:'local_ready',...patch}]}));await assert.rejects(h.read());
  }
});
test('saída 2K ao lado do raw em Documents é aceita e recuperada após mudança do container',async()=>{
  const h=harness(),encodedName='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee-2k.mov';
  const uri=`file:///old/Documents/classfy-studio-remote/${owner}/${session}/${encodedName}`;
  const metadata={bytes:3123456,mime:'video/quicktime',width:2560,height:1440,fps:30,duration:4,startedAtServerMs:12345};
  await h.write(value=>({...value,takes:[{id:take,uri,phase:'local_ready',metadata}]}));
  const reopened=await h.read();
  assert.equal(reopened.takes[0].uri,`file:///current/Documents/classfy-studio-remote/${owner}/${session}/${encodedName}`);
  assert.equal(reopened.takes[0].id,take);assert.deepEqual(reopened.takes[0].metadata,metadata);
  await h.write(value=>({...value,takes:value.takes.map(item=>({...item,phase:'uploading',partUrls:{0:'https://storage.invalid/resumable/part'}}))}));
  assert.equal((await h.read()).takes[0].uri,reopened.takes[0].uri);
});

test('derivado tratado e clean separados rebaseiam, outro take ou traversal são recusados',async()=>{
  const h=harness(),root=`file:///old/Documents/classfy-studio-remote/${owner}/${session}/`;
  await h.write(value=>({...value,takes:[{id:take,uri:`${root}${take}-grade-12345678.mp4`,sourceUri:`${root}${take}.mov`,phase:'local_ready'}]}));
  const entry=(await h.read()).takes[0];assert.equal(entry.uri,`${root.replace('/old/','/current/')}${take}-grade-12345678.mp4`);assert.equal(entry.sourceUri,h.journal.remoteMasterUri(owner,session,take));
  for(const patch of [{uri:`${root}${device}-grade-12345678.mp4`},{sourceUri:`${root}../${take}.mov`},{uri:`${root}${take}-grade-private.mp4`}]){
    const bad=harness();await bad.write(value=>({...value,takes:[{id:take,uri:entry.uri,sourceUri:entry.sourceUri,phase:'local_ready',...patch}]}));await assert.rejects(bad.read());
  }
});
