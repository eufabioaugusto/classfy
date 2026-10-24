import * as FileSystem from 'expo-file-system/legacy';
import {ImageManipulator,SaveFormat} from 'expo-image-manipulator';
import {randomUUID} from 'expo-crypto';
import {generateThumbnailAsync} from '../../../modules/classfy-studio-media';
import {decodeBase64Bytes} from './uploadTransport';
import {remoteMasterUri} from './remoteCameraJournal';
import {REMOTE_THUMBNAIL_MAX_BYTES,REMOTE_THUMBNAIL_MAX_EDGE,type RemoteThumbnailImage,type RemoteThumbnailJob} from './remoteCameraThumbnailQueue';

/** Validate the actual bounded JPEG, including its encoded frame dimensions. */
export function readRemoteThumbnailJpeg(base64:string):RemoteThumbnailImage|null{
  if(!base64||base64.length>4*Math.ceil(REMOTE_THUMBNAIL_MAX_BYTES/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)||base64.length%4!==0)return null;
  const data=decodeBase64Bytes(base64);
  if(data.length<4||data.length>REMOTE_THUMBNAIL_MAX_BYTES||data[0]!==255||data[1]!==216||data[data.length-2]!==255||data[data.length-1]!==217)return null;
  let offset=2;
  while(offset+3<data.length){
    if(data[offset++]!==255)return null;while(data[offset]===255)offset++;
    const marker=data[offset++];if(marker===217||marker===218)return null;
    if(marker===1||marker>=208&&marker<=215)continue;
    const length=data[offset]*256+data[offset+1];if(length<2||offset+length>data.length)return null;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
      if(length<8)return null;const height=data[offset+3]*256+data[offset+4],width=data[offset+5]*256+data[offset+6];
      if(width<=0||height<=0||Math.max(width,height)>REMOTE_THUMBNAIL_MAX_EDGE)return null;
      return {version:1,mime:'image/jpeg',base64,bytes:data.length,width,height};
    }offset+=length;
  }return null;
}
export function remoteThumbnailCacheUri(owner:string,job:RemoteThumbnailJob){
  const m=job.metadata,signature=[m.bytes,m.width,m.height,Math.round(m.duration*1000),Math.round(m.fps*1000)];
  if(signature.some(value=>!Number.isSafeInteger(value)||value<=0))throw new Error('O original não confirmou os metadados da miniatura.');
  return `${remoteMasterUri(owner,job.sessionId,job.takeId)}.thumb-v1-${signature.join('-')}.jpg`;
}
type Scope={check():void};
/** Extracts one frame, never copies/reencodes the MOV. The native frame decode has no cancellation API. */
export async function prepareRemoteCameraThumbnail(owner:string,job:RemoteThumbnailJob,scope:Scope):Promise<RemoteThumbnailImage>{
  const cache=remoteThumbnailCacheUri(owner,job),temporary=new Set<string>();
  const read=async(uri:string)=>{
    scope.check();const info=await FileSystem.getInfoAsync(uri);scope.check();
    if(!info.exists||info.isDirectory||!('size'in info)||!Number.isSafeInteger(info.size)||info.size<=0||info.size>REMOTE_THUMBNAIL_MAX_BYTES)return null;
    const base64=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});scope.check();return readRemoteThumbnailJpeg(base64);
  };
  try{
    const cached=await read(cache);if(cached)return cached;
    scope.check();const source=await FileSystem.getInfoAsync(job.sourceUri);scope.check();
    if(!source.exists||source.isDirectory||!('size'in source)||source.size!==job.metadata.bytes)throw new Error('O original desta miniatura não está disponível.');
    if(!FileSystem.cacheDirectory)throw new Error('O cache de miniaturas não está disponível.');
    const frame=`${FileSystem.cacheDirectory}classfy-remote-thumbnail-${randomUUID()}.jpg`;temporary.add(frame);
    await generateThumbnailAsync(job.sourceUri,frame,Math.min(.5,job.metadata.duration/2));scope.check();
    for(const edge of [320,192]){
      const context=ImageManipulator.manipulate(frame);let original:Awaited<ReturnType<typeof context.renderAsync>>|undefined,resized:typeof original;
      try{
        original=await context.renderAsync();scope.check();
        const scale=Math.min(1,edge/Math.max(original.width,original.height));
        context.resize({width:Math.max(1,Math.round(original.width*scale)),height:Math.max(1,Math.round(original.height*scale))});
        resized=await context.renderAsync();scope.check();
        for(const compress of [.65,.45,.28,.16]){
          const output=await resized.saveAsync({format:SaveFormat.JPEG,compress});temporary.add(output.uri);scope.check();
          const image=await read(output.uri);if(!image)continue;
          // A lost network ACK must retry the exact same JPEG. Keep this tiny file
          // with the immutable raw, outside the purgeable image-manipulator cache.
          const existing=await read(cache);if(existing)return existing;
          scope.check();await FileSystem.copyAsync({from:output.uri,to:cache});scope.check();return image;
        }
      }finally{resized?.release();original?.release();context.release();}
    }throw new Error('Não foi possível reduzir esta miniatura com segurança.');
  }finally{await Promise.all([...temporary].map(uri=>FileSystem.deleteAsync(uri,{idempotent:true}).catch(()=>undefined)));}
}
