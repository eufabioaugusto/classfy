import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import * as model from './model.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sessionId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',takeId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sourceUri=`file:///Documents/classfy-studio-remote/${owner}/${sessionId}/${takeId}.mov`;
const grade={preset:'natural',intensity:0.7,exposure:0.25,contrast:0.1,saturation:0.15,temperature:0.4};
function harness(options={}) {
  const files=new Map([[sourceUri,{duration:4,width:3840,height:2160,frameRate:30,fileSize:12345,hasVideo:true,hasAudio:true,...options.source}]]),receipts=new Map(),calls=[];
  let current=true,authOwner=owner,sequence=0,exported=options.exported||{},failComplete=!!options.failComplete;
  const fs={documentDirectory:'file:///Documents/',getInfoAsync:async uri=>({exists:files.has(uri),isDirectory:false,size:files.get(uri)?.fileSize||0}),
    readAsStringAsync:async uri=>{if(!receipts.has(uri))throw Error('missing');return receipts.get(uri);},writeAsStringAsync:async(uri,value)=>{
      if(failComplete&&JSON.parse(value).state==='complete'){failComplete=false;throw Error('quota');}receipts.set(uri,value);},
    moveAsync:async({from,to})=>{calls.push({kind:'move',from,to});files.set(to,files.get(from));files.delete(from);}};
  const capabilities={version:2,available:true,colorSpace:'rec709',minimumDimension:64,maximumDimension:3840,maximumShortDimension:2160,maximumPixels:8294400,arbitraryEvenDimensions:true,
    supportsHEVC:true,resolutions:[{id:'4k',width:3840,height:2160,codec:'hevc'}],frameRates:[{numerator:30,denominator:1}]};
  const deps={fs,owner:async()=>authOwner,info:async uri=>{if(!files.has(uri))throw Error('missing');return {...files.get(uri)};},capabilities:async()=>options.legacy?{...capabilities,maximumDimension:1920,maximumShortDimension:1080,maximumPixels:2073600,arbitraryEvenDimensions:false,resolutions:[{id:'hd',width:1920,height:1080,codec:'h264'}]}:capabilities,
    digest:async value=>createHash('sha256').update(value).digest('hex'),uuid:()=>`id-${++sequence}`,
    export:async(args,progress)=>{const recipe=JSON.parse(args.recipeJSON);calls.push({kind:'export',args,recipe});progress(0.5);await options.during?.();
      files.set(args.outputUri,{...files.get(sourceUri),width:recipe.output.width,height:recipe.output.height,frameRate:recipe.output.frameRateNumerator/recipe.output.frameRateDenominator,fileSize:54321,...exported});
      progress(1);return {...files.get(args.outputUri),uri:args.outputUri,mimeType:'video/mp4'};},cancel:async id=>calls.push({kind:'cancel',id})};
  const code=ts.transpileModule(readFileSync(new URL('./remoteCameraGrade.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const module={exports:{}},imports={'expo-file-system/legacy':fs,'expo-crypto':{CryptoDigestAlgorithm:{SHA256:'sha256'},digestStringAsync:(_algorithm,value)=>deps.digest(value),randomUUID:deps.uuid},
    '@/lib/supabase':{supabase:{auth:{getSession:async()=>({data:{session:{user:{id:authOwner}}}})}}},'@/features/live/request':{withLiveDeadline:run=>run()},
    '../../../modules/classfy-studio-media':{getMediaInfoAsync:deps.info,getStudioExportCapabilitiesAsync:deps.capabilities,exportRecipeAsync:deps.export,cancelExportAsync:deps.cancel},'./model':model};
  new Function('require','module','exports',code)(name=>imports[name],module,module.exports);
  const create=()=>module.exports.createRemoteCameraGradeRenderer(deps);let prepare=create();
  return {files,receipts,calls,create,options:{owner,sessionId,takeId,sourceUri,imageGrade:grade,shouldContinue:()=>current},
    prepare:patch=>prepare({...{owner,sessionId,takeId,sourceUri,imageGrade:grade,shouldContinue:()=>current},...patch}),reopen:()=>{prepare=create();},
    invalidate:()=>{current=false;},resume:()=>{current=true;},owner:value=>{authOwner=value;},output:value=>{exported=value;}};
}
test('Natural identidade ou intensidade zero preserva MOV sem encoder, inclusive áudio/4K/FPS',async()=>{
  for(const imageGrade of [model.studioGrade('natural'),{...grade,intensity:0}]){const h=harness();const result=await h.prepare({imageGrade});assert.equal(result.uri,sourceUri);assert.equal(result.metadata.mime,'video/quicktime');assert.equal(result.metadata.width,3840);assert.equal(h.calls.length,0);}
});
test('derivado usa recipe real uma vez, 4K+áudio e grade congelada, clean nunca é alterado',async()=>{
  const h=harness(),before={...h.files.get(sourceUri)},stages=[];const result=await h.prepare({onProgress:(progress,stage)=>stages.push([progress,stage])});
  const encoded=h.calls.find(call=>call.kind==='export');assert.deepEqual(encoded.recipe.clips[0].grade,grade);assert.equal(encoded.recipe.assets[0].uri,sourceUri);
  assert.equal(encoded.recipe.clips[0].gain,1);assert.equal(encoded.recipe.output.width,3840);assert.equal(result.metadata.mime,'video/mp4');assert.deepEqual(h.files.get(sourceUri),before);
  assert.ok(result.uri.startsWith(`file:///Documents/classfy-studio-remote/${owner}/${sessionId}/${takeId}-grade-`));assert.equal(stages.at(-1)[1],'complete');
});
test('reabrir e mudar ordem das chaves de grade reutiliza receipt/source/metadados sem render duplicado',async()=>{
  const h=harness(),first=await h.prepare();h.reopen();const imageGrade={temperature:0.4,saturation:0.15,contrast:0.1,exposure:0.25,intensity:0.7,preset:'natural'};
  const second=await h.prepare({imageGrade});assert.equal(second.uri,first.uri);assert.equal(h.calls.filter(call=>call.kind==='export').length,1);
});
test('quota depois commit conserva derivado e receipt rendering; retry inspeciona e confirma sem novo encoder',async()=>{
  const h=harness({failComplete:true});await assert.rejects(h.prepare(),/quota/);assert.equal(h.calls.filter(call=>call.kind==='export').length,1);
  h.reopen();const result=await h.prepare();assert.equal(h.calls.filter(call=>call.kind==='export').length,1);assert.equal(JSON.parse(h.receipts.get(`${result.uri}.json`)).state,'complete');
});
test('cache truncado/sem áudio é preservado e refeito; fonte e versão anterior não são apagadas',async()=>{
  const h=harness(),first=await h.prepare();h.files.set(first.uri,{...h.files.get(first.uri),duration:1,hasAudio:false});
  const next=await h.prepare();assert.equal(next.uri,first.uri);assert.equal(h.calls.filter(call=>call.kind==='export').length,2);assert.equal(h.calls.filter(call=>call.kind==='move').length,1);assert.ok(h.files.has(sourceUri));
});
test('mudar grade cria outro derivado e preserva ambos, sem aplicar receita sobre MP4 já tratado',async()=>{
  const h=harness(),first=await h.prepare(),next=await h.prepare({imageGrade:{...grade,temperature:-0.5}});
  assert.notEqual(first.uri,next.uri);assert.ok(h.files.has(first.uri)&&h.files.has(next.uri));await assert.rejects(h.prepare({sourceUri:first.uri}),/fora/);
});
test('saída fresh sem áudio ou FPS correto não recebe certificado complete',async()=>{
  for(const exported of [{hasAudio:false},{frameRate:24},{width:1920,height:1080},{duration:1}]){const h=harness({exported});await assert.rejects(h.prepare(),/preservou/);assert.ok([...h.receipts.values()].every(value=>JSON.parse(value).state==='rendering'));assert.ok(h.files.has(sourceUri));}
});
test('old binary não faz downscale de 4K; owner/path/grade inválidos não iniciam export',async()=>{
  const legacy=harness({legacy:true});await assert.rejects(legacy.prepare(),/Atualize/);assert.equal(legacy.calls.length,0);
  const h=harness();for(const patch of [{owner:sessionId},{sourceUri:'file:///other.mov'},{imageGrade:{...grade,temperature:NaN}}])await assert.rejects(h.prepare(patch));assert.equal(h.calls.length,0);
});
test('cancela o request reservado durante render e ignora sucesso tardio, preservando clean e derivado recuperável',async()=>{
  let h;h=harness({during:async()=>h.invalidate()});await assert.rejects(h.prepare(),/pausada/);assert.equal(h.calls.filter(call=>call.kind==='cancel').length,1);assert.ok(h.files.has(sourceUri));
  h.resume();h.reopen();await h.prepare();assert.equal(h.calls.filter(call=>call.kind==='export').length,1);
});
test('concorrência do mesmo take/grade compartilha um encoder e um arquivo confirmado',async()=>{
  const h=harness();const [one,two]=await Promise.all([h.prepare(),h.prepare()]);assert.equal(one.uri,two.uri);assert.equal(h.calls.filter(call=>call.kind==='export').length,1);
});
test('snapshot do tratamento é copiado antes de qualquer await e não segue alterações posteriores do caller',async()=>{
  const h=harness(),selected={...grade};const pending=h.prepare({imageGrade:selected});selected.exposure=1.5;selected.temperature=-0.8;
  const result=await pending;assert.deepEqual(result.imageGrade,grade);assert.deepEqual(h.calls.find(call=>call.kind==='export').recipe.clips[0].grade,grade);
});
