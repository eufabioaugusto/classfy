import { createClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { createLiveFetch, withLiveDeadline } from '@/features/live/request';
import type { StudioRemoteResponse } from './remoteCameraProtocol';

export type RemoteCameraScope = { isCurrent?: () => boolean; signal?: AbortSignal };
export function assertRemoteCameraScope(scope?: RemoteCameraScope) {
  if (scope?.signal?.aborted || scope?.isCurrent?.() === false) throw Object.assign(new Error('A conexão foi interrompida. Os originais continuam no iPhone.'), { name:'AbortError' });
}
export function readRemotePairingCode(value: string) {
  let code=value.trim();
  if (code.includes('://')) {
    const url=new URL(code);
    const trusted = url.protocol==='classfy:' && `${url.hostname}${url.pathname}`==='studio/remote-camera'
      || url.protocol==='https:' && url.hostname==='classfy.com.br' && ['/studio/iphone','/studio/remote-camera'].includes(url.pathname);
    if (!trusted || url.username || url.password || url.port) throw new Error('Este QR não é uma conexão do Studio Classfy.');
    code=url.searchParams.get('code') || '';
  }
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(code)) throw new Error('Digite o código exibido no Studio do computador.');
  return code;
}
/** A 6 MiB part may need >25 s on mobile uplinks. Commands retain 25 s. */
export function createRemoteUploadFetch(scope: RemoteCameraScope, provider: typeof fetch = fetch, timeoutMs=120_000): typeof fetch {
  return async(input,init)=>{
    assertRemoteCameraScope(scope);
    const combined=new AbortController(),signals=[scope.signal,init?.signal].filter((value):value is AbortSignal=>!!value);
    const abort=()=>combined.abort();
    signals.forEach(signal=>{if(signal.aborted)combined.abort();else signal.addEventListener('abort',abort,{once:true});});
    try{const response=await withLiveDeadline(signal=>provider(input,{...init,signal}),combined.signal,timeoutMs);assertRemoteCameraScope(scope);return response;}
    finally{signals.forEach(signal=>signal.removeEventListener('abort',abort));}
  };
}
export async function remoteCameraRequest(owner: string, action: string, body: Record<string,unknown>, scope?: RemoteCameraScope): Promise<StudioRemoteResponse> {
  const check=()=>assertRemoteCameraScope(scope); check();
  const {data,error}=await withLiveDeadline(()=>supabase.auth.getSession(),scope?.signal);
  if (error || data.session?.user.id!==owner || !data.session.access_token) throw new Error('Entre na mesma conta Classfy usada no computador.');
  const token=data.session.access_token;
  let changed=false;
  const subscription=supabase.auth.onAuthStateChange((_event,next)=>{ if(next?.user.id!==owner) changed=true; }).data.subscription;
  const current=()=>{ check(); if(changed) throw Object.assign(new Error('A conta mudou. O original permanece no iPhone.'),{name:'AbortError'}); };
  const client=createClient(process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{headers:{Authorization:`Bearer ${token}`},fetch:createLiveFetch(current,scope?.signal)},
  });
  try {
    const response=await withLiveDeadline(()=>client.functions.invoke('studio-camera',{body:{action,...body},signal:scope?.signal}),scope?.signal);
    current();
    if(response.error) {
      let message='Não foi possível conectar ao computador. Tente novamente.';
      try { const json=await withLiveDeadline(()=>response.error.context?.clone?.().json()) as {error?:unknown;message?:unknown}|undefined; if(typeof json?.error==='string') message=json.error; else if(typeof json?.message==='string') message=json.message; } catch {}
      throw new Error(message.replace(/(?:https?|wss?):\/\/\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gi,'[credencial omitida]').slice(0,500));
    }
    const value=response.data as StudioRemoteResponse;
    if (!value?.session?.id || !Number.isFinite(Date.parse(value.serverAt)) || !Array.isArray(value.commands) || !Array.isArray(value.takes)
      || (value.session as unknown as {ownerId?:string}).ownerId !== owner) throw new Error('O servidor não confirmou a conexão desta conta.');
    return value;
  } finally { subscription.unsubscribe(); }
}
