import {useEffect,useRef,useState} from 'react';
import {AppState,Alert,findNodeHandle,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {useIsFocused,usePreventRemove} from '@react-navigation/native';
import {useLocalSearchParams,useRouter,useNavigation} from 'expo-router';
import {CameraView,useCameraPermissions,useMicrophonePermissions} from 'expo-camera';
import {requireNativeViewManager} from 'expo-modules-core';
import {Camera,Monitor,Square,X} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {activateKeepAwakeAsync,deactivateKeepAwake} from 'expo-keep-awake';
import {AppScreen} from '@/components/AppScreen';
import {NavigationHeader} from '@/components/NavigationHeader';
import {useAuth} from '@/features/auth/authContext';
import {useStudioOrientation} from '@/features/studio/useStudioOrientation';
import {StudioAccess,StudioButton,studioStyles} from '@/features/studio/StudioUI';
import {readRemotePairingCode} from '@/features/studio/remoteCameraApi';
import {createRemoteCameraRuntime,createRemoteNativePort,remoteCameraDeviceId,restoreStudioRemoteAudioPolicy,type RemoteNativeEvent} from '@/features/studio/remoteCameraRuntime';
import type {RemoteCameraSnapshot} from '@/features/studio/remoteCameraController';
import {reserveNativeCaptureForStudioCamera} from '@/features/live/transport';
import {useStudioCaptureAudioMonitor} from '@/features/studio/StudioCaptureAudio';
import {StudioCaptureAudioMonitor} from '@/features/studio/StudioCaptureAudioMonitor';
import {isStudioRemoteCameraAvailable,isStudioNativeCameraAudioMonitorAvailable,type StudioCaptureAudioEvent} from '../../modules/classfy-studio-media';
import {colors} from '@/theme/colors';

const available=Platform.OS==='ios'&&isStudioRemoteCameraAvailable();
const NativeCamera=available?requireNativeViewManager<Record<string,unknown>>('ClassfyStudioMedia','StudioCaptureView'):null;
const initial:RemoteCameraSnapshot={phase:'idle',session:null,state:null,error:null,previewConnected:false,uploading:false,takeCount:0,syncUncertaintyMs:null};

export default function StudioRemoteCameraScreen(){
  const {user}=useAuth(),router=useRouter(),navigation=useNavigation(),focused=useIsFocused(),params=useLocalSearchParams<{code?:string}>();
  const [permission,requestCamera]=useCameraPermissions(),[microphone,requestMicrophone]=useMicrophonePermissions();
  const [code,setCode]=useState(typeof params.code==='string'?params.code:''),[scanning,setScanning]=useState(false),[state,setState]=useState(initial),[failure,setFailure]=useState('');
  const [foreground,setForeground]=useState(AppState.currentState==='active'),[joining,setJoining]=useState(false),[connected,setConnected]=useState(false),[leaving,setLeaving]=useState(false),[lastSession,setLastSession]=useState<string|null>(null);
  const controller=useRef<ReturnType<typeof createRemoteCameraRuntime>|null>(null),port=useRef<ReturnType<typeof createRemoteNativePort>|null>(null),nativeRef=useRef(null),unsubscribe=useRef<(()=>void)|null>(null);
  const lifecycle=useRef({owner:user?.id,focused,foreground,epoch:0,mounted:true}),gate=useRef(false);
  const [allowRemoval,setAllowRemoval]=useState(false),pendingExit=useRef<unknown>(undefined),captureLease=useRef<ReturnType<typeof reserveNativeCaptureForStudioCamera>|null>(null);
  async function dispose(){const current=controller.current,lease=captureLease.current;await current?.dispose();if(lease?.current()){restoreStudioRemoteAudioPolicy();lease.release();}if(captureLease.current===lease)captureLease.current=null;}
  if(lifecycle.current.owner!==user?.id||lifecycle.current.focused!==focused||lifecycle.current.foreground!==foreground)lifecycle.current.epoch++;
  lifecycle.current.owner=user?.id;lifecycle.current.focused=focused;lifecycle.current.foreground=foreground;
  const {orientationReady,orientationError,prepareForExit}=useStudioOrientation(connected?state.session?.kind:undefined,connected);
  const cameraActive=connected&&focused&&foreground&&!leaving&&orientationReady;
  const audioMonitor=useStudioCaptureAudioMonitor({active:cameraActive,available:isStudioNativeCameraAudioMonitorAvailable(),scopeKey:`${user?.id}:${state.session?.id}`,generation:typeof state.state?.generation==='number'?state.state.generation:undefined});
  const audioRef=useRef(audioMonitor);audioRef.current=audioMonitor;
  const isRecording=state.phase==='starting'||state.phase==='recording'||state.phase==='saving';
  const [elapsed,setElapsed]=useState(0);
  useEffect(()=>{if(!state.recordingStartedAtMs){setElapsed(0);return;}const update=()=>setElapsed(Math.max(0,(Date.now()-state.recordingStartedAtMs!)/1000));update();const timer=setInterval(update,250);return()=>clearInterval(timer);},[state.recordingStartedAtMs]);
  useEffect(()=>{if(!focused||!foreground||!user||( !connected&&!state.uploading))return;
    const tag=`studio-remote-camera:${user.id}:${lifecycle.current.epoch}`;let ended=false;
    void activateKeepAwakeAsync(tag).then(()=>{if(ended)void deactivateKeepAwake(tag).catch(()=>undefined);}).catch(()=>undefined);
    return()=>{ended=true;void deactivateKeepAwake(tag).catch(()=>undefined);};
  },[focused,foreground,user?.id,connected,state.uploading]);
  useEffect(()=>{lifecycle.current.mounted=true;const listener=AppState.addEventListener('change',value=>{
    const active=value==='active';if(!active){lifecycle.current.epoch++;lifecycle.current.foreground=false;setScanning(false);setConnected(false);void dispose();setFailure('Conexão pausada. O take é preservado no iPhone; retome quando voltar.');}
    setForeground(active);
  });return()=>{lifecycle.current.mounted=false;lifecycle.current.epoch++;listener.remove();unsubscribe.current?.();void dispose();};},[]);
  useEffect(()=>{void AsyncStorage.getItem(`classfy:remote-camera:last:${user?.id}`).then(id=>{if(lifecycle.current.owner===user?.id)setLastSession(id);});
    setConnected(false);setState(initial);port.current=null;void dispose();
  },[user?.id]);
  useEffect(()=>{if(!focused){lifecycle.current.epoch++;setScanning(false);setConnected(false);void dispose();}},[focused]);
  useEffect(()=>{if(allowRemoval){const action=pendingExit.current;pendingExit.current=undefined;if(action)navigation.dispatch(action as Parameters<typeof navigation.dispatch>[0]);else router.back();}},[allowRemoval]);
  useEffect(()=>{if(!connected||!foreground)return;const timer=setInterval(()=>{void controller.current?.poll();},1500);return()=>clearInterval(timer);},[connected,foreground]);
  async function connect(resume=false,scanCode?:string,recoverOnly=false){
    if(gate.current||!user||!available)return;gate.current=true;setJoining(true);setFailure('');setScanning(false);
    const owner=user.id,epoch=lifecycle.current.epoch;
    const isCurrent=()=>lifecycle.current.mounted&&lifecycle.current.owner===owner&&lifecycle.current.focused&&lifecycle.current.foreground&&lifecycle.current.epoch===epoch;
    try{await dispose();if(!isCurrent())return;const deviceId=await remoteCameraDeviceId(owner);if(!isCurrent())return;
      const next=createRemoteCameraRuntime(owner,deviceId,{isCurrent});controller.current=next;unsubscribe.current?.();unsubscribe.current=next.subscribe(value=>{if(isCurrent())setState(value);});
      if(recoverOnly&&lastSession){await next.recoverLocal(lastSession);if(isCurrent())setFailure(next.getSnapshot().error||'Originais recuperados no Studio deste iPhone. O envio pode ser retomado sem abrir a câmera.');return;}
      if(resume&&lastSession)await next.resume(lastSession);else await next.join(readRemotePairingCode(scanCode||code));if(!isCurrent())return;
      const session=next.getSnapshot().session!;await AsyncStorage.setItem(`classfy:remote-camera:last:${owner}`,session.id);setLastSession(session.id);
      // Pairing/Premium is confirmed before opening the native capture inputs.
      if(!permission?.granted&&!(await requestCamera()).granted)throw new Error('Permita a câmera nos Ajustes para conectar ao computador.');if(!isCurrent())return;
      if(!microphone?.granted&&!(await requestMicrophone()).granted)throw new Error('Permita o microfone para preservar o áudio original do take.');if(!isCurrent())return;
      captureLease.current=reserveNativeCaptureForStudioCamera();port.current=null;setAllowRemoval(false);setConnected(true);
    }catch(cause){if(isCurrent())setFailure(cause instanceof Error?cause.message:'Não foi possível conectar.');}
    finally{gate.current=false;if(lifecycle.current.mounted)setJoining(false);}
  }
  function nativeReady(){const current=controller.current,session=current?.getSnapshot().session;if(!current||!session||port.current)return;
    const epoch=lifecycle.current.epoch,owner=user?.id;if(!owner)return;
    const value=createRemoteNativePort(owner,session,()=>findNodeHandle(nativeRef.current),{isCurrent:()=>lifecycle.current.mounted&&lifecycle.current.owner===owner&&lifecycle.current.epoch===epoch&&lifecycle.current.foreground&&lifecycle.current.focused},()=>({
      status:audioRef.current.status,input:audioRef.current.input?{name:audioRef.current.input.name,type:audioRef.current.input.type}:null,channels:audioRef.current.channels,
    }));
    port.current=value;void current.cameraReady(value.port);
  }
  async function leave(action?:unknown){if(gate.current)return;gate.current=true;setLeaving(true);setScanning(false);try{await controller.current?.disconnect();setConnected(false);
    if(!await prepareForExit())throw new Error('Aguarde a tela retornar ao retrato e tente sair novamente.');pendingExit.current=action;setAllowRemoval(true);
  }catch(cause){setFailure(cause instanceof Error?cause.message:'Não foi possível sair.');}finally{gate.current=false;setLeaving(false);}}
  usePreventRemove(!allowRemoval,({data})=>{
    if(isRecording)Alert.alert('Encerrar e preservar o take?','O original será salvo no iPhone antes de fechar a conexão.',[{text:'Continuar gravando',style:'cancel'},{text:'Encerrar e sair',onPress:()=>void leave(data.action)}]);
    else void leave(data.action);
  });
  const error=failure||state.error||orientationError;
  return <StudioAccess><AppScreen scroll={false} header={connected?undefined:<NavigationHeader title="Conectar ao computador" back/>}>
    {connected?<View style={s.stage}>
      {NativeCamera&&cameraActive?<NativeCamera ref={nativeRef} active style={s.camera} effectRecipeJSON={JSON.stringify({preset:'natural',intensity:0,exposure:0,contrast:0,saturation:0,temperature:0})}
        onReady={nativeReady} onState={()=>{}} onError={(event:{nativeEvent?:{message?:string}})=>setFailure(event.nativeEvent?.message||'A câmera foi interrompida.')}
        onAudioMonitor={(event:{nativeEvent:StudioCaptureAudioEvent})=>audioMonitor.onAudioMonitor(event.nativeEvent)}
        onRecordingState={(event:{nativeEvent:RemoteNativeEvent})=>port.current?.onRecordingState(event.nativeEvent)}/>:<Text style={s.hint}>Preparando o enquadramento…</Text>}
      <View style={s.overlay}><View style={s.pill}><Monitor size={17} color={colors.text}/><Text style={s.label}>{state.phase==='starting'?'Preparando REC…':isRecording?`${Math.floor(elapsed/60)}:${String(Math.floor(elapsed%60)).padStart(2,'0')} · Gravando original`:'Câmera conectada ao Studio'}</Text></View>
        {!isRecording&&<Pressable accessibilityLabel="Fechar conexão" onPress={()=>void leave()} style={s.close}><X size={22} color={colors.text}/></Pressable>}</View>
      <View style={s.bottom}>{error?<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>:null}
        <StudioCaptureAudioMonitor input={audioMonitor.input} channels={audioMonitor.channels} status={audioMonitor.status} message={audioMonitor.message} compact/>
        <Text style={s.hint}>{state.state?.width}×{state.state?.height} · {state.state?.fps} FPS · {state.takeCount} takes preservados{state.uploading?' · Enviando original…':''}</Text>
        {isRecording?<StudioButton label="Encerrar e salvar take" icon={<Square size={17} color="#fff"/>} disabled={state.phase==='saving'} onPress={()=>void controller.current?.stopLocal().catch(cause=>setFailure(cause.message))}/>:<View style={s.actions}>
          <StudioButton label="Retomar envio" disabled={state.uploading} onPress={()=>void controller.current?.retryUploads().catch(cause=>setFailure(cause.message))}/>
          <StudioButton label="Reconectar prévia" onPress={()=>void controller.current?.reconnectPreview().catch(cause=>setFailure(cause.message))}/>
        </View>}
      </View>
    </View>:<View style={s.setup}><View style={s.icon}><Camera size={34} color={colors.accent}/></View><Text style={s.title}>Seu iPhone, a câmera do Studio.</Text>
      <Text style={s.hint}>Abra Gravar no computador e escolha iPhone. Use a mesma conta Premium ativa. A prévia é leve; o original com áudio fica preservado neste aparelho.</Text>
      {!available?<Text style={s.error}>Atualize o Classfy Dev no iPhone para conectar a câmera ao computador.</Text>:<>
        {scanning&&focused&&foreground?<View style={s.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}}
          onBarcodeScanned={({data})=>{if(!gate.current&&lifecycle.current.focused&&lifecycle.current.foreground)void connect(false,data);}}/><StudioButton label="Colar código" onPress={()=>setScanning(false)}/></View>:<>
          <TextInput accessibilityLabel="Código de conexão" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="Código exibido no computador" placeholderTextColor={colors.muted} style={s.input}/>
          <StudioButton label={joining?'Conectando…':'Conectar'} loading={joining} disabled={joining||!code.trim()} onPress={()=>void connect()}/>
          <StudioButton label="Ler QR do computador" disabled={joining} onPress={()=>void (async()=>{const epoch=lifecycle.current.epoch,owner=user?.id;const allowed=permission?.granted||(await requestCamera()).granted;
            if(lifecycle.current.epoch!==epoch||lifecycle.current.owner!==owner||!lifecycle.current.focused||!lifecycle.current.foreground)return;
            if(allowed)setScanning(true);else setFailure('Permita a câmera para ler o QR. Você também pode colar o código.');})()}/>
          {lastSession?<><StudioButton label="Retomar última conexão" disabled={joining} onPress={()=>void connect(true)}/><StudioButton label="Recuperar e enviar originais" disabled={joining} onPress={()=>void connect(false,undefined,true)}/></>:null}
        </>}
      </>}
      {error?<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>:null}
      <Text style={s.hint}>Uma queda de conexão pausa a prévia e o envio. Os arquivos originais continuam no iPhone para retomar.</Text>
    </View>}
  </AppScreen></StudioAccess>;
}
const s=StyleSheet.create({setup:{padding:24,gap:18,flex:1,justifyContent:'center'},icon:{alignSelf:'flex-start',padding:16,borderRadius:24,backgroundColor:'#291420'},title:{color:colors.text,fontSize:28,fontWeight:'600'},hint:{color:colors.muted,fontSize:13,lineHeight:20},input:{minHeight:52,borderRadius:14,borderWidth:1,borderColor:colors.border,color:colors.text,padding:14},error:{color:'#FFA1AE',fontSize:13,lineHeight:18},scanner:{height:300,borderRadius:20,overflow:'hidden',justifyContent:'flex-end'},stage:{flex:1,backgroundColor:'#000',justifyContent:'center'},camera:{...StyleSheet.absoluteFillObject},overlay:{position:'absolute',top:18,left:20,right:20,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},pill:{backgroundColor:'#181818DD',padding:12,borderRadius:18,flexDirection:'row',gap:8,alignItems:'center'},label:{color:colors.text,fontSize:13,fontWeight:'600'},close:{padding:12,backgroundColor:'#181818DD',borderRadius:24},bottom:{position:'absolute',left:20,right:20,bottom:20,gap:10,backgroundColor:'#141414E8',padding:14,borderRadius:18},actions:{flexDirection:'row',gap:10}});
