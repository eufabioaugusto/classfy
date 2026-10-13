import {useEffect,useRef,useState} from 'react';
import {AppState,Alert,findNodeHandle,Modal,Platform,Pressable,StyleSheet,Text,TextInput,View} from 'react-native';
import {useIsFocused,usePreventRemove} from '@react-navigation/native';
import {useLocalSearchParams,useRouter,useNavigation} from 'expo-router';
import {CameraView,useCameraPermissions,useMicrophonePermissions} from 'expo-camera';
import {requireNativeViewManager} from 'expo-modules-core';
import {Camera,X} from 'lucide-react-native';
import {activateKeepAwakeAsync,deactivateKeepAwake} from 'expo-keep-awake';
import {AppScreen} from '@/components/AppScreen';
import {NavigationHeader} from '@/components/NavigationHeader';
import {useAuth} from '@/features/auth/authContext';
import {useStudioOrientation} from '@/features/studio/useStudioOrientation';
import {StudioAccess,StudioButton} from '@/features/studio/StudioUI';
import {readRemotePairingCode} from '@/features/studio/remoteCameraApi';
import {createRemoteCameraRuntime,createRemoteNativePort,remoteCameraDeviceId,restoreStudioRemoteAudioPolicy,type RemoteNativeEvent} from '@/features/studio/remoteCameraRuntime';
import type {RemoteCameraSnapshot} from '@/features/studio/remoteCameraController';
import {readRememberedRemoteBrowser,rememberRemoteBrowser,forgetRemoteBrowser,mayResumeRemoteCameraAutomatically} from '@/features/studio/remoteCameraPairing';
import {reserveNativeCaptureForStudioCamera} from '@/features/live/transport';
import {useStudioCaptureAudioMonitor} from '@/features/studio/StudioCaptureAudio';
import {StudioRemoteCameraMonitor} from '@/features/studio/StudioRemoteCameraMonitor';
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
  const [lastControllerId,setLastControllerId]=useState<string|null>(null),[pairingLoaded,setPairingLoaded]=useState(false),[hasSavedPairing,setHasSavedPairing]=useState(false),[automaticAllowed,setAutomaticAllowed]=useState(true),[confirmUnpair,setConfirmUnpair]=useState(false);
  const [unpairing,setUnpairing]=useState(false);
  const [explicitPairingPending,setExplicitPairingPending]=useState(!!params.code),nextAutomaticAt=useRef(0);
  const controller=useRef<ReturnType<typeof createRemoteCameraRuntime>|null>(null),port=useRef<ReturnType<typeof createRemoteNativePort>|null>(null),nativeRef=useRef(null),unsubscribe=useRef<(()=>void)|null>(null);
  const connectionAbort=useRef<AbortController|null>(null);
  const lifecycle=useRef({owner:user?.id,focused,foreground,epoch:0,mounted:true}),gate=useRef(false);
  const [allowRemoval,setAllowRemoval]=useState(false),pendingExit=useRef<unknown>(undefined),captureLease=useRef<ReturnType<typeof reserveNativeCaptureForStudioCamera>|null>(null);
  async function dispose(){const current=controller.current,lease=captureLease.current,abort=connectionAbort.current;abort?.abort();if(connectionAbort.current===abort)connectionAbort.current=null;
    await current?.dispose();if(lease?.current()){restoreStudioRemoteAudioPolicy();lease.release();}if(captureLease.current===lease)captureLease.current=null;}
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
  useEffect(()=>{const owner=user?.id;setPairingLoaded(false);setHasSavedPairing(false);setLastSession(null);setLastControllerId(null);setAutomaticAllowed(true);setConfirmUnpair(false);nextAutomaticAt.current=0;
    if(owner)void readRememberedRemoteBrowser(owner).then(value=>{if(lifecycle.current.mounted&&lifecycle.current.owner===owner){setLastSession(value.sessionId);setLastControllerId(value.controllerId);setHasSavedPairing(!!(value.controllerId||value.sessionId));setPairingLoaded(true);}}).catch(()=>{if(lifecycle.current.owner===owner)setPairingLoaded(true);});
    setConnected(false);setState(initial);port.current=null;void dispose();
  },[user?.id]);
  useEffect(()=>{if(!focused){lifecycle.current.epoch++;setScanning(false);setConnected(false);void dispose();}},[focused]);
  useEffect(()=>{if(allowRemoval){const action=pendingExit.current;pendingExit.current=undefined;if(action)navigation.dispatch(action as Parameters<typeof navigation.dispatch>[0]);else router.back();}},[allowRemoval]);
  useEffect(()=>{if(!connected||!foreground)return;const timer=setInterval(()=>{void controller.current?.poll();},1500);return()=>clearInterval(timer);},[connected,foreground]);
  useEffect(()=>{if(!pairingLoaded||!mayResumeRemoteCameraAutomatically({focused,foreground,permissionsGranted:!!permission?.granted&&!!microphone?.granted,hasSavedPairing,allowed:automaticAllowed,
    joining,connected,scanning,leaving:leaving||confirmUnpair,hasExplicitCode:explicitPairingPending}))return;
    const timer=setTimeout(()=>{nextAutomaticAt.current=Date.now()+5000;void connect(true,undefined,false,true);},Math.max(0,nextAutomaticAt.current-Date.now()));return()=>clearTimeout(timer);
  },[pairingLoaded,focused,foreground,permission?.granted,microphone?.granted,hasSavedPairing,automaticAllowed,joining,connected,scanning,leaving,confirmUnpair,explicitPairingPending,lastControllerId]);
  async function connect(resume=false,scanCode?:string,recoverOnly=false,automatic=false){
    if(gate.current||!user||!available)return;gate.current=true;setJoining(true);setFailure('');setScanning(false);
    if(recoverOnly)setAutomaticAllowed(false);
    const owner=user.id,epoch=lifecycle.current.epoch;
    const isCurrent=()=>lifecycle.current.mounted&&lifecycle.current.owner===owner&&lifecycle.current.focused&&lifecycle.current.foreground&&lifecycle.current.epoch===epoch;
    try{await dispose();if(!isCurrent())return;const deviceId=await remoteCameraDeviceId(owner);if(!isCurrent())return;
      const abort=new AbortController();connectionAbort.current=abort;
      const next=createRemoteCameraRuntime(owner,deviceId,{isCurrent,signal:abort.signal});controller.current=next;unsubscribe.current?.();unsubscribe.current=next.subscribe(value=>{if(isCurrent()){setState(value);if(value.phase==='closed'||value.phase==='unpaired'){setConnected(false);port.current=null;}}});
      if(recoverOnly&&lastSession){await next.recoverLocal(lastSession);if(isCurrent())setFailure(next.getSnapshot().error||'Originais recuperados no Studio deste iPhone. O envio pode ser retomado sem abrir a câmera.');return;}
      if(resume){const ready=await next.resumePairing(lastControllerId||undefined);if(!isCurrent())return;
        const linked=next.getSnapshot().linkedControllerId;
        if(linked){await rememberRemoteBrowser(owner,linked);if(!isCurrent())return;setLastControllerId(linked);setHasSavedPairing(true);}
        if(!ready){if(next.getSnapshot().phase==='unpaired'){await forgetRemoteBrowser(owner);if(isCurrent()){setLastControllerId(null);setHasSavedPairing(false);setAutomaticAllowed(false);}}return;}
      }else await next.join(readRemotePairingCode(scanCode||code));if(!isCurrent())return;
      const session=next.getSnapshot().session!;await rememberRemoteBrowser(owner,session.controllerId,session.id);if(!isCurrent())return;setLastSession(session.id);setLastControllerId(session.controllerId);setHasSavedPairing(true);setExplicitPairingPending(false);
      // Pairing/Premium is confirmed before opening the native capture inputs.
      if(automatic&&(!permission?.granted||!microphone?.granted))return;
      if(!permission?.granted&&!(await requestCamera()).granted)throw new Error('Permita a câmera nos Ajustes para conectar ao computador.');if(!isCurrent())return;
      if(!microphone?.granted&&!(await requestMicrophone()).granted)throw new Error('Permita o microfone para preservar o áudio original do take.');if(!isCurrent())return;
      captureLease.current=reserveNativeCaptureForStudioCamera();port.current=null;setAllowRemoval(false);setAutomaticAllowed(true);setConnected(true);
    }catch(cause){if(isCurrent())setFailure(cause instanceof Error?cause.message:'Não foi possível conectar.');}
    finally{gate.current=false;if(lifecycle.current.mounted)setJoining(false);}
  }
  function cancelWaiting(){setAutomaticAllowed(false);lifecycle.current.epoch++;setJoining(false);setFailure('');setScanning(false);setState(initial);void dispose();}
  async function unlinkComputer(){if(gate.current||!user||!lastControllerId)return;gate.current=true;setAutomaticAllowed(false);setUnpairing(true);setFailure('');
    const owner=user.id,epoch=lifecycle.current.epoch,isCurrent=()=>lifecycle.current.mounted&&lifecycle.current.owner===owner&&lifecycle.current.focused&&lifecycle.current.foreground&&lifecycle.current.epoch===epoch;
    try{const deviceId=await remoteCameraDeviceId(owner);if(!isCurrent())return;
      const request=createRemoteCameraRuntime(owner,deviceId,{isCurrent});await request.unpair(lastControllerId);if(!isCurrent())return;
      await forgetRemoteBrowser(owner);if(!isCurrent())return;await dispose();setConnected(false);port.current=null;setLastControllerId(null);setHasSavedPairing(false);setState({...initial,phase:'unpaired'});setConfirmUnpair(false);
    }catch(cause){if(isCurrent())setFailure(cause instanceof Error?cause.message:'Não foi possível desvincular o computador.');}
    finally{gate.current=false;if(lifecycle.current.mounted)setUnpairing(false);}
  }
  function nativeReady(){const current=controller.current,session=current?.getSnapshot().session;if(!current||!session||port.current)return;
    const epoch=lifecycle.current.epoch,owner=user?.id;if(!owner)return;
    const value=createRemoteNativePort(owner,session,()=>findNodeHandle(nativeRef.current),{isCurrent:()=>lifecycle.current.mounted&&lifecycle.current.owner===owner&&lifecycle.current.epoch===epoch&&lifecycle.current.foreground&&lifecycle.current.focused},()=>({
      status:audioRef.current.status,input:audioRef.current.input?{id:audioRef.current.input.id,name:audioRef.current.input.name,type:audioRef.current.input.type}:null,channels:audioRef.current.channels,
    }));
    port.current=value;void current.cameraReady(value.port);
  }
  async function leave(action?:unknown){if(gate.current){if(joining&&!isRecording)cancelWaiting();else return;}gate.current=true;setAutomaticAllowed(false);setLeaving(true);setScanning(false);try{await controller.current?.disconnect();setConnected(false);
    if(!await prepareForExit())throw new Error('Aguarde a tela retornar ao retrato e tente sair novamente.');pendingExit.current=action;setAllowRemoval(true);
  }catch(cause){setFailure(cause instanceof Error?cause.message:'Não foi possível sair.');}finally{gate.current=false;setLeaving(false);}}
  usePreventRemove(!allowRemoval,({data})=>{
    if(isRecording)Alert.alert('Encerrar e preservar o take?','O original será salvo no iPhone antes de fechar a conexão.',[{text:'Continuar gravando',style:'cancel'},{text:'Encerrar e sair',onPress:()=>void leave(data.action)}]);
    else void leave(data.action);
  });
  const error=failure||state.error||orientationError;
  const waiting=state.phase==='waiting'||state.phase==='joining'&&!!lastControllerId&&automaticAllowed&&!explicitPairingPending;
  return <StudioAccess>{connected?<StudioRemoteCameraMonitor state={state} active={cameraActive}
    captureScope={`${user?.id}:${state.session?.id}:${state.state?.generation}`} elapsed={elapsed} error={error} canUnpair={!!lastControllerId}
    audio={{input:audioMonitor.input,channels:audioMonitor.channels,status:audioMonitor.status,message:audioMonitor.message}}
    onClose={()=>void leave()} onStop={()=>void controller.current?.stopLocal().catch(cause=>setFailure(cause.message))}
    onUpload={()=>{setFailure('');void controller.current?.retryUploads().catch(cause=>setFailure(cause.message));}}
    onReconnect={()=>{setFailure('');void controller.current?.reconnectPreview().catch(cause=>setFailure(cause.message));}}
    onUnpair={()=>setConfirmUnpair(true)} onFocus={async point=>{
      const current=controller.current;if(!current)throw new Error('Aguarde a câmera preparar o foco.');return current.focusLocal(point);
    }} onFocusError={setFailure} onAudioSelect={async inputId=>{
      const current=controller.current;if(!current)throw new Error('Aguarde a câmera preparar o microfone.');
      const selected=await current.selectAudioInput(inputId);
      if(!selected.audioInput)throw new Error('O iPhone não confirmou a entrada de áudio.');return selected.audioInput;
    }}>
      {NativeCamera&&cameraActive?<NativeCamera ref={nativeRef} active style={s.camera}
        onReady={nativeReady} onState={()=>{}} onInterruption={(event:{nativeEvent?:{message?:string}})=>{if(event.nativeEvent?.message)setFailure(event.nativeEvent.message);}} onError={(event:{nativeEvent?:{message?:string}})=>setFailure(event.nativeEvent?.message||'A câmera foi interrompida.')}
        onAudioMonitor={(event:{nativeEvent:StudioCaptureAudioEvent})=>audioMonitor.onAudioMonitor(event.nativeEvent)}
        onRecordingState={(event:{nativeEvent:RemoteNativeEvent})=>port.current?.onRecordingState(event.nativeEvent)}/>:<Text style={s.hint}>Preparando o enquadramento…</Text>}
    </StudioRemoteCameraMonitor>:<AppScreen scroll={false} header={<NavigationHeader title="Conectar ao computador" back/>}><View style={s.setup}><View style={s.icon}><Camera size={34} color={colors.accent}/></View><Text style={s.title}>{waiting?'Aguardando seu Studio.':'Seu iPhone, a câmera do Studio.'}</Text>
      <Text style={s.hint}>{waiting?'Este computador continua vinculado. Abra Gravar no Studio dele e escolha iPhone; a câmera se conecta sem outro QR.':'Abra Gravar no computador e escolha iPhone. Use a mesma conta Premium ativa. O original com áudio fica preservado neste aparelho.'}</Text>
      {!available?<Text style={s.error}>Atualize o Classfy Dev no iPhone para conectar a câmera ao computador.</Text>:<>
        {waiting&&!scanning?<StudioButton label="Cancelar espera" secondary onPress={cancelWaiting}/>:scanning&&focused&&foreground?<View style={s.scanner}><CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{barcodeTypes:['qr']}}
          onBarcodeScanned={({data})=>{if(!gate.current&&lifecycle.current.focused&&lifecycle.current.foreground)void connect(false,data);}}/><StudioButton label="Colar código" onPress={()=>setScanning(false)}/></View>:<>
          <TextInput accessibilityLabel="Código de conexão" value={code} onChangeText={value=>{setAutomaticAllowed(false);setCode(value);}} autoCapitalize="none" autoCorrect={false} placeholder="Código exibido no computador" placeholderTextColor={colors.muted} style={s.input}/>
          <StudioButton label={joining?'Conectando…':'Conectar'} loading={joining} disabled={joining||!code.trim()} onPress={()=>void connect()}/>
          <StudioButton label="Ler QR do computador" disabled={joining} onPress={()=>void (async()=>{const epoch=lifecycle.current.epoch,owner=user?.id;const allowed=permission?.granted||(await requestCamera()).granted;
            if(lifecycle.current.epoch!==epoch||lifecycle.current.owner!==owner||!lifecycle.current.focused||!lifecycle.current.foreground)return;
            if(allowed){setAutomaticAllowed(false);setScanning(true);}else setFailure('Permita a câmera para ler o QR. Você também pode colar o código.');})()}/>
          {hasSavedPairing?<StudioButton label="Retomar conexão" disabled={joining} onPress={()=>{setAutomaticAllowed(true);void connect(true);}}/>:null}
          {lastSession?<StudioButton label="Recuperar e enviar originais" disabled={joining} onPress={()=>void connect(false,undefined,true)}/>:null}
        </>}
        {lastControllerId?<StudioButton label="Desvincular computador" secondary disabled={joining} onPress={()=>setConfirmUnpair(true)}/>:null}
      </>}
      {error?<Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>:null}
      <Text style={s.hint}>{state.phase==='unpaired'?'Leia o QR para vincular este iPhone ao computador. Seus originais continuam preservados.':'O vínculo fica salvo na sua conta. Fechar a câmera pausa a sessão; desvincular exige um novo QR.'}</Text>
    </View></AppScreen>}
    <Modal transparent visible={confirmUnpair} animationType="fade" presentationStyle="overFullScreen" supportedOrientations={['portrait','landscape-left','landscape-right']} onRequestClose={()=>{if(!unpairing)setConfirmUnpair(false);}}>
      <View style={s.dialogBackdrop}><View accessibilityViewIsModal style={s.dialog}>
        <View style={s.dialogHeader}><Text style={s.dialogTitle}>Desvincular computador?</Text><Pressable accessibilityLabel="Fechar confirmação" disabled={unpairing} onPress={()=>setConfirmUnpair(false)} style={s.close}><X size={20} color={colors.text}/></Pressable></View>
        <Text style={s.hint}>Para usar este computador novamente, será necessário ler outro QR. Seus projetos e originais permanecem salvos.</Text>
        {failure?<Text accessibilityLiveRegion="polite" style={s.error}>{failure}</Text>:null}
        <View style={s.actions}><StudioButton label="Manter vínculo" secondary disabled={unpairing} style={{flex:1}} onPress={()=>setConfirmUnpair(false)}/><StudioButton label="Desvincular" loading={unpairing} style={{flex:1}} onPress={()=>void unlinkComputer()}/></View>
      </View></View>
    </Modal>
  </StudioAccess>;
}
const s=StyleSheet.create({setup:{padding:24,gap:18,flex:1,justifyContent:'center'},icon:{alignSelf:'flex-start',padding:16,borderRadius:24,backgroundColor:'#291420'},title:{color:colors.text,fontSize:28,fontWeight:'600'},hint:{color:colors.muted,fontSize:13,lineHeight:20},input:{minHeight:52,borderRadius:14,borderWidth:1,borderColor:colors.border,color:colors.text,padding:14},error:{color:'#FFA1AE',fontSize:13,lineHeight:18},scanner:{height:300,borderRadius:20,overflow:'hidden',justifyContent:'flex-end'},camera:{...StyleSheet.absoluteFillObject},close:{width:44,height:44,alignItems:'center',justifyContent:'center',backgroundColor:'#181818DD',borderRadius:22},actions:{flexDirection:'row',gap:10},dialogBackdrop:{flex:1,backgroundColor:'#000B',justifyContent:'center',alignItems:'center',padding:24},dialog:{width:'100%',maxWidth:480,backgroundColor:'#141416',borderColor:colors.border,borderWidth:1,borderRadius:24,padding:24,gap:20},dialogHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:12},dialogTitle:{fontSize:22,fontWeight:'600',color:colors.text,flex:1}});
