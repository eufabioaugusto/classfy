import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const code = ts.transpileModule(readFileSync(new URL('../../../app/watch/[id].tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function nodes(tree, predicate) {
  const result=[]; const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'){if(predicate(value))result.push(value);visit(value.props?.children);}};
  visit(tree);return result;
}
function pathTo(tree,predicate){
  if(Array.isArray(tree)){for(const child of tree){const path=pathTo(child,predicate);if(path)return path;}return null;}
  if(!tree||typeof tree!=='object')return null;
  if(predicate(tree))return[tree];const child=pathTo(tree.props?.children,predicate);return child?[tree,...child]:null;
}
const flatten=style=>Object.assign({},...([style].flat(Infinity).filter(value=>value&&typeof value==='object')));
const number=value=>typeof value?.read==='function'?value.read():value?.value??value;
function harness({course=true,type='video',allowed=true}={}){
  const calls=[],slots=[];let cursor=0,effects=[],dirty=true,tree;
  const lessonA={id:'lesson-a',title:'Primeira aula',video_url:'https://media/a.m3u8',duration_seconds:120,content_id:'lesson-content-a'};
  const lessonB={...lessonA,id:'lesson-b',title:'Segunda aula',video_url:'https://media/b.m3u8',content_id:'lesson-content-b'};
  let content={id:'content',title:'Título do curso',file_url:'https://wrong/course-file.mp4',media_asset_id:null,thumbnail_url:'cover.jpg',content_type:type,isCourse:course,visibility:'free',creator:{display_name:'Creator'},tags:[],duration_seconds:999};
  let access={hasAccess:allowed,reason:null,requiredPlan:'free'},source={url:lessonA.video_url,loading:false,error:null};
  const lessons={currentLesson:lessonA,modules:[{id:'module',title:'Módulo',lessons:[lessonA,lessonB]}],loading:false,error:null,completedLessons:[],progressPercent:0,refresh:async()=>{},selectLesson(lesson){calls.push(['selectLesson',lesson]);lessons.currentLesson=lesson;source={...source,url:lesson.video_url};dirty=true;}};
  const existing={id:'content',lessonId:course?lessonA.id:undefined,title:course?lessonA.title:content.title,fileUrl:source.url,courseId:course?'content':undefined,startPositionMillis:123400,shouldPlay:true};
  const playback={content:existing,position:123.4,playing:true,completed:false,status:'readyToPlay',sourceReady:true,error:null,player:{playbackRate:1,currentTime:123.4},startMiniPlayer:value=>calls.push(['mini',value]),attach:value=>calls.push(['attach',value]),seek:value=>calls.push(['seek',value])};
  const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((value,index)=>Object.is(value,b[index]));
  const hooks={
    useRef:value=>{const i=cursor++;return slots[i]??=( {current:value});},
    useState:initial=>{const i=cursor++;slots[i]??={value:typeof initial==='function'?initial():initial};return[slots[i].value,value=>{const next=typeof value==='function'?value(slots[i].value):value;if(!Object.is(next,slots[i].value)){slots[i].value=next;dirty=true;}}];},
    useEffect:(callback,deps)=>{const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))effects.push({i,callback,deps});},
    useMemo:(factory,deps)=>{const i=cursor++;if(!slots[i]||!equal(slots[i].deps,deps))slots[i]={deps,value:factory()};return slots[i].value;},
  };hooks.useCallback=(callback,deps)=>hooks.useMemo(()=>callback,deps);
  class Value{
    constructor(value){this.value=value;}
    setValue(value){this.value=value;}
    stopAnimation(){calls.push(['stopAnimation']);}
    interpolate({inputRange,outputRange}){return{read:()=>{const x=Math.max(inputRange[0],Math.min(inputRange.at(-1),this.value));let i=0;while(i<inputRange.length-2&&x>inputRange[i+1])i++;return outputRange[i]+(outputRange[i+1]-outputRange[i])*(x-inputRange[i])/(inputRange[i+1]-inputRange[i]);}};}
  }
  const animation=(kind,value,options)=>({start(callback){calls.push([kind]);value.setValue(options.toValue);callback?.({finished:true});}});
  const rn={...Object.fromEntries('ActivityIndicator Image Pressable ScrollView Text View'.split(' ').map(name=>[name,name])),
    StyleSheet:{create:value=>value,absoluteFillObject:{position:'absolute',top:0,bottom:0,left:0,right:0}},
    Animated:{Value,View:'Animated.View',spring:(value,options)=>animation('spring',value,options),timing:(value,options)=>animation('timing',value,options),parallel:()=>({start(){}}),sequence:()=>({start(){}})},
    PanResponder:{create:handlers=>({panHandlers:handlers})},Dimensions:{get:()=>({width:390,height:844})},useWindowDimensions:()=>({width:390,height:844}),
    StatusBar:{setHidden:value=>calls.push(['statusBar',value])},Alert:{alert(){}},Share:{share:async()=>{}},Easing:{},
  };
  const components=Object.fromEntries('ClassfyVideoPlayer WatchCommentsSheet WatchDescriptionSheet WatchRewardBar WatchPlayerPlaceholder WatchCoursePlaylist WatchStudySheet'.split(' ').map(name=>[`@/components/${name}`,{[name]:name}]));
  const deps={...components,react:hooks,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'react-native':rn,
    '@expo/vector-icons':{Ionicons:'Ionicons',MaterialCommunityIcons:'MaterialCommunityIcons'},'expo-linear-gradient':{LinearGradient:'LinearGradient'},
    'expo-router':{router:{canGoBack:()=>true,back:()=>calls.push(['back']),replace:value=>calls.push(['replace',value]),push:value=>calls.push(['push',value]),setParams(){}},useLocalSearchParams:()=>({id:'content'})},
    'expo-screen-orientation':{OrientationLock:{LANDSCAPE:'landscape',PORTRAIT_UP:'portrait'},lockAsync:async value=>calls.push(['orientation',value])},
    'react-native-safe-area-context':{useSafeAreaInsets:()=>({top:50,bottom:34,left:0,right:0})},'react-native-webview':{WebView:'WebView'},
    '@/components/SheetModal':{SheetModal:'SheetModal',SheetCloseButton:'SheetCloseButton',sheetStyles:{}},
    '@/features/auth/authContext':{useAuth:()=>({user:null})},'@/features/watch/usePlaybackSource':{usePlaybackSource:()=>source},
    '@/features/watch/miniPlayerContext':{useMiniPlayer:()=>playback},'@/features/watch/useCourseLessons':{useCourseLessons:()=>lessons},
    '@/features/watch/useWatchContent':{useWatchContent:()=>({content,access,followersCount:0,loading:false,error:null})},
    '@/features/watch/useWatchRelated':{useWatchRelated:()=>({items:[],loading:false})},
    '@/features/watch/useWatchActions':{useWatchActions:()=>({isLiked:false,isSaved:false,isFavorited:false,likesCount:0})},
    '@/features/watch/useWatchProgress':{useWatchProgress:()=>({savedPositionSeconds:null,milestones:[],watchPercent:0})},
    '@/hooks/useBottomSheetScroll':{useBottomSheetScroll:()=>({})},'@/lib/interests':{trackUserInteraction(){}},'@/lib/supabase':{supabase:{}},
    '@/theme/colors':{colors:{background:'#000',text:'#fff'}},'@/theme/radius':{radius:{}},'@/theme/spacing':{spacing:{sm:8,md:16,section:32}},'@/theme/typography':{typography:{}},
  };
  const module={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];},module,module.exports);
  const render=()=>{cursor=0;dirty=false;effects=[];tree=module.exports.default();for(const effect of effects){slots[effect.i]?.cleanup?.();slots[effect.i]={deps:effect.deps,cleanup:effect.callback()};}};
  const pump=async()=>{for(let i=0;i<12;i++){if(dirty)render();await new Promise(resolve=>setImmediate(resolve));if(!dirty)return;}throw Error('Watch did not settle');};
  const component=name=>nodes(tree,node=>node.type===name)[0]?.props;
  const pan=()=>nodes(tree,node=>typeof node.props?.onPanResponderMove==='function')[0]?.props;
  const backdrop=()=>nodes(tree,node=>node.type==='Animated.View'&&node.props.pointerEvents==='none'&&'opacity'in flatten(node.props.style))[0];
  const alpha=()=>number(flatten(backdrop().props.style).opacity);
  const move=dy=>pan().onPanResponderMove(null,{dy,dx:0,vy:0});
  return{pump,calls,component,pan,move,alpha,existing,playback,lessons,lessonB,tree:()=>tree,
    change(values){if('content'in values)content={...content,...values.content};if('access'in values)access={...access,...values.access};if('source'in values)source={...source,...values.source};if('playback'in values)Object.assign(playback,values.playback);if('lessons'in values)Object.assign(lessons,values.lessons);dirty=true;},
    dispose(){for(const slot of slots)slot?.cleanup?.();},
  };
}

test('course playlist opens modules and selecting a lesson updates both card and player identity',async()=>{
  const h=harness();try{await h.pump();const playlist=h.component('WatchCoursePlaylist');assert.equal(playlist.currentLesson.id,'lesson-a');assert.equal(h.component('WatchStudySheet').visible,false);
    playlist.onPress();await h.pump();assert.equal(h.component('WatchStudySheet').visible,true);assert.equal(h.component('WatchStudySheet').initialTab,'modules');
    h.component('WatchStudySheet').onSelectLesson(h.lessonB);await h.pump();assert.equal(h.component('WatchStudySheet').visible,false);assert.equal(h.component('WatchCoursePlaylist').currentLesson,h.lessonB);
    assert.equal(h.component('ClassfyVideoPlayer').session.lessonId,'lesson-b');assert.equal(h.component('ClassfyVideoPlayer').title,'Segunda aula');
  }finally{h.dispose();}
});
for(const props of [{course:false},{course:false,type:'podcast'},{allowed:false}])test(`playlist is absent when the current content is not an accessible course: ${JSON.stringify(props)}`,async()=>{
  const h=harness(props);try{await h.pump();assert.equal(h.component('WatchCoursePlaylist'),undefined);}finally{h.dispose();}
});
test('drag fades only the backing surface/body, then cancel and terminate restore the full Watch',async()=>{
  const h=harness();try{await h.pump();assert.equal(h.alpha(),1);const player=h.component('ClassfyVideoPlayer');h.pan().onPanResponderGrant();h.move(150);assert.equal(h.alpha(),0);
    assert.equal(h.component('ClassfyVideoPlayer'),player);
    const playerPath=pathTo(h.tree(),node=>node.type==='ClassfyVideoPlayer'),playlistPath=pathTo(h.tree(),node=>node.type==='WatchCoursePlaylist');
    assert.ok(playerPath&&playlistPath);
    assert.ok(playerPath.every(node=>number(flatten(node.props?.style).opacity??1)===1),'The video and every ancestor stay opaque while its backdrop fades');
    assert.ok(playlistPath.some(node=>number(flatten(node.props?.style).opacity??1)===0),'The body disappears with the backing surface, independently of the player');
    h.pan().onPanResponderRelease(null,{dy:150,vy:0});assert.equal(h.alpha(),1);assert.equal(h.calls.filter(call=>call[0]==='mini').length,0);
    h.move(150);assert.equal(h.alpha(),0);h.pan().onPanResponderTerminate();assert.equal(h.alpha(),1);h.move(-30);assert.equal(h.alpha(),1);
  }finally{h.dispose();}
});
test('fullscreen clears a partial drag, hides the playlist and restores normal alpha after exit',async()=>{
  const h=harness();try{await h.pump();h.move(150);assert.equal(h.alpha(),0);await h.component('ClassfyVideoPlayer').onFullscreenToggle(true);await h.pump();assert.equal(h.alpha(),1);assert.equal(h.component('WatchCoursePlaylist'),undefined);assert.equal(h.pan(),undefined);
    await h.component('ClassfyVideoPlayer').onFullscreenToggle(false);await h.pump();assert.equal(h.alpha(),1);assert.ok(h.component('WatchCoursePlaylist'));assert.ok(h.pan());
  }finally{h.dispose();}
});
for(const entry of ['pan','button'])test(`minimize via ${entry} reveals the exact provider session without attach, seek or source restart`,async()=>{
  const h=harness();try{await h.pump();if(entry==='pan')h.pan().onPanResponderRelease(null,{dy:400,vy:0});else h.component('ClassfyVideoPlayer').onMinimize();
    assert.equal(h.calls.filter(call=>call[0]==='mini').length,1);assert.equal(h.calls.find(call=>call[0]==='mini')[1],h.existing);
    assert.equal(h.playback.player.currentTime,123.4);assert.equal(h.calls.filter(call=>['attach','seek'].includes(call[0])).length,0);assert.equal(h.calls.filter(call=>call[0]==='back').length,1);
  }finally{h.dispose();}
});
test('a stale provider lesson is never revealed while the new course lesson is becoming active',async()=>{
  const h=harness();try{await h.pump();h.component('WatchStudySheet').onSelectLesson(h.lessonB);await h.pump();h.component('ClassfyVideoPlayer').onMinimize();
    assert.equal(h.calls.filter(call=>call[0]==='mini').length,0);assert.equal(h.calls.filter(call=>call[0]==='back').length,1);assert.equal(h.playback.content,h.existing);
  }finally{h.dispose();}
});

test('a single cover spans source resolution and native buffering, then only sourceReady removes it',async()=>{
  const h=harness();try{
    const nativePlayer=h.playback.player;
    h.change({source:{url:'',loading:true},playback:{content:null,sourceReady:false,status:'idle'}});await h.pump();
    const firstCover=h.component('WatchPlayerPlaceholder');assert.equal(firstCover.visible,true);assert.equal(firstCover.loading,true);assert.equal(firstCover.poster,'cover.jpg');assert.equal(h.component('ClassfyVideoPlayer'),undefined);
    h.change({source:{url:h.existing.fileUrl,loading:false},playback:{content:h.existing,status:'loading'}});await h.pump();
    assert.equal(h.component('ClassfyVideoPlayer').src,h.existing.fileUrl);assert.equal(h.component('ClassfyVideoPlayer').showLoadingIndicator,false);
    assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,true);assert.equal(h.component('WatchPlayerPlaceholder').poster,firstCover.poster);
    assert.equal(nodes(h.tree(),node=>node.type==='WatchPlayerPlaceholder').length,1);
    h.change({playback:{status:'readyToPlay',sourceReady:false,position:0,playing:false}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,true,'A generic ready status does not prove the active source is ready');
    h.change({playback:{sourceReady:true}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,false);assert.equal(h.component('WatchPlayerPlaceholder').loading,false);
    assert.equal(h.playback.player,nativePlayer);assert.equal(h.calls.filter(call=>['attach','seek'].includes(call[0])).length,0);
  }finally{h.dispose();}
});
for(const mismatch of ['content','lesson','url'])test(`readiness or native error belonging to another ${mismatch} cannot dismiss the active cover`,async()=>{
  const h=harness();try{
    const stale={...h.existing,...(mismatch==='content'?{id:'other-content'}:mismatch==='lesson'?{lessonId:'other-lesson'}:{fileUrl:'https://media/old-source.m3u8'})};
    h.change({playback:{content:stale,status:'readyToPlay',sourceReady:true}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,true);
    h.change({playback:{error:'Failure from the previous source'}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').error,null);
    h.change({playback:{content:h.existing,error:null}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,false);
  }finally{h.dispose();}
});
test('course lesson selection keeps the cover until the same lesson and URL are ready in the provider',async()=>{
  const h=harness();try{
    await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,false);
    h.component('WatchCoursePlaylist').onPress();await h.pump();h.component('WatchStudySheet').onSelectLesson(h.lessonB);await h.pump();
    assert.equal(h.component('ClassfyVideoPlayer').session.lessonId,h.lessonB.id);assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,true);
    h.change({playback:{content:{...h.existing,lessonId:h.lessonB.id,fileUrl:h.lessonB.video_url},sourceReady:false,status:'readyToPlay'}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,true);
    h.change({playback:{sourceReady:true}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,false);assert.equal(h.calls.filter(call=>['attach','seek'].includes(call[0])).length,0);
  }finally{h.dispose();}
});
test('a native error from the current source uncovers the existing player so its retry remains reachable',async()=>{
  const h=harness();try{
    h.change({playback:{sourceReady:false,status:'error',error:'Não foi possível reproduzir este vídeo.'}});await h.pump();
    assert.equal(h.component('WatchPlayerPlaceholder').visible,false);assert.equal(h.component('WatchPlayerPlaceholder').error,null);assert.equal(h.component('ClassfyVideoPlayer').showLoadingIndicator,false);
    assert.equal(h.component('ClassfyVideoPlayer').src,h.existing.fileUrl);assert.equal(h.playback.error,'Não foi possível reproduzir este vídeo.');
    h.change({playback:{error:null,status:'loading',sourceReady:false}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,true);
  }finally{h.dispose();}
});
test('source errors keep their cover, and locked content never exposes a player despite prior readiness',async()=>{
  const h=harness();try{
    h.change({source:{url:'',loading:false,error:'Não foi possível carregar o vídeo. Abra o conteúdo novamente.'}});await h.pump();
    assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,false);assert.match(h.component('WatchPlayerPlaceholder').error,/Não foi possível/);assert.equal(h.component('ClassfyVideoPlayer'),undefined);
    h.change({access:{hasAccess:false},source:{url:h.existing.fileUrl,loading:true}});await h.pump();
    assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').locked,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,false);assert.equal(h.component('ClassfyVideoPlayer'),undefined);
  }finally{h.dispose();}
});
test('course catalog loading and failure remain in the same cover without pretending a source is ready',async()=>{
  const h=harness();try{
    h.change({source:{url:'',loading:false},lessons:{loading:true,currentLesson:null}});await h.pump();
    assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,true);assert.equal(h.component('WatchCoursePlaylist').loading,true);assert.equal(h.component('ClassfyVideoPlayer'),undefined);
    h.change({lessons:{loading:false,error:'Internal catalog diagnostic'}});await h.pump();
    assert.equal(h.component('WatchPlayerPlaceholder').visible,true);assert.equal(h.component('WatchPlayerPlaceholder').loading,false);assert.equal(h.component('WatchPlayerPlaceholder').error,'Não foi possível carregar as aulas. Abra o conteúdo novamente.');
  }finally{h.dispose();}
});
for(const type of ['video','podcast'])test(`${type} readiness does not wait for playback or a first-frame callback, including fullscreen`,async()=>{
  const h=harness({course:false,type});try{
    h.change({playback:{position:0,playing:false,status:'readyToPlay',sourceReady:true}});await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,false);
    await h.component('ClassfyVideoPlayer').onFullscreenToggle(true);await h.pump();assert.equal(h.component('WatchPlayerPlaceholder').visible,false);assert.equal(h.component('ClassfyVideoPlayer').showLoadingIndicator,false);
  }finally{h.dispose();}
});
