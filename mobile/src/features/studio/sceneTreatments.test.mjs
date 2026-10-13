import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';
import { measureStudioScene, suggestStudioEnhancement, studioEnhancementPixel } from './autoEnhance.ts';
const compile = (path,dependencies) => {
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}}; new Function('require','module','exports',code)(name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];},module,module.exports); return module.exports;
};
const scenes=compile('./sceneTreatments.ts',{'./model':model});
const bridge=native=>compile('../../../modules/classfy-studio-media/index.ts',{'expo-modules-core':{requireOptionalNativeModule:()=>native}});
const capability={version:1,recipeVersion:3,available:true,features:['enhancement-v1','portrait-v1'],maximumAnalysisFrames:12};
const base={exportRecipeAsync(){},seekStudioCompositionAsync(){},addListener(){return{remove(){}}}};
const sample=measureStudioScene([90,95,100,255,100,105,110,255]);
const fixture=()=>({...model.emptyStudioEditing('aula'),assets:[{id:'v',kind:'video',uri:'file:///untouched.mp4',name:'Untouched',durationTicks:model.studioTicks(30)}],main:[{id:'c',assetId:'v',sourceStartTicks:model.studioTicks(5),sourceEndTicks:model.studioTicks(10),playbackRate:2}]});
test('análise considera trecho original selecionado, sem efeitos, velocidade ou tempo da timeline',()=>{
 let value=fixture(); value=model.patchStudioClipEnhancement(value,'c',suggestStudioEnhancement([sample])); value=model.patchStudioClipPortrait(value,'c',{version:1,strength:.4});
 assert.deepEqual(scenes.studioSceneAnalysisRequest(value,'c'),{uri:'file:///untouched.mp4',kind:'video',startSeconds:5,endSeconds:10,frameCount:5});
 const long={...value,main:[{...value.main[0],sourceEndTicks:model.studioTicks(30)}]}; assert.equal(scenes.studioSceneAnalysisRequest(long,'c').frameCount,12);
 assert.throws(()=>scenes.studioSceneAnalysisRequest(value,'missing'),/Selecione/);
});
test('comparação remove quatro tratamentos mantendo IDs, fontes, áudio, geometria e relógios',()=>{
 let value=fixture(); value=model.patchStudioClipEnhancement(value,'c',suggestStudioEnhancement([sample])); value=model.patchStudioClipPortrait(value,'c',{version:1,strength:.4});
 value=model.patchStudioClipSignature(value,'c',{version:1,strength:.85,subjectExposure:.15,backgroundExposure:-1.2,backgroundBlur:.28,temperature:.18});
 const recipe=model.compileStudioRecipe({kind:'aula',takes:[],editing:value}), before=scenes.studioUntreatedPreviewRecipe(recipe);
 assert.equal(recipe.version,3); assert.equal(before.version,2); assert.equal(before.requiredFeatures,undefined);
 for(const clip of before.clips){assert.equal(clip.enhancement,undefined);assert.equal(clip.portrait,undefined);assert.equal(clip.signature,undefined);assert.equal(clip.grade.intensity,0);const original=recipe.clips.find(item=>item.id===clip.id);for(const key of ['id','assetId','startTicks','durationTicks','sourceStartTicks','sourceEndTicks','gain','rect','playbackRate'])assert.deepEqual(clip[key],original[key]);}
 assert.deepEqual(before.assets,recipe.assets); assert.ok(recipe.clips[0].enhancement);
});
test('ABI desconhecida, versão anterior ou features incompletas nunca liberam tratamento',async()=>{
 for(const value of [{...capability,version:2},{...capability,recipeVersion:2},{...capability,features:['enhancement-v1']},{...capability,maximumAnalysisFrames:24},null]){
 const api=bridge({...base,getStudioEnhancementCapabilitiesAsync:async()=>value,analyzeStudioSceneAsync(){}});assert.equal((await api.getStudioEnhancementCapabilitiesAsync()).available,false);
 }
 assert.equal((await bridge(base).getStudioEnhancementCapabilitiesAsync()).available,false);
 let exported=0, thumbs=0; const api=bridge({...base,exportRecipeAsync(){exported++;},getStudioEditorCapabilitiesAsync:async()=>({version:1,available:true}),renderStudioRecipeThumbnailAsync(){thumbs++;}});
 const recipe={version:3,requiredFeatures:['portrait-v1'],clips:[],assets:[]};
 await assert.rejects(api.exportRecipeAsync({requestId:'x',recipeJSON:JSON.stringify(recipe),outputUri:'file:///out.mp4'}),/Atualize/);
 await assert.rejects(api.renderStudioRecipeThumbnailAsync(JSON.stringify(recipe),'file:///thumb.jpg',0),/Atualize/);
 assert.equal(exported,0);assert.equal(thumbs,0);
});
test('análise exige amostras confirmadas, limita orçamento e serializa decoders',async()=>{
 let active=0,peak=0,calls=0;const api=bridge({...base,getStudioEnhancementCapabilitiesAsync:async()=>capability,analyzeStudioSceneAsync:async()=>{calls++;peak=Math.max(peak,++active);await new Promise(resolve=>setImmediate(resolve));active--;return{version:1,samples:[sample]};}});
 const request={uri:'file:///original.mp4',kind:'video',startSeconds:0,endSeconds:1,frameCount:1};
 assert.deepEqual(await Promise.all([api.analyzeStudioSceneAsync(request),api.analyzeStudioSceneAsync(request)]),[[sample],[sample]]);assert.equal(peak,1);assert.equal(calls,2);
 await assert.rejects(api.analyzeStudioSceneAsync({...request,frameCount:13}),/trecho/);assert.equal(calls,2);
 for(const result of [{version:2,samples:[sample]},{version:1,samples:[]},{version:1,samples:[{...sample,p50:NaN}]},{version:1,samples:[sample,sample]}]){
 const invalid=bridge({...base,getStudioEnhancementCapabilitiesAsync:async()=>capability,analyzeStudioSceneAsync:async()=>result}); await assert.rejects(invalid.analyzeStudioSceneAsync(request),/confirmada/);
 }
});
test('correção estável usa mediana, ignora alpha invisível e retorna identidade em força zero',()=>{
 const original=measureStudioScene([0,0,0,0,100,100,100,255]), outlier=measureStudioScene([250,250,250,255]); assert.equal(original.neutralFraction,1);assert.throws(()=>measureStudioScene([1,2,3,0]),/visíveis/);
 const stable=suggestStudioEnhancement([original,original,outlier]);assert.equal(stable.analyzedFrames,3);assert.ok(stable.exposure>0);
 const rgb=[.2,.3,.4];assert.deepEqual(studioEnhancementPixel(rgb,{...stable,strength:0}),rgb);assert.ok(studioEnhancementPixel(rgb,stable).every(value=>value>=0&&value<=1));
});

test('binário da primeira fase disponível não certifica assinatura seletiva que não reconhece',async()=>{
 let called=0;const api=bridge({...base,getStudioEnhancementCapabilitiesAsync:async()=>capability,analyzeStudioSceneAsync(){},exportRecipeAsync(){called++;},getStudioEditorCapabilitiesAsync:async()=>({version:1,available:true}),renderStudioRecipeThumbnailAsync(){called++;}});
 const recipe={version:3,requiredFeatures:['cinematic-signature-v1'],clips:[{signature:{version:1,strength:.85}}],assets:[]};
 assert.equal((await api.getStudioEnhancementCapabilitiesAsync()).available,true);
 assert.equal(api.studioRecipeTreatmentsSupported(recipe,await api.getStudioEnhancementCapabilitiesAsync()),false);
 await assert.rejects(api.exportRecipeAsync({requestId:'new',recipeJSON:JSON.stringify(recipe),outputUri:'file:///out.mp4'}),/Atualize/);
 await assert.rejects(api.renderStudioRecipeThumbnailAsync(JSON.stringify(recipe),'file:///out.jpg',0),/Atualize/);
 await assert.rejects(api.analyzeStudioSignatureSceneAsync({uri:'file:///original.mov',kind:'video',startSeconds:0,endSeconds:1,frameCount:1}),/Atualize/);assert.equal(called,0);
});
test('assinatura analisa pessoa e cenário reais; amostra incompatível nunca vira configuração',async()=>{
 const caps={...capability,features:[...capability.features,'cinematic-signature-v1']}, measurement={subject:sample,background:sample,personPresent:true,facePresent:true};
 const request={uri:'file:///source.mov',kind:'video',startSeconds:0,endSeconds:1,frameCount:1};
 const api=bridge({...base,getStudioEnhancementCapabilitiesAsync:async()=>caps,analyzeStudioSceneAsync(){},analyzeStudioSignatureSceneAsync:async()=>({version:1,samples:[measurement]})});
 assert.deepEqual(await api.analyzeStudioSignatureSceneAsync(request),[measurement]);
 for(const invalid of [{...measurement,subject:{...sample,p99:NaN}},{...measurement,facePresent:'yes'},{...measurement,background:{p50:.3}},null]){
 const bad=bridge({...base,getStudioEnhancementCapabilitiesAsync:async()=>caps,analyzeStudioSceneAsync(){},analyzeStudioSignatureSceneAsync:async()=>({version:1,samples:[invalid]})});
 await assert.rejects(bad.analyzeStudioSignatureSceneAsync(request),/confirmada/);
 }
});
