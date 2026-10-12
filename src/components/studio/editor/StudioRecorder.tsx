import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Circle, Mic, Monitor, RefreshCw, Settings2, Square, X } from 'lucide-react';
import { createStudioCapture, type StudioCaptureController, type StudioCaptureMode, type StudioCaptureState, type StudioCaptureVideoPatch } from '@/lib/studio/editor/capture';
import { useStudioConfirmation } from './useStudioConfirmation';
import { StudioRecordingQuality } from './StudioRecordingQuality';
import { StudioRecordingTools, type RecordingGuides } from './StudioRecordingTools';
import '@/styles/studio-recording.css';

export function StudioRecorder({mode,onRecorded,onClose,disabled=false,scopeKey=mode,aspectRatio='16:9'}:{mode:StudioCaptureMode;aspectRatio?:'16:9'|'9:16';onRecorded(file:File):Promise<void>;onClose():void;disabled?:boolean;scopeKey?:string}){
  const controller=useRef<StudioCaptureController|null>(null),video=useRef<HTMLVideoElement>(null);
  const [state,setState]=useState<StudioCaptureState>({phase:'idle',stream:null,elapsed:0,file:null,error:null,input:null,levels:[],camera:null,devices:{cameras:[],microphones:[]},microphoneEnabled:true}),[saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
  const [toolsOpen,setToolsOpen]=useState(false),closeTools=useCallback(()=>setToolsOpen(false),[]);
  const saved=useRef(false),savingNow=useRef(false),operation=useRef(0),question=useRef<object|null>(null);
  const snapshot=useRef(state),props=useRef({onRecorded,onClose,disabled,scopeKey});props.current={onRecorded,onClose,disabled,scopeKey};
  const {confirm,cancel,pending,dialog}=useStudioConfirmation(`${scopeKey}:${mode}`);

  useEffect(()=>{
    // StrictMode replays effects. Each setup owns a fresh controller and listener;
    // discarded render attempts never open a lifecycle outside this effect.
    const owned=createStudioCapture({mode,aspectRatio});controller.current=owned;saved.current=false;savingNow.current=false;operation.current++;question.current=null;setSaving(false);setError(null);setToolsOpen(false);
    const unsubscribe=owned.subscribe(value=>{snapshot.current=value;setState(value);});
    return()=>{operation.current++;question.current=null;if(controller.current===owned)controller.current=null;unsubscribe();owned.dispose();};
  },[mode,scopeKey,aspectRatio]);
  useEffect(()=>{const hidden=()=>{if(document.visibilityState==='hidden')cancel();};document.addEventListener('visibilitychange',hidden);return()=>document.removeEventListener('visibilitychange',hidden);},[cancel]);
  useEffect(()=>{const element=video.current;if(element){element.srcObject=state.stream;if(state.stream)void element.play().catch(()=>{});}return()=>{if(element)element.srcObject=null;};},[state.stream]);
  const busy=disabled||saving||pending||state.videoControls?.busy===true||state.phase==='preparing'||state.phase==='stopping';
  const act=async(action:(owned:StudioCaptureController)=>void|Promise<unknown>)=>{
    const owned=controller.current;if(!owned||question.current||savingNow.current||props.current.disabled)return;
    const ticket=++operation.current;setError(null);
    try{await action(owned);}catch(value){if(controller.current===owned&&operation.current===ticket)setError((value as Error).message);}
  };
  const configureVideo=(patch:StudioCaptureVideoPatch)=>{if(snapshot.current.phase!=='ready'||snapshot.current.videoControls?.busy||question.current||savingNow.current||props.current.disabled)return;void act(owned=>owned.configureVideo(patch));};
  const save=()=>act(async owned=>{
    const file=snapshot.current.file,scope=props.current.scopeKey,ticket=operation.current;if(!file||saved.current)return;
    savingNow.current=true;setSaving(true);
    try{await props.current.onRecorded(file);if(controller.current===owned&&props.current.scopeKey===scope&&operation.current===ticket){saved.current=true;props.current.onClose();}}
    finally{if(controller.current===owned){savingNow.current=false;setSaving(false);}}
  });
  const discard=async(restart:boolean)=>{
    const owned=controller.current;if(!owned||question.current||savingNow.current||props.current.disabled)return;
    const target=snapshot.current,scope=props.current.scopeKey,ticket=operation.current;
    if(restart&&!target.file)return;
    const reservation={};question.current=reservation;
    try{
      const needsConfirmation=target.phase==='recording'||target.phase==='stopping'||!!target.file;
      const approved=!needsConfirmation||await confirm({
        title:restart?'Descartar e gravar outro trecho?':'Descartar esta gravação?',
        description:restart?'Este trecho ainda não foi salvo na montagem. Ao descartá-lo, você poderá iniciar outra gravação.':'O trecho ainda não salvo será descartado. As gravações já usadas na montagem continuam preservadas.',
        confirmLabel:restart?'Descartar e gravar outro':'Descartar gravação',cancelLabel:target.phase==='recording'?'Continuar gravando':'Manter gravação',tone:'danger',icon:'discard',
      });
      if(!approved||question.current!==reservation||controller.current!==owned||operation.current!==ticket||props.current.scopeKey!==scope||props.current.disabled||savingNow.current||snapshot.current.file!==target.file)return;
      const restarted=++operation.current;question.current=null;owned.cancel();
      if(restart){setError(null);try{await owned.prepare();}catch(value){if(controller.current===owned&&props.current.scopeKey===scope&&operation.current===restarted)setError((value as Error).message);}}
      else props.current.onClose();
    }finally{if(question.current===reservation)question.current=null;}
  };
  const icon=mode==='audio'?<Mic size={30}/>:mode==='screen'?<Monitor size={30}/>:<Camera size={30}/>;
  return <section className="se-recorder" aria-label={mode==='audio'?'Gravar narração':mode==='screen'?'Gravar tela':'Gravar câmera'} style={{display:'grid',gap:16,color:'white',background:'#09090b',borderRadius:20,padding:20,maxWidth:900,width:'100%'}}>
    <div className="se-recorder-header"><strong>{mode==='audio'?'Narração':mode==='screen'?'Gravar tela':'Câmera'}</strong><div className="se-recorder-header-actions">{mode!=='audio'&&state.phase!=='recording'&&state.phase!=='stopping'&&!state.file?<><StudioRecordingQuality state={state} disabled={busy} onVideo={configureVideo}/><button type="button" className="se-recording-icon" aria-label="Configurações da gravação" aria-expanded={toolsOpen} disabled={busy} onClick={()=>setToolsOpen(value=>!value)}><Settings2 size={20}/></button></>:null}<button type="button" className="se-recording-icon" aria-label="Fechar gravação" disabled={disabled||saving||pending} onClick={()=>void discard(false)}><X size={22}/></button></div></div>
    <div style={{background:'#151518',borderRadius:16,overflow:'hidden',minHeight:mode==='audio'?120:220,display:'grid',placeItems:'center',position:'relative'}}>
      {mode!=='audio'?<video ref={video} muted playsInline autoPlay style={{width:'100%',maxHeight:'60vh',objectFit:'contain',display:state.stream?'block':'none'}}/>:null}
      {!state.stream||mode==='audio'?<div style={{padding:32,color:'#999',textAlign:'center'}}>{icon}<p>{state.phase==='preparing'?'Aguardando sua permissão…':mode==='audio'?'Grave sua voz para a montagem':'Ative a captura para enquadrar antes de gravar'}</p></div>:null}
      {state.phase==='recording'?<span style={{position:'absolute',top:12,left:12,background:'#d81240',padding:'6px 10px',borderRadius:8}}>● {formatClock(state.elapsed)}</span>:null}
      {toolsOpen&&mode!=='audio'&&state.phase!=='recording'&&!state.file?<StudioRecordingTools initialTab={mode==='screen'?'record':'image'} state={state} camera={mode!=='screen'} disabled={busy} guides={recorderGuides} guidesAvailable={false} onGuides={()=>undefined} onVideo={configureVideo} onClose={closeTools}/>:null}
    </div>
    {state.input?<div aria-label={`Microfone em uso: ${state.input.name}`} style={{display:'grid',gap:6}}><small>{state.input.name}</small><div style={{height:6,borderRadius:6,background:'#303036',overflow:'hidden'}}><div style={{width:`${Math.max(0,Math.min(100,((state.levels[0]?.averageDb??-120)+60)/60*100))}%`,height:'100%',background:(state.levels[0]?.peakDb??-120)>-3?'#f34b4b':'#50d19b'}}/></div><small style={{color:'#aaa'}}>{state.levels.length?`${state.levels[0].averageDb.toFixed(1)} dBFS`:'Aguardando amostra do microfone'}</small></div>:null}
    {(error||state.error)?<p role="alert" style={{color:'#fca5a5',margin:0}}>{error||state.error}</p>:null}
    {state.phase==='recorded'?<p style={{color:'#aaa',margin:0}}>Trecho de {formatClock(state.elapsed)}. O original será salvo quando você usar a gravação.</p>:null}
    <div style={{display:'flex',justifyContent:'center',gap:12,alignItems:'center'}}>
      {(state.phase==='idle'||state.phase==='error'&&!state.file)?<button type="button" disabled={busy} onClick={()=>void act(owned=>owned.prepare())} style={primary}>Ativar {mode==='camera'?'câmera':mode==='screen'?'tela e microfone':'microfone'}</button>:null}
      {state.phase==='error'&&state.file?<><button type="button" disabled={busy} onClick={()=>void act(owned=>owned.stop())}>Tentar ler trecho</button><button type="button" disabled={busy} onClick={()=>{const url=URL.createObjectURL(state.file!),link=document.createElement('a');link.href=url;link.download=state.file!.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Baixar original preservado</button></>:null}
      {state.phase==='ready'?<><button type="button" disabled={busy} aria-label="Iniciar gravação" onClick={()=>{setToolsOpen(false);void act(owned=>owned.start());}} style={{...primary,borderRadius:50,padding:18}}><Circle fill="#fff" size={24}/></button>{mode==='camera'?<button type="button" disabled={busy} aria-label="Trocar câmera" onClick={()=>void act(owned=>owned.flip())}><RefreshCw size={22}/></button>:null}</>:null}
      {state.phase==='recording'?<button type="button" aria-label="Encerrar gravação" disabled={disabled||pending} onClick={()=>void act(owned=>owned.stop())} style={primary}><Square fill="#fff" size={20}/> Encerrar</button>:null}
      {(saving||state.phase==='preparing'||state.phase==='stopping')&&!disabled?<span role="status">{saving?'Salvando original…':state.phase==='stopping'?'Preparando o trecho…':'Aguardando permissão…'}</span>:null}
      {state.phase==='recorded'?<><button type="button" disabled={busy} onClick={()=>void discard(true)}>Gravar outro</button><button type="button" disabled={busy} onClick={()=>void save()} style={primary}><Check size={20}/> Usar gravação</button></>:null}
    </div>
    {dialog}
  </section>;
}
const recorderGuides:RecordingGuides={grid:false,mirrored:false,delay:0,script:'',scriptEnabled:false,scriptSpeed:140,scriptMode:'timed'};
const primary={background:'#e71349',border:0,color:'#fff',padding:'12px 18px',borderRadius:12,display:'inline-flex',alignItems:'center',gap:8,fontWeight:600,cursor:'pointer'} as const;
function formatClock(seconds:number){return`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;}
