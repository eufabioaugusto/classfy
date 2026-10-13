import AsyncStorage from '@react-native-async-storage/async-storage';

const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const sessionKey=(owner:string)=>`classfy:remote-camera:last:${owner}`;
const browserKey=(owner:string)=>`classfy:remote-camera:browser:${owner}`;
export async function readRememberedRemoteBrowser(owner:string){
  const [last,controller]=await Promise.all([AsyncStorage.getItem(sessionKey(owner)),AsyncStorage.getItem(browserKey(owner))]);
  return {sessionId:uuid(last)?last:null,controllerId:uuid(controller)?controller:null};
}
export async function rememberRemoteBrowser(owner:string,controllerId:string,sessionId?:string){
  if(!uuid(owner)||!uuid(controllerId)||sessionId!==undefined&&!uuid(sessionId))throw new Error('O vínculo do computador não foi confirmado.');
  await AsyncStorage.setItem(browserKey(owner),controllerId);
  if(sessionId)await AsyncStorage.setItem(sessionKey(owner),sessionId);
}
/** Forget only the pairing preference; recovery journals and originals stay available. */
export async function forgetRemoteBrowser(owner:string){await AsyncStorage.removeItem(browserKey(owner));}
export function mayResumeRemoteCameraAutomatically(value:{focused:boolean;foreground:boolean;permissionsGranted:boolean;hasSavedPairing:boolean;
  allowed:boolean;joining:boolean;connected:boolean;scanning:boolean;leaving:boolean;hasExplicitCode:boolean}){
  return value.focused&&value.foreground&&value.permissionsGranted&&value.hasSavedPairing&&value.allowed
    &&!value.joining&&!value.connected&&!value.scanning&&!value.leaving&&!value.hasExplicitCode;
}
