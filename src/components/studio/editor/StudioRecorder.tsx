import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Circle, Mic, Monitor, RefreshCw, Square, X } from 'lucide-react';
import { createStudioCapture, type StudioCaptureController, type StudioCaptureMode, type StudioCaptureState } from '@/lib/studio/editor/capture';

export function StudioRecorder({mode,onRecorded,onClose,disabled=false}:{mode:StudioCaptureMode;onRecorded(file:File):Promise<void>;onClose():void;disabled?:boolean}){
  const controller=useRef<StudioCaptureController|null>(null),video=useRef<HTMLVideoElement>(null);
  const [state,setState]=useState<StudioCaptureState>({phase:'idle',stream:null,elapsed:0,file:null,error:null,input:null,levels:[],camera:null,devices:{cameras:[],microphones:[]},microphoneEnabled:true}),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  const saved=useRef(false);
  useEffect(()=>{
    // StrictMode replays effects. Each setup owns a fresh controller and listener;
    // discarded render attempts never open a lifecycle outside this effect.
    const owned=createStudioCapture({mode});controller.current=owned;saved.current=false;setSaving(false);setError(null);
    const unsubscribe=owned.subscribe(setState);
    return()=>{if(controller.current===owned)controller.current=null;unsubscribe();owned.dispose();};
  },[mode]);
  useEffect(()=>{const element=video.current;if(element){element.srcObject=state.stream;if(state.stream)void element.play().catch(()=>{});}return()=>{if(element)element.srcObject=null;};},[state.stream]);
  const busy=disabled||saving||state.phase==='preparing'||state.phase==='stopping';
  const act=async(action:(owned:StudioCaptureController)=>void|Promise<unknown>)=>{const owned=controller.current;if(!owned)return;setError(null);try{await action(owned);}catch(value){if(controller.current===owned)setError((value as Error).message);}};
  const save=()=>act(async owned=>{if(!state.file||saved.current)return;setSaving(true);try{await onRecorded(state.file);if(controller.current===owned){saved.current=true;onClose();}}finally{if(controller.current===owned)setSaving(false);}});
  const close=()=>{if(saving)return;if(state.phase==='recording'||state.phase==='stopping'||state.file){if(!window.confirm('Descartar este trecho ainda não salvo?'))return;}controller.current?.cancel();onClose();};
  const icon=mode==='audio'?<Mic size={30}/>:mode==='screen'?<Monitor size={30}/>:<Camera size={30}/>;
  return <section aria-label={mode==='audio'?'Gravar narração':mode==='screen'?'Gravar tela':'Gravar câmera'} style={{display:'grid',gap:16,color:'white',background:'#09090b',borderRadius:20,padding:20,maxWidth:900,width:'100%'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><strong>{mode==='audio'?'Narração':mode==='screen'?'Gravar tela':'Câmera'}</strong><button type="button" aria-label="Fechar gravação" disabled={saving} onClick={close}><X size={22}/></button></div>
    <div style={{background:'#151518',borderRadius:16,overflow:'hidden',minHeight:mode==='audio'?120:220,display:'grid',placeItems:'center',position:'relative'}}>
      {mode!=='audio'?<video ref={video} muted playsInline autoPlay style={{width:'100%',maxHeight:'60vh',objectFit:'contain',display:state.stream?'block':'none'}}/>:null}
      {!state.stream||mode==='audio'?<div style={{padding:32,color:'#999',textAlign:'center'}}>{icon}<p>{state.phase==='preparing'?'Aguardando sua permissão…':mode==='audio'?'Grave sua voz para a montagem':'Ative a captura para enquadrar antes de gravar'}</p></div>:null}
      {state.phase==='recording'?<span style={{position:'absolute',top:12,left:12,background:'#d81240',padding:'6px 10px',borderRadius:8}}>● {formatClock(state.elapsed)}</span>:null}
    </div>
    {state.input?<div aria-label={`Microfone em uso: ${state.input.name}`} style={{display:'grid',gap:6}}><small>{state.input.name}</small><div style={{height:6,borderRadius:6,background:'#303036',overflow:'hidden'}}><div style={{width:`${Math.max(0,Math.min(100,((state.levels[0]?.averageDb??-120)+60)/60*100))}%`,height:'100%',background:(state.levels[0]?.peakDb??-120)>-3?'#f34b4b':'#50d19b'}}/></div><small style={{color:'#aaa'}}>{state.levels.length?`${state.levels[0].averageDb.toFixed(1)} dBFS`:'Aguardando amostra do microfone'}</small></div>:null}
    {(error||state.error)?<p role="alert" style={{color:'#fca5a5',margin:0}}>{error||state.error}</p>:null}
    {state.phase==='recorded'?<p style={{color:'#aaa',margin:0}}>Trecho de {formatClock(state.elapsed)}. O original será salvo quando você usar a gravação.</p>:null}
    <div style={{display:'flex',justifyContent:'center',gap:12,alignItems:'center'}}>
      {(state.phase==='idle'||state.phase==='error'&&!state.file)?<button type="button" disabled={busy} onClick={()=>void act(owned=>owned.prepare())} style={primary}>Ativar {mode==='camera'?'câmera':mode==='screen'?'tela e microfone':'microfone'}</button>:null}
      {state.phase==='error'&&state.file?<><button type="button" disabled={busy} onClick={()=>void act(owned=>owned.stop())}>Tentar ler trecho</button><button type="button" disabled={busy} onClick={()=>{const url=URL.createObjectURL(state.file!),link=document.createElement('a');link.href=url;link.download=state.file!.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Baixar original preservado</button></>:null}
      {state.phase==='ready'?<><button type="button" disabled={busy} aria-label="Iniciar gravação" onClick={()=>void act(owned=>owned.start())} style={{...primary,borderRadius:50,padding:18}}><Circle fill="#fff" size={24}/></button>{mode==='camera'?<button type="button" disabled={busy} aria-label="Trocar câmera" onClick={()=>void act(owned=>owned.flip())}><RefreshCw size={22}/></button>:null}</>:null}
      {state.phase==='recording'?<button type="button" aria-label="Encerrar gravação" disabled={disabled} onClick={()=>void act(owned=>owned.stop())} style={primary}><Square fill="#fff" size={20}/> Encerrar</button>:null}
      {busy&&!disabled?<span role="status">{saving?'Salvando original…':state.phase==='stopping'?'Preparando o trecho…':'Aguardando permissão…'}</span>:null}
      {state.phase==='recorded'?<><button type="button" disabled={busy} onClick={()=>{if(window.confirm('Descartar este trecho ainda não salvo e gravar outro?'))void act(owned=>{owned.cancel();return owned.prepare();});}}>Gravar outro</button><button type="button" disabled={busy} onClick={()=>void save()} style={primary}><Check size={20}/> Usar gravação</button></>:null}
    </div>
  </section>;
}
const primary={background:'#e71349',border:0,color:'#fff',padding:'12px 18px',borderRadius:12,display:'inline-flex',alignItems:'center',gap:8,fontWeight:600,cursor:'pointer'} as const;
function formatClock(seconds:number){return`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;}
