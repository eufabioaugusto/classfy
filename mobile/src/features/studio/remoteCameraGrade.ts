import * as FileSystem from 'expo-file-system/legacy';
import {CryptoDigestAlgorithm,digestStringAsync,randomUUID} from 'expo-crypto';
import {supabase} from '@/lib/supabase';
import {withLiveDeadline} from '@/features/live/request';
import {cancelExportAsync,exportRecipeAsync,getMediaInfoAsync,getStudioExportCapabilitiesAsync,
  type StudioMediaInfo,type StudioExportResult} from '../../../modules/classfy-studio-media';
import {STUDIO_RENDER_VERSION,compileStudioRecipe,emptyStudioEditing,reconcileStudioTakes,studioOutputSupported,validateStudioGrade,validateStudioRecipe,
  type StudioGrade,type StudioRenderRecipe} from './model';

export type RemoteCameraGradeOptions={owner:string;sessionId:string;takeId:string;sourceUri:string;imageGrade?:StudioGrade;
  shouldContinue?:()=>boolean;onProgress?:(progress:number,stage:'preparing'|'rendering'|'complete')=>void};
export type RemoteCameraGradedMaster={uri:string;metadata:{bytes:number;mime:string;width:number;height:number;fps:number;duration:number};
  imageGrade:StudioGrade;signature:string};
type Dependencies={fs:Pick<typeof FileSystem,'documentDirectory'|'getInfoAsync'|'readAsStringAsync'|'writeAsStringAsync'|'moveAsync'>;
  owner():Promise<string|undefined>;info(uri:string):Promise<StudioMediaInfo>;capabilities:typeof getStudioExportCapabilitiesAsync;
  digest(text:string):Promise<string>;uuid():string;export(options:{requestId:string;recipeJSON:string;outputUri:string},progress:(value:number)=>void):Promise<StudioExportResult>;
  cancel(id:string):Promise<void>};
const version=1,uuid=(value:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const identity:StudioGrade={preset:'natural',intensity:1,exposure:0,contrast:0,saturation:0,temperature:0};
const isIdentity=(grade:StudioGrade)=>grade.intensity===0||grade.preset==='natural'&&[grade.exposure,grade.contrast,grade.saturation,grade.temperature].every(value=>value===0);
type Receipt={version:number;signature:string;source:string;imageGrade:StudioGrade;state:'rendering'|'complete';metadata?:RemoteCameraGradedMaster['metadata']};

/** Export after STOP; immutable clean input and bounded native encoder remain
 * separate from the lightweight live preview. Only platform IO is injectable. */
export function createRemoteCameraGradeRenderer(deps:Dependencies) {
  const active=new Map<string,Promise<RemoteCameraGradedMaster>>();
  return async function prepare(incoming:RemoteCameraGradeOptions):Promise<RemoteCameraGradedMaster> {
    const options={...incoming,imageGrade:incoming.imageGrade?{...incoming.imageGrade}:undefined};
    const check=()=>{if(options.shouldContinue?.()===false)throw Object.assign(new Error('Preparação pausada. O original limpo continua no iPhone.'),{name:'AbortError'});};
    const owner=async()=>{check();if(await deps.owner()!==options.owner)throw new Error('A conta mudou. O original limpo continua no iPhone.');check();};
    await owner();
    if(![options.owner,options.sessionId,options.takeId].every(uuid)||!deps.fs.documentDirectory)throw new Error('A identificação do original não é válida.');
    const directory=`${deps.fs.documentDirectory}classfy-studio-remote/${options.owner}/${options.sessionId}/`;
    if(!options.sourceUri.startsWith(directory)||!/^[-a-f0-9]+(?:-2k)?\.mov$/i.test(options.sourceUri.slice(directory.length)))throw new Error('O original está fora desta conexão.');
    const selected=options.imageGrade||identity;
    const grade:StudioGrade={preset:selected.preset,intensity:selected.intensity,exposure:selected.exposure,contrast:selected.contrast,saturation:selected.saturation,temperature:selected.temperature};
    if(validateStudioGrade(grade).length)throw new Error('Revise os ajustes de imagem antes de preparar o original.');
    options.onProgress?.(0,'preparing');
    const source=await deps.info(options.sourceUri);await owner();
    if(!source.hasVideo||!Number.isSafeInteger(source.fileSize)||source.fileSize<=0||!Number.isFinite(source.duration)||source.duration<=0
      ||!Number.isFinite(source.frameRate)||source.frameRate!<=0||source.frameRate!>60.05||!source.width||!source.height)throw new Error('O original ainda não é um vídeo completo. Ele permanece no iPhone.');
    const metadata=(info:StudioMediaInfo,mime:string)=>({bytes:info.fileSize,mime,width:info.width,height:info.height,fps:info.frameRate!,duration:info.duration});
    const signature=await deps.digest(JSON.stringify([version,STUDIO_RENDER_VERSION,options.owner,options.sessionId,options.takeId,options.sourceUri.slice(directory.length),
      source.fileSize,source.width,source.height,source.frameRate,source.duration,source.hasAudio,grade]));check();
    if(isIdentity(grade)){options.onProgress?.(1,'complete');return {uri:options.sourceUri,metadata:metadata(source,'video/quicktime'),imageGrade:grade,signature};}
    const outputUri=`${directory}${options.takeId}-grade-${signature}.mp4`,receiptUri=`${outputUri}.json`;
    const existing=active.get(outputUri);if(existing){const result=await existing;await owner();return result;}
    const sourceKey=`classfy-studio-remote/${options.owner}/${options.sessionId}/${options.sourceUri.slice(directory.length)}`;
    const kind=source.width>=source.height?'aula':'short';
    const take={id:options.takeId,uri:options.sourceUri,name:'Original limpo',duration:source.duration,start:0,end:source.duration,
      width:source.width,height:source.height,frameRate:source.frameRate,hasAudio:source.hasAudio,colorSpace:source.colorSpace,grade};
    const editing=reconcileStudioTakes({kind,takes:[],editing:emptyStudioEditing(kind)},[take]);
    const recipe:StudioRenderRecipe=compileStudioRecipe({kind,takes:[take],editing});
    if(validateStudioRecipe(recipe).length||recipe.output.width!==source.width||recipe.output.height!==source.height
      ||Math.abs(recipe.output.frameRateNumerator/recipe.output.frameRateDenominator-source.frameRate!)>0.02)throw new Error('Este perfil não preserva a resolução/FPS do original. O arquivo limpo foi mantido.');
    const matches=(info:StudioMediaInfo)=>info.hasVideo&&(!source.hasAudio||info.hasAudio)&&info.fileSize>0&&info.width===source.width&&info.height===source.height
      &&Number.isFinite(info.frameRate)&&Math.abs(info.frameRate!-source.frameRate!)<0.02&&Number.isFinite(info.duration)
      &&Math.abs(info.duration-source.duration)<=Math.max(0.1,2/source.frameRate!);
    const receipt:Receipt={version,signature,source:sourceKey,imageGrade:grade,state:'rendering'};
    const run=(async()=>{
      let saved:Receipt|undefined;
      try{saved=JSON.parse(await deps.fs.readAsStringAsync(receiptUri));}catch{/* Missing receipt is written before starting the encoder. */}
      const belongs=saved?.version===version&&saved.signature===signature&&saved.source===sourceKey&&JSON.stringify(saved.imageGrade)===JSON.stringify(grade);
      const file=await deps.fs.getInfoAsync(outputUri);await owner();
      if(file.exists&&!file.isDirectory){
        if(!belongs)throw new Error('Um derivado anterior precisa de recuperação. O original limpo continua salvo.');
        let cached:StudioMediaInfo|undefined;try{cached=await deps.info(outputUri);}catch{/* Preserve bad output below and re-encode. */}await owner();
        if(cached&&matches(cached)&&(!saved?.metadata||cached.fileSize===saved.metadata.bytes)){
          const result={uri:outputUri,metadata:metadata(cached,'video/mp4'),imageGrade:grade,signature};
          await deps.fs.writeAsStringAsync(receiptUri,JSON.stringify({...receipt,state:'complete',metadata:result.metadata}));await owner();options.onProgress?.(1,'complete');return result;
        }
        // Preserve even an invalid derivative; never unlink/replace the raw MOV.
        await deps.fs.moveAsync({from:outputUri,to:`${outputUri}.invalid-${deps.uuid()}`});await owner();
      }
      if(!studioOutputSupported(recipe.output,await deps.capabilities()))throw new Error('Atualize o Classfy Dev para preparar o original tratado nesta resolução. O arquivo limpo foi mantido.');
      await owner();await deps.fs.writeAsStringAsync(receiptUri,JSON.stringify(receipt));await owner();
      const requestId=`remote-grade-${deps.uuid()}`;let cancelling=false;
      const progress=(value:number)=>{if(options.shouldContinue?.()===false){if(!cancelling){cancelling=true;void deps.cancel(requestId).catch(()=>undefined);}return;}options.onProgress?.(Math.max(0,Math.min(1,value)),'rendering');};
      options.onProgress?.(0,'rendering');
      const watch=setInterval(()=>{if(options.shouldContinue?.()===false&&!cancelling){cancelling=true;void deps.cancel(requestId).catch(()=>undefined);}},200);
      let encoded:StudioExportResult;
      try{check();encoded=await deps.export({requestId,recipeJSON:JSON.stringify(recipe),outputUri},progress);}finally{clearInterval(watch);}
      await owner();const actual=await deps.info(encoded.uri);await owner();
      if(encoded.uri!==outputUri||!matches(actual)||encoded.mimeType!=='video/mp4')throw new Error('O derivado não preservou imagem, FPS, duração ou áudio. O original limpo continua salvo.');
      const result={uri:outputUri,metadata:metadata(actual,'video/mp4'),imageGrade:grade,signature};
      await deps.fs.writeAsStringAsync(receiptUri,JSON.stringify({...receipt,state:'complete',metadata:result.metadata}));await owner();options.onProgress?.(1,'complete');return result;
    })();active.set(outputUri,run);
    try{return await run;}finally{if(active.get(outputUri)===run)active.delete(outputUri);}
  };
}
export const prepareRemoteCameraGradedMaster=createRemoteCameraGradeRenderer({fs:FileSystem,
  owner:async()=>{const {data}=await withLiveDeadline(()=>supabase.auth.getSession());return data.session?.user.id;},info:getMediaInfoAsync,capabilities:getStudioExportCapabilitiesAsync,
  digest:text=>digestStringAsync(CryptoDigestAlgorithm.SHA256,text),uuid:randomUUID,export:exportRecipeAsync,cancel:cancelExportAsync});
