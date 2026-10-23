import {ActivityIndicator,Modal,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import type {RemoteCameraLocalOriginal} from './remoteCameraRuntime';
import {remoteCameraModalOrientations} from './remoteCameraMonitorLayout';

export function StudioRemoteLocalTakes({visible,takes,sharing,error,onClose,onShare}:{visible:boolean;takes:RemoteCameraLocalOriginal[];sharing:string|null;error:string;onClose():void;onShare(take:RemoteCameraLocalOriginal):void}){
  const current=takes.filter(take=>take.inProject),recovered=takes.filter(take=>!take.inProject);
  const cards=(entries:RemoteCameraLocalOriginal[],historical=false)=>entries.map((take,index)=>{const duration=Math.max(0,Math.round(take.metadata.duration)),key=`${take.sessionId}:${take.id}`,label=historical?`Original recuperado ${entries.length-index}`:`Take ${entries.length-index}`;return <View key={key} style={s.card}>
    <Text style={s.text}>{label} · {Math.floor(duration/60)}:{String(duration%60).padStart(2,'0')}</Text>
    {!!take.projectTitle&&<Text style={s.detail}>{take.projectTitle}</Text>}
    <Text style={s.detail}>{take.metadata.width}×{take.metadata.height} · {Math.round(take.metadata.fps)} FPS · {(take.metadata.bytes/1024/1024).toFixed(0)} MB</Text>
    <Text style={take.available?s.saved:s.error}>{take.available?'Original salvo neste iPhone':'Arquivo indisponível neste iPhone'}</Text>
    {take.phase==='uploaded'&&<Text style={s.detail}>Também enviado ao computador</Text>}
    {!!take.error&&<Text style={s.detail}>{take.error}</Text>}
    <Pressable accessibilityRole="button" accessibilityLabel={`Compartilhar ${label.toLowerCase()}`} disabled={!take.available||!!sharing} onPress={()=>onShare(take)} style={[s.share,(!take.available||!!sharing)&&s.disabled]}>
      {sharing===key?<ActivityIndicator color="#fff"/>:<Text style={s.text}>Compartilhar original · AirDrop e Arquivos</Text>}
    </Pressable>
  </View>;});
  return <Modal visible={visible} transparent animationType="slide" presentationStyle="overFullScreen" supportedOrientations={remoteCameraModalOrientations} onRequestClose={onClose}>
    <View style={s.backdrop}><View style={s.sheet}><View style={s.header}><View style={{flex:1}}><Text style={s.title}>Takes neste iPhone</Text><Text style={s.detail}>Seus originais ficam aqui. O envio ao computador é opcional.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Fechar takes locais" onPress={onClose} style={s.close}><Text style={s.text}>Fechar</Text></Pressable></View>
      <ScrollView style={{flexShrink:1}} contentContainerStyle={s.content}>
        {!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Text style={s.section}>Takes dos seus projetos · {current.length}</Text>
        {!current.length&&<Text style={s.detail}>Nenhum take remoto nos seus projetos atuais.</Text>}
        {cards(current)}
        {!!recovered.length&&<><Text style={s.section}>Originais recuperados · {recovered.length}</Text><Text style={s.detail}>Arquivos de conexões anteriores ou retirados dos projetos. São cópias preservadas e não contam como takes dos seus projetos.</Text>{cards(recovered,true)}</>}
      </ScrollView></View></View>
  </Modal>;
}
const s=StyleSheet.create({backdrop:{flex:1,backgroundColor:'#0009',justifyContent:'flex-end',padding:16},sheet:{alignSelf:'center',width:'100%',maxWidth:680,maxHeight:'88%',backgroundColor:'#151519',borderRadius:24,padding:20,borderWidth:1,borderColor:'#303038'},header:{flexDirection:'row',alignItems:'center',gap:12,paddingBottom:18},title:{color:'#fff',fontSize:22,fontWeight:'700',marginBottom:6},section:{color:'#fff',fontSize:17,fontWeight:'700',marginTop:10},detail:{color:'#B5B5BF',fontSize:13,lineHeight:19},text:{color:'#fff',fontSize:15,fontWeight:'600'},close:{padding:12},content:{gap:12,paddingBottom:16},card:{padding:16,gap:7,borderRadius:16,backgroundColor:'#202026',borderWidth:1,borderColor:'#33333D'},saved:{color:'#91DBAC',fontSize:13},error:{color:'#FF9AAF',fontSize:13,lineHeight:19},share:{padding:14,backgroundColor:'#D91D4A',borderRadius:12,alignItems:'center',marginTop:5},disabled:{opacity:0.4}});
