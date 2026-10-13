import { FaceLandmarker,FilesetResolver,ImageSegmenter } from '@mediapipe/tasks-vision';
import type { StudioPortraitFace } from './portraitMask';
import { studioSignatureMulticlassPerson } from './signatureMask';
export type StudioSignatureRequest={type:'prepare';id:number}|{type:'analyze';id:number;bitmap:ImageBitmap};
export type StudioSignatureResponse={id:number;width?:number;height?:number;personAlpha?:Float32Array;faceLandmarks?:StudioPortraitFace;error?:string};
type Scope={location:{origin:string};onmessage:((event:MessageEvent<StudioSignatureRequest>)=>void)|null;postMessage(message:StudioSignatureResponse,transfer?:Transferable[]):void};
const scope=self as unknown as Scope,wasm='/studio/portrait/mediapipe-1.1.0';
let face:Promise<FaceLandmarker>|null=null,segmenterTask:Promise<ImageSegmenter>|null=null,queue=Promise.resolve();
let initialization=Promise.resolve(),factoryId=0,fileset:Promise<Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>>|null=null;
async function asset(path:string,bytes:number,cacheName:string){
  const url=new URL(path,scope.location.origin).href;let cache:Cache|undefined;try{cache=await caches.open(cacheName);const hit=await cache.match(url);if(hit){const value=new Uint8Array(await hit.arrayBuffer());if(value.length===bytes)return value;await cache.delete(url);}}catch{/* Cache is optional; model inference still uses validated local bytes. */}
  const response=await fetch(url,{cache:'force-cache'});if(!response.ok)throw new Error('O modelo local da assinatura não pôde ser carregado.');const value=new Uint8Array(await response.clone().arrayBuffer());if(value.length!==bytes)throw new Error('O modelo da assinatura está incompleto.');try{await cache?.put(url,response);}catch{/* Cache is optional; model inference still uses validated local bytes. */}return value;
}
function files(){
  if(fileset)return fileset;
  const work=FilesetResolver.forVisionTasks(new URL(wasm,scope.location.origin).href,true);fileset=work;void work.catch(()=>{if(fileset===work)fileset=null;});return work;
}
function construct<T>(create:(files:Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>)=>Promise<T>):Promise<T>{
  const work=initialization.then(async()=>{
    const shared=await files(),loader=new URL(shared.wasmLoaderPath,scope.location.origin);
    // Tasks Vision clears its global ModuleFactory after constructing a task. A cached ESM import
    // cannot register it again. Each serialized construction gets a distinct loader module URL;
    // bytes stay official and the heavy WASM path/cache are shared, including after a failed init.
    loader.searchParams.set('classfy-signature-init',String(++factoryId));
    return create({...shared,wasmLoaderPath:loader.href});
  });initialization=work.then(()=>undefined,()=>undefined);return work;
}
function faceTask(){if(face)return face;const work=construct(async files=>FaceLandmarker.createFromOptions(files,{canvas:new OffscreenCanvas(1,1),baseOptions:{modelAssetBuffer:await asset('/studio/portrait/face-landmarker-float16-v1.task',3758596,'classfy-portrait-face-landmarker-float16-v1'),delegate:'GPU'},runningMode:'IMAGE',numFaces:1,minFaceDetectionConfidence:.6,minFacePresenceConfidence:.6,outputFaceBlendshapes:false,outputFacialTransformationMatrixes:false}));face=work;void work.catch(()=>{if(face===work)face=null;});return work;}
function segmentTask(){
  if(segmenterTask)return segmenterTask;
  const work=construct(async files=>ImageSegmenter.createFromOptions(files,{canvas:new OffscreenCanvas(1,1),baseOptions:{modelAssetBuffer:await asset('/studio/signature/selfie-multiclass-256-float32-v1.tflite',16371837,'classfy-signature-selfie-multiclass-256-float32-v1'),delegate:'GPU'},runningMode:'IMAGE',outputConfidenceMasks:true,outputCategoryMask:false}));segmenterTask=work;void work.catch(()=>{if(segmenterTask===work)segmenterTask=null;});return work;
}
scope.onmessage=({data}:MessageEvent<StudioSignatureRequest>)=>{
  queue=queue.then(async()=>{try{
    if(!await FilesetResolver.isSimdSupported())throw new Error('Este navegador não oferece o processamento local necessário para a assinatura.');
    if(data.type==='prepare'){await Promise.all([faceTask(),segmentTask()]);scope.postMessage({id:data.id});return;}
    const[detector,segmenter]=await Promise.all([faceTask(),segmentTask()]);let output:StudioSignatureResponse|undefined;
    segmenter.segment(data.bitmap,result=>{const masks=result.confidenceMasks;if(!masks?.length)throw new Error('A separação da pessoa não entregou uma máscara.');const width=masks[0].width,height=masks[0].height;if(masks.some(mask=>mask.width!==width||mask.height!==height))throw new Error('As classes da pessoa não correspondem ao mesmo quadro.');const personAlpha=studioSignatureMulticlassPerson(masks.map(mask=>mask.getAsFloat32Array()),width,height,segmenter.getLabels());output={id:data.id,width,height,personAlpha};});
    if(!output?.personAlpha)throw new Error('A máscara da pessoa não foi concluída.');output.faceLandmarks=(detector.detect(data.bitmap).faceLandmarks[0]??[]).map(point=>({x:point.x,y:point.y}));scope.postMessage(output,[output.personAlpha.buffer]);
  }catch(error){scope.postMessage({id:data.id,error:error instanceof Error?error.message:'A assinatura local falhou.'});}finally{if(data.type==='analyze')data.bitmap.close();}});
};
