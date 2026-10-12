import {parseTusOffset,resolveTusLocation} from './uploadTransport.ts';
import type {RemoteCameraJournal,RemoteTakeJournal} from './remoteCameraJournal';
import type {StudioRemoteResponse} from './remoteCameraProtocol';

export const REMOTE_CAMERA_PART_BYTES=6*1024*1024;
type UploadDependencies={
  sessionId:string;deviceId:string;take:RemoteTakeJournal;check():void;
  request(action:string,body:Record<string,unknown>):Promise<StudioRemoteResponse>;
  fetch:typeof fetch;read(position:number,length:number):Promise<Uint8Array>;
  journal():Promise<RemoteCameraJournal>;
  mutate(change:(latest:RemoteCameraJournal)=>RemoteCameraJournal):Promise<RemoteCameraJournal>;
  onProgress?(receivedBytes:number):void;
};

/** A single bounded part at a time; the local original is never changed. */
export async function uploadRemoteCameraOriginal(deps:UploadDependencies) {
  const {take,sessionId,deviceId,check,request,fetch}=deps;
  if(!take.metadata||!Number.isSafeInteger(take.metadata.bytes)||take.metadata.bytes<=0)throw new Error('O original precisa de metadados antes do envio.');
  const totalParts=Math.ceil(take.metadata.bytes/REMOTE_CAMERA_PART_BYTES);
  for(let partIndex=0;partIndex<totalParts;partIndex++) {
    check();const response=await request('upload-start',{sessionId,deviceId,takeId:take.id,metadata:take.metadata,partIndex,recovered:true});check();
    // A lost upload-complete response must not create another signed overwrite.
    if(response.takes.some(value=>value.id===take.id&&value.status==='uploaded')){deps.onProgress?.(take.metadata.bytes);return;}
    const target=response.upload;
    const partOffset=partIndex*REMOTE_CAMERA_PART_BYTES,partBytes=Math.min(REMOTE_CAMERA_PART_BYTES,take.metadata.bytes-partOffset);
    if(!target||target.partIndex!==partIndex||target.partOffset!==partOffset||target.partBytes!==partBytes||target.totalParts!==totalParts
      ||target.chunkSize!==REMOTE_CAMERA_PART_BYTES||!target.bucket||!target.path
      ||new URL(target.endpoint).protocol!=='https:')throw new Error('O servidor não confirmou as partes deste original.');
    if(target.uploaded){deps.onProgress?.(partOffset+partBytes);continue;}
    if(typeof target.token!=='string'||!target.token)throw new Error('O servidor não confirmou a autorização desta parte.');
    const headers={'x-signature':target.token,'Tus-Resumable':'1.0.0'};
    let tusUrl=(await deps.journal()).takes.find(value=>value.id===take.id)?.partUrls?.[String(partIndex)];check();
    if(tusUrl) {
      tusUrl=resolveTusLocation(tusUrl,target.endpoint);
      const probe=await fetch(tusUrl,{method:'HEAD',headers});check();
      if([404,410].includes(probe.status))tusUrl=undefined;
      else if(!probe.ok)throw new Error('Não foi possível retomar esta parte do original.');
    }
    if(!tusUrl) {
      const metadata=Object.entries({bucketName:target.bucket,objectName:target.path,contentType:target.mime,cacheControl:'3600'})
        .map(([key,value])=>`${key} ${btoa(value)}`).join(',');
      const opened=await fetch(target.endpoint,{method:'POST',headers:{...headers,'Upload-Length':String(partBytes),'Upload-Metadata':metadata}});check();
      if(opened.status!==201)throw new Error('Não foi possível preparar esta parte do original.');
      tusUrl=resolveTusLocation(opened.headers.get('Location'),target.endpoint);
      const url=tusUrl;await deps.mutate(journal=>({...journal,takes:journal.takes.map(value=>value.id===take.id
        ?{...value,phase:'uploading',partUrls:{...value.partUrls,[String(partIndex)]:url}}:value)}));check();
    }
    const head=await fetch(tusUrl,{method:'HEAD',headers});check();
    if(!head.ok)throw new Error('Não foi possível confirmar o envio desta parte.');
    const offset=parseTusOffset(head.headers.get('Upload-Offset'),partBytes);
    deps.onProgress?.(partOffset+offset);
    if(offset<partBytes) {
      const length=partBytes-offset,bytes=await deps.read(partOffset+offset,length);check();
      if(bytes.length!==length)throw new Error('O original não entregou os bytes esperados.');
      const body=bytes.byteOffset===0&&bytes.buffer.byteLength===bytes.byteLength?bytes.buffer:bytes.slice().buffer;
      const patch=await fetch(tusUrl,{method:'PATCH',headers:{...headers,'Upload-Offset':String(offset),'Content-Type':'application/offset+octet-stream'},body:body as ArrayBuffer});check();
      if(patch.status!==204||parseTusOffset(patch.headers.get('Upload-Offset'),partBytes)!==partBytes)
        throw new Error('O envio foi pausado; a próxima tentativa retomará os bytes recebidos.');
      deps.onProgress?.(partOffset+partBytes);
    }
  }
  check();await request('upload-complete',{sessionId,takeId:take.id,deviceId});check();
}
