import type { StudioSignatureRequest,StudioSignatureResponse } from './signature.worker';
export type StudioSignatureDetector={prepare(signal?:AbortSignal):Promise<void>;analyze(bitmap:ImageBitmap,signal?:AbortSignal):Promise<StudioSignatureResponse>;dispose():void};
const aborted=()=>new DOMException('A assinatura foi encerrada.','AbortError');
export function createStudioSignatureDetector():StudioSignatureDetector{
  let worker:Worker|null=null,closed=false,serial=0;const pending=new Map<number,{resolve(value:StudioSignatureResponse):void;reject(error:unknown):void;clean():void}>();
  const fail=(error:unknown)=>{for(const request of pending.values()){request.clean();request.reject(error);}pending.clear();worker?.terminate();worker=null;};
  function initialize(){if(worker)return worker;worker=new Worker(new URL('./signature.worker.ts',import.meta.url),{type:'module'});worker.onmessage=({data}:MessageEvent<StudioSignatureResponse>)=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);request.clean();if(data.error)request.reject(new Error(`Não foi possível aplicar a assinatura: ${data.error}`));else request.resolve(data);};worker.onerror=()=>fail(new Error('O processamento da assinatura foi interrompido. Reabra o editor para continuar.'));worker.onmessageerror=()=>fail(new Error('A separação da pessoa não pôde ser lida.'));return worker;}
  function request(bitmap:ImageBitmap|null,signal?:AbortSignal):Promise<StudioSignatureResponse>{
    if(closed||signal?.aborted){bitmap?.close();return Promise.reject(aborted());}let target:Worker;try{target=initialize();}catch{bitmap?.close();return Promise.reject(new Error('Este navegador não permite a assinatura local.'));}const id=++serial;
    return new Promise((resolve,reject)=>{const abort=()=>{const own=pending.get(id);if(!own)return;pending.delete(id);own.clean();reject(aborted());};const timer=setTimeout(()=>{if(pending.has(id))fail(new Error('A assinatura excedeu o tempo de processamento. Reabra o editor para continuar.'));},90000);const clean=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};pending.set(id,{resolve,reject,clean});signal?.addEventListener('abort',abort,{once:true});try{const data:StudioSignatureRequest=bitmap?{type:'analyze',id,bitmap}:{type:'prepare',id};target.postMessage(data,bitmap?[bitmap]:[]);}catch(error){pending.delete(id);clean();bitmap?.close();reject(error);}});
  }
  return{async prepare(signal){await request(null,signal);},analyze:request,dispose(){if(closed)return;closed=true;fail(aborted());}};
}
