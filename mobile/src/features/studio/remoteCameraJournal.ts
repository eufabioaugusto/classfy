import type {StudioNativeCaptureReceipt} from '../../../modules/classfy-studio-media';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { StudioRemoteMetadata,StudioRemoteConfiguration,StudioRemoteRecordingEnd } from './remoteCameraProtocol';

export type RemoteTakeJournal = { id: string; uri: string; phase:'reserved'|'recording'|'local_ready'|'uploading'|'uploaded'|'error';
  localSaved?:boolean;captureReceipt?:StudioNativeCaptureReceipt;recordingEnd?:StudioRemoteRecordingEnd;
  sourceUri?:string;sourceMetadata?:StudioRemoteMetadata;imageGrade?:StudioRemoteConfiguration['imageGrade'];gradeSignature?:string;
  metadata?:StudioRemoteMetadata; projectId?:string; localTakeId?:string; tusUrl?:string; partUrls?:Record<string,string>; error?:string; startedAtServerMs?:number };
export type RemoteCameraJournal = {version:1;owner:string;sessionId:string;deviceId:string;projectId?:string;sequence:number;receipts:Record<string,Record<string,unknown>>;takes:RemoteTakeJournal[]};
const queue=new Map<string,Promise<unknown>>();
const key=(owner:string,id:string)=>`classfy:remote-camera:v1:${owner}:${id}`;
const uuid=(value:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export async function readRemoteCameraJournals(owner:string,deviceId:string):Promise<RemoteCameraJournal[]> {
  if(!uuid(owner)||!uuid(deviceId))throw new Error('A conta local não foi confirmada.');
  const prefix=`classfy:remote-camera:v1:${owner}:`,keys=await AsyncStorage.getAllKeys(),journals:RemoteCameraJournal[]=[];
  for(const value of keys){if(!value.startsWith(prefix)||!uuid(value.slice(prefix.length)))continue;
    try{journals.push(await readRemoteCameraJournal(owner,value.slice(prefix.length),deviceId));}catch{/* A malformed journal cannot expose another account's media. */}}
  return journals;
}
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
    for(const m of [take.metadata,take.sourceMetadata]){
    if(m&&(!Number.isSafeInteger(m.bytes)||m.bytes<=0||!['video/quicktime','video/mp4'].includes(m.mime)||![m.width,m.height].every(value=>Number.isSafeInteger(value)&&value>0&&value<=7680)
      ||!Number.isFinite(m.fps)||m.fps<1||m.fps>120||!Number.isFinite(m.duration)||m.duration<=0||m.duration>86400))throw new Error('Os metadados deste original precisam de recuperação.');
    }
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

/** Read only the native sidecar derived from this owner's immutable raw path. */
export async function readRemoteCameraCaptureReceipt(owner:string,sessionId:string,takeId:string):Promise<StudioNativeCaptureReceipt|null>{
  const uri=remoteMasterUri(owner,sessionId,takeId)+'.capture.json';
  try{
    const info=await FileSystem.getInfoAsync(uri);
    if(!info.exists||info.isDirectory||!('size'in info)||!Number.isSafeInteger(info.size)||info.size<=0||info.size>4096)return null;
    const text=await FileSystem.readAsStringAsync(uri);if(new TextEncoder().encode(text).byteLength>4096)return null;
    const value=JSON.parse(text) as Record<string,unknown>,reasons=['user_stop','app_background','view_inactive','disposed','capture_interrupted','runtime_error','startup_timeout','native_finished'];
    const positive=(number:unknown):number is number=>typeof number==='number'&&Number.isFinite(number)&&number>0;
    const monotonic=typeof value?.wallDurationSeconds==='number'&&Number.isFinite(value.wallDurationSeconds)&&value.wallDurationSeconds>=0&&value.wallDurationSeconds<=86400;
    if(!value||typeof value!=='object'||Array.isArray(value)||value.version!==1||value.operationId!==takeId||!positive(value.requestedAtEpochMs)||!positive(value.finishedAtEpochMs)||!monotonic&&value.finishedAtEpochMs<value.requestedAtEpochMs||!reasons.includes(String(value.stopReason))||typeof value.interrupted!=='boolean')return null;
    const receipt:StudioNativeCaptureReceipt={version:1,operationId:takeId,requestedAtEpochMs:value.requestedAtEpochMs,finishedAtEpochMs:value.finishedAtEpochMs,stopReason:value.stopReason as StudioNativeCaptureReceipt['stopReason'],interrupted:value.interrupted};
    for(const key of ['startedAtEpochMs','stopRequestedAtEpochMs'] as const){const n=value[key];if(n!==undefined){if(!positive(n)||!monotonic&&(n<receipt.requestedAtEpochMs||n>receipt.finishedAtEpochMs))return null;receipt[key]=n;}}
    for(const key of ['wallDurationSeconds','mediaDurationSeconds'] as const){const n=value[key];if(n!==undefined){if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>86400)return null;receipt[key]=n;}}
    if(value.requestedStopReason!==undefined){if(!reasons.includes(String(value.requestedStopReason)))return null;receipt.requestedStopReason=value.requestedStopReason as StudioNativeCaptureReceipt['stopReason'];}
    if(Number.isSafeInteger(value.interruptionReason))receipt.interruptionReason=value.interruptionReason as number;
    for(const key of ['freeDiskBytesAtStart','freeDiskBytesAtEnd'] as const)if(Number.isSafeInteger(value[key])&&Number(value[key])>=0)receipt[key]=value[key] as number;
    for(const key of ['thermalStateAtStart','thermalStateAtEnd'] as const)if(['nominal','fair','serious','critical','unknown'].includes(String(value[key])))receipt[key]=value[key] as StudioNativeCaptureReceipt[typeof key];
    const error=value.nativeError as Record<string,unknown>|undefined;
    if(error&&typeof error==='object'&&!Array.isArray(error)&&typeof error.domain==='string'&&/^[a-zA-Z0-9_.-]{1,120}$/.test(error.domain)&&Number.isSafeInteger(error.code))receipt.nativeError={domain:error.domain,code:error.code as number,...(typeof error.recordingSuccessfullyFinished==='boolean'?{recordingSuccessfullyFinished:error.recordingSuccessfullyFinished}:{})};
    return receipt;
  }catch{return null;}
}
