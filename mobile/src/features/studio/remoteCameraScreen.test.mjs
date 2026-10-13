import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRemoteCameraController} from './remoteCameraController.ts';
const owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',browser='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sessionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc',device='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};};
function load(file,dependencies,globals={}){
  const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const module={exports:{}};new Function('require','module','exports',...Object.keys(globals),code)(name=>{assert.ok(Object.hasOwn(dependencies,name),`Unexpected boundary ${name}`);return dependencies[name];},module,module.exports,...Object.values(globals));return module.exports;
}
// Exercise the real route/controller/pairing persistence with controlled OS/network boundaries.
function harness(options={}){
  const slots=[],calls=[],timers=new Map(),listeners=new Set(),data=new Map();
  let cursor=0,dirty=true,effects=[],tree,focused=options.focused!==false,time=0,timerId=0,account=owner,permission=options.permissions!==false;
  const session={id:sessionId,ownerId:owner,controllerId:browser,deviceId:device,kind:'aula',status:'ready',configuration:{resolution:'4k',fps:30,cameraFacing:'back'}};
  if(options.saved!==false){data.set(`classfy:remote-camera:last:${owner}`,sessionId);data.set(`classfy:remote-camera:browser:${owner}`,browser);}
  const appState={currentState:'active',addEventListener:(_name,callback)=>{listeners.add(callback);return {remove:()=>listeners.delete(callback)};}};
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const react={
    useRef(value){const i=cursor++;return slots[i]||=( {current:value} );},
    useState(initial){const i=cursor++;slots[i]||={value:typeof initial==='function'?initial():initial};return [slots[i].value,next=>{const value=typeof next==='function'?next(slots[i].value):next;if(!Object.is(value,slots[i].value)){slots[i].value=value;dirty=true;}}];},
    useEffect(callback,deps){const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))effects.push({i,callback,deps});},
  };
  const schedule=(callback,delay=0,interval)=>{const id=++timerId;timers.set(id,{callback,at:time+delay,interval});return id;};
  const globals={setTimeout:schedule,clearTimeout:id=>timers.delete(id),setInterval:(callback,delay)=>schedule(callback,delay,delay),clearInterval:id=>timers.delete(id),Date:class extends Date{static now(){return time;}}};
  const pairing=load('./remoteCameraPairing.ts',{'@react-native-async-storage/async-storage':{getItem:async key=>data.get(key)||null,setItem:async(key,value)=>data.set(key,value),removeItem:async key=>data.delete(key)}});
  const nativePort={snapshot:async()=>({width:3840,height:2160,fps:30,recording:false}),configure:async()=>({width:3840,height:2160,fps:30,recording:false}),
    preview:async()=>calls.push({action:'native-preview'}),disconnect:async()=>calls.push({action:'native-disconnect'}),begin(){throw Error('Unexpected REC');},stop:async()=>{}};
  const runtime=(capturedOwner,_device,scope)=>{
    const check=()=>{if(scope.signal?.aborted||!scope.isCurrent())throw Object.assign(Error('cancelled'),{name:'AbortError'});};
    let journal={version:1,owner:capturedOwner,sessionId,deviceId:device,sequence:0,receipts:{},takes:[]};
    return createRemoteCameraController({owner:capturedOwner,deviceId:device,current:()=>!scope.signal?.aborted&&scope.isCurrent(),now:()=>time,
      discover:async controllerId=>{check();calls.push({action:'discover',owner:capturedOwner,controllerId,signal:scope.signal});
        if(options.discoveryGate)await options.discoveryGate.promise;check();return {ownerId:capturedOwner,paired:options.paired!==false,controllerId:options.paired===false?null:browser,
          session:options.waiting?null:session,commands:[],takes:[],serverAt:new Date(time).toISOString()};},
      request:async(action,body)=>{check();calls.push({action,body});return {session,commands:[],takes:[],serverAt:new Date(time).toISOString(),unpaired:action==='unpair'&&options.unpairSucceeded!==false,
        ...(['join','connect'].includes(action)?{connection:{url:'wss://private.invalid',token:'test-only',identity:'device'}}:{})};},
      journal:async()=>structuredClone(journal),mutate:async(_id,change)=>{journal=change(journal);return structuredClone(journal);},
      inspect:async()=>{throw Error('No original');},masterUri:()=>'',saveLocal:async()=>{throw Error('No original');},upload:async()=>{throw Error('No original');},
    });
  };
  const jsx=(type,props)=>({type,props:props||{}});
  const screen=load('../../../app/studio/remote-camera.tsx',{
    react,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
    'react-native':{AppState:appState,Alert:{alert:()=>{}},findNodeHandle:()=>77,Modal:'modal',Platform:{OS:'ios'},Pressable:'pressable',Text:'text',TextInput:'input',View:'view',StyleSheet:{create:value=>value,absoluteFillObject:{}}},
    '@react-navigation/native':{useIsFocused:()=>focused,usePreventRemove:()=>{}},
    'expo-router':{useLocalSearchParams:()=>({}),useRouter:()=>({back:()=>calls.push({action:'back'})}),useNavigation:()=>({dispatch:()=>{}})},
    'expo-camera':{CameraView:'scanner',useCameraPermissions:()=>[{granted:permission},async()=>{calls.push({action:'permission-camera'});return {granted:permission};}],useMicrophonePermissions:()=>[{granted:permission},async()=>({granted:permission})]},
    'expo-modules-core':{requireNativeViewManager:()=> 'native-camera'},'lucide-react-native':{Camera:'icon',Monitor:'icon',Square:'icon',X:'icon'},
    'expo-keep-awake':{activateKeepAwakeAsync:async()=>{},deactivateKeepAwake:async()=>{}},
    '@/components/AppScreen':{AppScreen:'screen'},'@/components/NavigationHeader':{NavigationHeader:'header'},
    '@/features/auth/authContext':{useAuth:()=>({user:{id:account}})},
    '@/features/studio/useStudioOrientation':{useStudioOrientation:()=>({orientationReady:true,prepareForExit:async()=>true})},
    '@/features/studio/StudioUI':{StudioAccess:'access',StudioButton:'studio-button'},
    '@/features/studio/remoteCameraApi':{readRemotePairingCode:value=>value},
    '@/features/studio/remoteCameraRuntime':{createRemoteCameraRuntime:runtime,createRemoteNativePort:()=>({port:nativePort,onRecordingState:()=>{}}),remoteCameraDeviceId:async()=>device,restoreStudioRemoteAudioPolicy:()=>{}},
    '@/features/studio/remoteCameraPairing':pairing,
    '@/features/live/transport':{reserveNativeCaptureForStudioCamera:()=>{calls.push({action:'reserve-camera'});return {current:()=>true,release:()=>{}};}},
    '@/features/studio/StudioCaptureAudio':{useStudioCaptureAudioMonitor:()=>({status:'idle',input:null,channels:[],onAudioMonitor:()=>{}})},
    '@/features/studio/StudioCaptureAudioMonitor':{StudioCaptureAudioMonitor:'audio'},
    '../../modules/classfy-studio-media':{isStudioRemoteCameraAvailable:()=>true,isStudioNativeCameraAudioMonitorAvailable:()=>true},
    '@/theme/colors':{colors:{text:'#fff',accent:'#f06',muted:'#aaa',border:'#333'}},
  },globals).default;
  function render(){cursor=0;effects=[];dirty=false;tree=screen();for(const effect of effects){slots[effect.i]?.cleanup?.();slots[effect.i]={deps:effect.deps,cleanup:effect.callback()};}}
  const pump=async()=>{for(let i=0;i<30;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty)return;}throw Error('Route did not settle');};
  function nodes(type){const found=[];const visit=value=>{if(Array.isArray(value))return value.forEach(visit);if(!value||typeof value!=='object'||value.type==='modal'&&!value.props.visible)return;if(value.type===type)found.push(value);visit(value.props?.children);};visit(tree);return found;}
  const advance=async ms=>{time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){if(timer.interval)timer.at=time+timer.interval;else timers.delete(id);timer.callback();}await pump();};
  render();return {calls,data,pump,advance,nodes,press:async label=>{const node=nodes('studio-button').find(value=>value.props.label===label);assert.ok(node,`Missing ${label}`);node.props.onPress();await pump();},
    app:async value=>{appState.currentState=value;listeners.forEach(listener=>listener(value));await pump();},
    focus:async value=>{focused=value;dirty=true;await pump();},owner:async value=>{account=value;dirty=true;await pump();},
    close:async()=>{const node=nodes('pressable').find(value=>value.props.accessibilityLabel==='Fechar câmera');assert.ok(node);node.props.onPress();await pump();},
    unmount:()=>{slots.forEach(slot=>slot?.cleanup?.());},
  };
}
test('rota com vínculo abre câmera sem QR; fechar explicitamente impede reabertura ao voltar ao foreground',async()=>{
  const h=harness();try{await h.pump();await h.advance(0);assert.equal(h.calls.filter(call=>call.action==='discover').length,1);assert.equal(h.calls.filter(call=>call.action==='connect').length,1);
    assert.equal(h.calls.filter(call=>call.action==='join').length,0);assert.equal(h.nodes('native-camera').length,1);
    await h.close();await h.app('background');await h.app('active');await h.advance(10_000);
    assert.equal(h.calls.filter(call=>call.action==='connect').length,1);assert.equal(h.nodes('native-camera').length,0);
  }finally{h.unmount();}
});
test('espera vínculo sem Studio não abre câmera; cancelar aborta request e não retoma no background',async()=>{
  const gate=deferred(),h=harness({waiting:true,discoveryGate:gate});try{await h.pump();await h.advance(0);const call=h.calls.find(call=>call.action==='discover');assert.ok(call);
    await h.press('Cancelar espera');assert.equal(call.signal.aborted,true);gate.resolve();await h.pump();await h.app('background');await h.app('active');await h.advance(10_000);
    assert.equal(h.calls.filter(call=>call.action==='discover').length,1);assert.equal(h.nodes('native-camera').length,0);assert.equal(h.calls.filter(call=>call.action==='reserve-camera').length,0);
  }finally{h.unmount();}
});
test('sem foco/permissão/vínculo a rota não aciona câmera, permission prompt ou discovery automaticamente',async()=>{
  for(const options of [{focused:false},{permissions:false},{saved:false}]){const h=harness(options);try{await h.pump();await h.advance(10_000);
    assert.equal(h.calls.filter(call=>['discover','connect','join','permission-camera','reserve-camera'].includes(call.action)).length,0);assert.equal(h.nodes('native-camera').length,0);
  }finally{h.unmount();}}
});
test('trocar owner enquanto discovery está pendente ignora resposta sem capturar imagem',async()=>{
  const gate=deferred(),h=harness({discoveryGate:gate});try{await h.pump();await h.advance(0);await h.owner('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');gate.resolve();await h.pump();await h.advance(10_000);
    assert.equal(h.calls.filter(call=>call.action==='connect'||call.action==='reserve-camera').length,0);assert.equal(h.nodes('native-camera').length,0);
  }finally{h.unmount();}
});
test('desvinculação usa confirmação Classfy; sucesso remove só browser, falha mantém referência para retomar',async()=>{
  for(const accepted of [true,false]){const h=harness({waiting:true,unpairSucceeded:accepted});try{await h.pump();await h.advance(0);
    assert.equal(h.nodes('modal').length,0);await h.press('Desvincular computador');assert.equal(h.nodes('modal').length,1);
    assert.equal(h.calls.filter(call=>call.action==='unpair').length,0);await h.press('Desvincular');
    assert.deepEqual(h.calls.find(call=>call.action==='unpair').body,{controllerId:browser});
    assert.equal(h.data.get(`classfy:remote-camera:browser:${owner}`),accepted?undefined:browser);
    assert.equal(h.data.get(`classfy:remote-camera:last:${owner}`),sessionId);assert.equal(h.nodes('modal').length,accepted?0:1);
    assert.equal(h.nodes('native-camera').length,0);
  }finally{h.unmount();}}
});
