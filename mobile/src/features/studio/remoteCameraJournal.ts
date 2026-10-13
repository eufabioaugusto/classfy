import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { StudioRemoteMetadata,StudioRemoteConfiguration } from './remoteCameraProtocol';

export type RemoteTakeJournal = { id: string; uri: string; phase:'reserved'|'recording'|'local_ready'|'uploading'|'uploaded'|'error';
  sourceUri?:string;sourceMetadata?:StudioRemoteMetadata;imageGrade?:StudioRemoteConfiguration['imageGrade'];gradeSignature?:string;
  metadata?:StudioRemoteMetadata; projectId?:string; localTakeId?:string; tusUrl?:string; partUrls?:Record<string,string>; error?:string; startedAtServerMs?:number };
export type RemoteCameraJournal = {version:1;owner:string;sessionId:string;deviceId:string;projectId?:string;sequence:number;receipts:Record<string,Record<string,unknown>>;takes:RemoteTakeJournal[]};
const queue=new Map<string,Promise<unknown>>();
const key=(owner:string,id:string)=>`classfy:remote-camera:v1:${owner}:${id}`;
const uuid=(value:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function remoteMasterUri(owner:string,session:string,take:string) {
  if(![owner,session,take].every(uuid)||!FileSystem.documentDirectory) throw new Error('A identificação do original não é válida.');
  return `${FileSystem.documentDirectory}classfy-studio-remote/${owner}/${session}/${take}.mov`;
}
export async function readRemoteCameraJournal(owner:string,id:string,deviceId:string):Promise<RemoteCameraJournal> {
  if(![owner,id,deviceId].every(uuid))throw new Error('A identificação da conexão não é válida.');
  const value=await AsyncStorage.getItem(key(owner,id));
  if(!value) return {version:1,owner,sessionId:id,deviceId,sequence:0,receipts:{},takes:[]};
  const parsed=JSON.parse(value) as RemoteCameraJournal;
  if(parsed.version!==1 || parsed.owner!==owner || parsed.sessionId!==id || parsed.deviceId!==deviceId || !Array.isArray(parsed.takes)
    || !parsed.receipts || typeof parsed.receipts!=='object' || Array.isArray(parsed.receipts) || !Number.isSafeInteger(parsed.sequence) || parsed.sequence<0
    || Object.keys(parsed.receipts).some(key=>!uuid(key)) || new Set(parsed.takes.map(take=>take.id)).size!==parsed.takes.length) throw new Error('A conexão local precisa de recuperação. Seus originais continuam no iPhone.');
  return {...parsed,takes:parsed.takes.map(take=>{
    const prefix=remoteMasterUri(owner,id,take.id).split('/').slice(0,-1).join('/')+'/';
    if(!['reserved','recording','local_ready','uploading','uploaded','error'].includes(take.phase)||typeof take.uri!=='string')throw new Error('O diário deste original precisa de recuperação.');
    const relocate=(value:string)=>{const old=value.match(/classfy-studio-remote\/.+$/)?.[0];return old?`${FileSystem.documentDirectory}${old}`:value;};
    const uri=relocate(take.uri),sourceUri=take.sourceUri?relocate(take.sourceUri):undefined;
    const clean=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:-2k)?\.mov$/i;
    const graded=new RegExp(`^${take.id}-grade-[a-f0-9]{8,64}\\.mp4$`,'i');
    if(!uri.startsWith(prefix)||!(clean.test(uri.slice(prefix.length))||graded.test(uri.slice(prefix.length)))) throw new Error('Um original está fora desta conexão.');
    if(sourceUri&&(!sourceUri.startsWith(prefix)||!clean.test(sourceUri.slice(prefix.length))))throw new Error('A fonte deste take está fora da conexão.');
    const m=take.metadata;
    if(m&&(!Number.isSafeInteger(m.bytes)||m.bytes<=0||!['video/quicktime','video/mp4'].includes(m.mime)||![m.width,m.height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=7680)
      ||!Number.isFinite(m.fps)||m.fps<1||m.fps>120||!Number.isFinite(m.duration)||m.duration<=0||m.duration>86400))throw new Error('Os metadados deste original precisam de recuperação.');
    return {...take,uri,...(sourceUri?{sourceUri}:{})};
  })};
}
export function mutateRemoteCameraJournal(owner:string,id:string,deviceId:string,change:(latest:RemoteCameraJournal)=>RemoteCameraJournal):Promise<RemoteCameraJournal> {
  const storageKey=key(owner,id), previous=queue.get(storageKey)||Promise.resolve();
  const write=previous.catch(()=>undefined).then(async()=>{
    const latest=await readRemoteCameraJournal(owner,id,deviceId), next=change(latest);
    if(next.owner!==owner||next.sessionId!==id||next.deviceId!==deviceId) throw new Error('A conexão mudou durante o salvamento.');
    await AsyncStorage.setItem(storageKey,JSON.stringify(next));
    return next;
  });
  queue.set(storageKey,write); void write.finally(()=>{if(queue.get(storageKey)===write)queue.delete(storageKey);}).catch(()=>undefined); return write;
}
