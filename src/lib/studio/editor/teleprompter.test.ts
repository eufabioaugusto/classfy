import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScriptMatcher, createSpeechFollower, speechFollowerSupport, tokenizeScript, type SpeechFollowerStatus, type SpeechTranscript } from './teleprompter';

describe('roteiro PT-BR e alinhamento incremental',()=>{
  it('preserva offsets UTF16 e pontuação/linhas enquanto normaliza acentos, caixa e apóstrofos',()=>{
    const script='🎬 AÇÃO, café!\nD’água — vídeo 2026.';const tokens=tokenizeScript(script);
    expect(tokens.map(token=>token.normalized)).toEqual(['acao','cafe','dagua','video','2026']);expect(tokens[0]).toMatchObject({start:3,end:7,punctuation:', '});expect(tokens[1].punctuation).toBe('!\n');expect(tokens[2].punctuation).toBe(' — ');
    for(const token of tokens)expect(script.slice(token.start,token.end)).toBe(token.text);expect(tokens.at(-1)?.punctuation).toBe('.');
  });
  it('acompanha interim corrigido e final a partir da mesma origem, sem retroceder ou avançar duas vezes',()=>{
    const matcher=createScriptMatcher('A iluminação suave melhora muito a qualidade do vídeo. Depois cuidamos do áudio.');
    const first=matcher.follow({text:'a iluminacao suave melhora',final:false,segmentId:'1:0'});expect(first.index).toBe(4);expect(first.offset).toBe(matcher.tokens[4].start);
    expect(matcher.follow({text:'a iluminação suave',final:false,segmentId:'1:0'}).index).toBe(4);
    expect(matcher.follow({text:'a iluminação suave melhora muito a qualidade do vídeo',final:true,confidence:.9,segmentId:'1:0'}).index).toBe(9);
    expect(matcher.follow({text:'a iluminação suave melhora muito a qualidade do vídeo',final:true,confidence:.9,segmentId:'1:0'})).toMatchObject({index:9,matched:false});
    expect(matcher.follow({text:'depois cuidamos do audio',final:true,segmentId:'1:1'})).toMatchObject({index:13,offset:matcher.tokens[12].end+1});
  });
  it('tolera pequenas omissões, repetição e uma substituição sem exigir leitura mecânica',()=>{
    const matcher=createScriptMatcher('Iluminação bem suave melhora a qualidade de todas as gravações.');
    const result=matcher.follow({text:'iluminacao iluminacao suave melhora qualidade em todas as gravacoes',final:true,segmentId:'one'});expect(result.index).toBe(10);expect(result.confidence).toBeGreaterThan(.64);
    const fuzzy=createScriptMatcher('Planejamos conteúdos relevantes para ensinar conceitos profundos.');expect(fuzzy.follow({text:'planejamos conteudos relevante para ensinar conceitos profundos',final:true,segmentId:'fuzzy'}).index).toBe(7);
  });
  it('uma palavra comum, frase comum ou frase distante nunca pula o roteiro',()=>{
    const matcher=createScriptMatcher('A primeira iluminação apresenta detalhes importantes da imagem antes de começarmos o roteiro completo para ensinar pessoas.');
    expect(matcher.follow({text:'o',final:true}).index).toBe(0);expect(matcher.follow({text:'para ensinar pessoas',final:true}).index).toBe(0);expect(matcher.follow({text:'a de o que vamos',final:true}).index).toBe(0);expect(matcher.follow({text:'primeira iluminação',final:true,confidence:.1}).index).toBe(0);
  });
  it('repetição do mesmo interim não é confundida com outra ocorrência da frase próxima',()=>{
    const matcher=createScriptMatcher('Iluminação suave melhora detalhes. Iluminação suave melhora detalhes. Depois falamos sobre áudio.');
    const phrase={text:'iluminacao suave melhora detalhes',final:false,segmentId:'same'};expect(matcher.follow(phrase).index).toBe(4);expect(matcher.follow(phrase).index).toBe(4);expect(matcher.follow({...phrase,final:true}).index).toBe(4);
    expect(matcher.follow({text:'depois falamos sobre audio',final:true,segmentId:'next'}).index).toBe(12);
  });
  it('final antigo reenviado depois de outro segmento não avança uma frase repetida; reset libera novo ensaio',()=>{
    const first={text:'iluminação suave melhora detalhes',final:true,confidence:.9,segmentId:'S1'},second={text:'aprendemos áudio com cuidado',final:true,confidence:.9,segmentId:'S2'};
    const matcher=createScriptMatcher('Iluminação suave melhora detalhes. Aprendemos áudio com cuidado. Iluminação suave melhora detalhes.');
    expect(matcher.follow(first).index).toBe(4);expect(matcher.follow(second).index).toBe(8);expect(matcher.follow(first)).toMatchObject({index:8,matched:false});
    expect(matcher.follow({...first,final:false})).toMatchObject({index:8,matched:false});matcher.reset();expect(matcher.follow(first).index).toBe(4);
    expect(matcher.follow({...second,segmentId:'new'}).index).toBe(8);expect(matcher.follow({...first,segmentId:'new-first'}).index).toBe(12);
  });
  it('reset explícito permite ensaiar de novo e roteiros longos usam janela local',()=>{
    const script=Array.from({length:2000},(_,i)=>`trecho${i} conceito${i}`).join(' '),matcher=createScriptMatcher(script,NaN);expect(matcher.follow({text:'trecho1999 conceito1999',final:true}).index).toBe(0);
    matcher.reset(2000);expect(matcher.follow({text:'trecho1000 conceito1000',final:true,segmentId:'segment'}).index).toBe(2002);matcher.reset();expect(matcher.follow({text:'trecho0 conceito0',final:true}).index).toBe(2);expect(createScriptMatcher('').follow({text:'qualquer frase',final:true})).toMatchObject({index:0,offset:0,matched:false});
  });
  it('frase comum completa só avança alinhada ao ponto atual; palavra comum distante continua sem salto',()=>{
    const matcher=createScriptMatcher('Eu estou aqui com você. Agora vamos estudar iluminação.');
    expect(matcher.follow({text:'eu estou aqui com voce',final:false,segmentId:'first'}).index).toBe(5);expect(matcher.follow({text:'eu estou aqui com voce',final:true,segmentId:'first'})).toMatchObject({index:5,matched:false});
    expect(matcher.follow({text:'agora vamos estudar iluminacao',final:true,segmentId:'second'}).index).toBe(9);
    expect(createScriptMatcher('Iluminação mostra detalhes antes de aprender. Eu estou aqui com você.').follow({text:'eu estou aqui com voce',final:true}).index).toBe(0);
  });
  it('três palavras exatas legítimas seguem a voz só na âncora e com confiança final suficiente',()=>{
    const script='Hoje vamos aprender. A iluminação suave destaca detalhes.';
    expect(createScriptMatcher(script).follow({text:'hoje vamos aprender',final:true,confidence:.8214,segmentId:'real'})).toMatchObject({index:3,matched:true,confidence:1});
    expect(createScriptMatcher(script).follow({text:'hoje vamos aprender',final:false,segmentId:'interim'}).index).toBe(3);
    for(const confidence of [.59,0,null])expect(createScriptMatcher(script).follow({text:'hoje vamos aprender',final:true,confidence,segmentId:'weak'}).index).toBe(0);
    expect(createScriptMatcher('Iluminação suave destaca. Hoje vamos aprender.').follow({text:'hoje vamos aprender',final:true,confidence:.99}).index).toBe(0);
    expect(createScriptMatcher(script).follow({text:'vamos aprender',final:true,confidence:.99}).index).toBe(0);
  });
  it('resultado cumulativo acima de64 palavras continua da âncora reconhecida, sem travar ou pular para o fim',()=>{
    const words=Array.from({length:180},(_,i)=>`conceito${i}`),matcher=createScriptMatcher(words.join(' '));const speak=(length:number)=>matcher.follow({text:words.slice(0,length).join(' '),final:false,segmentId:'long'});
    expect(speak(30).index).toBe(30);expect(speak(63).index).toBe(63);expect(speak(100).index).toBe(100);expect(speak(150).index).toBe(150);expect(speak(150)).toMatchObject({index:150,matched:false});expect(speak(180).index).toBe(180);
    const finalOnly=createScriptMatcher(words.join(' '));expect(finalOnly.follow({text:words.join(' '),final:true,segmentId:'full'}).index).toBe(180);
  });
});

class Microphone extends EventTarget {kind='audio';readyState='live';enabled=true;muted=false;id='usb-mic';stop=vi.fn();}
type ResultEvent={resultIndex:number;results:{isFinal:boolean;0:{transcript:string;confidence?:number}}[]};
class Recognition {
  static instances:Recognition[]=[];
  lang='';continuous=false;interimResults=false;maxAlternatives=0;onstart:(()=>void)|null=null;onend:(()=>void)|null=null;onerror:((event:{error:string})=>void)|null=null;onresult:((event:ResultEvent)=>void)|null=null;
  start=vi.fn((_track:MediaStreamTrack)=>{});abort=vi.fn();stop=vi.fn();
  constructor(){Recognition.instances.push(this);}
}
function session(){const track=new Microphone(),statuses:SpeechFollowerStatus[]=[],transcripts:SpeechTranscript[]=[];const follower=createSpeechFollower({track:track as unknown as MediaStreamTrack,onStatus:value=>statuses.push(value),onTranscript:value=>transcripts.push(value)});return{track,statuses,transcripts,follower};}
const result=(text:string,final=false,confidence=.9,index=0):ResultEvent=>({resultIndex:index,results:[{isFinal:final,0:{transcript:text,confidence}}]});
beforeEach(()=>{
  vi.useFakeTimers();Recognition.instances=[];vi.stubGlobal('SpeechRecognition',Recognition);vi.stubGlobal('webkitSpeechRecognition',undefined);
  vi.spyOn(navigator,'userAgent','get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36');vi.spyOn(navigator,'platform','get').mockReturnValue('MacIntel');Object.defineProperty(navigator,'maxTouchPoints',{configurable:true,value:0});
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});});

describe('reconhecimento do mesmo microfone e ciclo de vida',()=>{
  it('capability/construção não criam serviço nem solicitam outra entrada; start recebe a pista física exata',()=>{
    const h=session();expect(speechFollowerSupport()).toEqual({supported:true});expect(Recognition.instances).toHaveLength(0);h.follower.start();const recognition=Recognition.instances[0];expect(recognition.start).toHaveBeenCalledWith(h.track);expect(recognition.start.mock.calls[0]).toHaveLength(1);expect(recognition).toMatchObject({lang:'pt-BR',interimResults:true,continuous:true,maxAlternatives:1});expect(h.statuses.at(-1)?.state).toBe('connecting');recognition.onstart?.();expect(h.statuses.at(-1)?.state).toBe('listening');h.follower.start();expect(Recognition.instances).toHaveLength(1);h.follower.dispose();expect(h.track.stop).not.toHaveBeenCalled();expect(h.track.enabled).toBe(true);
  });
  it('Safari, Android, Chrome antigo e contextos inseguros não tentam start() que abriria mic padrão',()=>{
    for(const ua of ['Mozilla/5.0 Version/26.0 Safari/605.1.15','Mozilla/5.0 (Android) Chrome/150.0.0.0 Mobile Safari/537.36','Mozilla/5.0 Chrome/134.0.0.0 Safari/537.36']){
      vi.spyOn(navigator,'userAgent','get').mockReturnValue(ua);const h=session();h.follower.start();expect(h.statuses.at(-1)?.state).toBe('unsupported');h.follower.dispose();
    }
    expect(Recognition.instances).toHaveLength(0);
  });
  it('emite correções interim/final com identidade estável de segmento e ignora callbacks antigos após dispose',()=>{
    const h=session();h.follower.start();const recognition=Recognition.instances[0];recognition.onstart?.();recognition.onresult?.(result('iluminação suave'));recognition.onresult?.(result('iluminação suave melhora',true));expect(h.transcripts[0].segmentId).toBe(h.transcripts[1].segmentId);expect(h.transcripts.at(-1)).toMatchObject({final:true,confidence:.9});const late=recognition.onresult!;h.follower.dispose();late(result('texto tardio',true));expect(h.transcripts).toHaveLength(2);expect(recognition.onresult).toBeNull();expect(recognition.abort).toHaveBeenCalledTimes(1);expect(h.track.stop).not.toHaveBeenCalled();
  });
  it('resultIndex antigo não reemite o prefixo final nem empurra o matcher a outra ocorrência',()=>{
    const track=new Microphone(),matcher=createScriptMatcher('Iluminação suave melhora detalhes. Aprendemos áudio com cuidado. Iluminação suave melhora detalhes.'),positions:number[]=[],transcripts:SpeechTranscript[]=[];
    const follower=createSpeechFollower({track:track as unknown as MediaStreamTrack,onStatus:vi.fn(),onTranscript:update=>{transcripts.push(update);positions.push(matcher.follow(update).index);}});follower.start();const recognition=Recognition.instances[0];recognition.onstart?.();
    const a={isFinal:true,0:{transcript:'iluminação suave melhora detalhes',confidence:.9}},b={isFinal:true,0:{transcript:'aprendemos áudio com cuidado',confidence:.9}};
    recognition.onresult?.({resultIndex:0,results:[a]});recognition.onresult?.({resultIndex:1,results:[a,b]});recognition.onresult?.({resultIndex:0,results:[a,b]});expect(positions).toEqual([4,8]);expect(transcripts).toHaveLength(2);
    recognition.onresult?.({resultIndex:0,results:[a,b,{...a,isFinal:false}]});expect(positions).toEqual([4,8,12]);expect(transcripts[2].segmentId).not.toBe(transcripts[0].segmentId);follower.dispose();expect(track.stop).not.toHaveBeenCalled();
  });
  it('nova instância de voz usa IDs novos para que retry avance o mesmo roteiro sem colisão com finais antigos',()=>{
    const matcher=createScriptMatcher('Iluminação suave melhora detalhes. Iluminação suave melhora detalhes.'),first=session();first.follower.start();Recognition.instances[0].onstart?.();Recognition.instances[0].onresult?.(result('iluminação suave melhora detalhes',true));expect(matcher.follow(first.transcripts[0]).index).toBe(4);first.follower.dispose();
    const second=session();second.follower.start();Recognition.instances[1].onstart?.();Recognition.instances[1].onresult?.(result('iluminação suave melhora detalhes',true));expect(second.transcripts[0].segmentId).not.toBe(first.transcripts[0].segmentId);expect(matcher.follow(second.transcripts[0]).index).toBe(8);second.follower.dispose();
  });
  it('fim natural reinicia de modo limitado com a mesma pista; respostas da sessão anterior não reaparecem',async()=>{
    const h=session();h.follower.start();let oldResult:((event:ResultEvent)=>void)|null=null;
    for(let i=0;i<4;i++){const owned=Recognition.instances[i];owned.onstart?.();oldResult??=owned.onresult;owned.onend?.();await vi.advanceTimersByTimeAsync(500);}
    expect(Recognition.instances).toHaveLength(4);expect(h.statuses.at(-1)).toMatchObject({state:'error',reason:expect.stringContaining('várias vezes')});oldResult!(result('velho'));expect(h.transcripts).toHaveLength(0);expect(Recognition.instances.every(value=>value.start.mock.calls[0][0]===h.track as unknown as MediaStreamTrack)).toBe(true);await vi.advanceTimersByTimeAsync(20000);expect(Recognition.instances).toHaveLength(4);h.follower.dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('erro de rede/permissão aborta sem fallback automático e permite retry manual limpo',async()=>{
    const h=session();h.follower.start();const old=Recognition.instances[0],lateEnd=old.onend!;old.onerror?.({error:'network'});expect(h.statuses.at(-1)).toMatchObject({state:'error',reason:expect.stringContaining('conexão')});lateEnd();await vi.advanceTimersByTimeAsync(5000);expect(Recognition.instances).toHaveLength(1);h.follower.start();const fresh=Recognition.instances[1];fresh.onstart?.();expect(h.statuses.at(-1)?.state).toBe('listening');fresh.onerror?.({error:'not-allowed'});expect(h.statuses.at(-1)?.reason).toContain('não autorizou');h.follower.dispose();expect(h.track.stop).not.toHaveBeenCalled();
  });
  it('hidden aborta voz, visible não retoma implicitamente e nunca desliga pista da gravação',async()=>{
    const h=session();h.follower.start();Recognition.instances[0].onstart?.();Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));expect(h.statuses.at(-1)?.reason).toContain('sair desta aba');expect(Recognition.instances[0].abort).toHaveBeenCalledTimes(1);expect(h.track.readyState).toBe('live');expect(h.track.stop).not.toHaveBeenCalled();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));await vi.advanceTimersByTimeAsync(2000);expect(Recognition.instances).toHaveLength(1);h.follower.start();expect(Recognition.instances).toHaveLength(2);h.follower.dispose();
  });
  it('pista encerrada/mic silenciado são erros explícitos sem abrir outro microfone',()=>{
    const h=session();h.track.enabled=false;h.follower.start();expect(h.statuses.at(-1)?.reason).toContain('Ative o microfone');expect(Recognition.instances).toHaveLength(0);h.track.enabled=true;h.follower.start();Recognition.instances[0].onstart?.();h.track.readyState='ended';h.track.dispatchEvent(new Event('ended'));expect(h.statuses.at(-1)?.reason).toContain('desconectado');expect(h.track.stop).not.toHaveBeenCalled();h.follower.dispose();
  });
  it('startup sem ACK tem prazo e dispose de conexão/retry limpa timers e listeners',async()=>{
    const h=session(),add=vi.spyOn(h.track,'addEventListener'),remove=vi.spyOn(h.track,'removeEventListener');h.follower.start();await vi.advanceTimersByTimeAsync(15001);expect(h.statuses.at(-1)?.reason).toContain('não iniciou');h.follower.start();Recognition.instances[1].onstart?.();Recognition.instances[1].onend?.();h.follower.dispose();await vi.advanceTimersByTimeAsync(20000);expect(Recognition.instances).toHaveLength(2);expect(vi.getTimerCount()).toBe(0);expect(add).toHaveBeenCalledTimes(2);expect(remove).toHaveBeenCalledTimes(2);expect(h.track.stop).not.toHaveBeenCalled();
  });
  it('start(track) rejeitado nunca tenta assinatura sem parâmetro',()=>{
    class Rejected extends Recognition{start=vi.fn((_track:MediaStreamTrack)=>{throw new DOMException('track','InvalidStateError');});}vi.stubGlobal('SpeechRecognition',Rejected);
    const h=session();h.follower.start();expect(h.statuses.at(-1)?.reason).toContain('não aceitou o microfone');expect(Recognition.instances[0].start).toHaveBeenCalledTimes(1);expect(Recognition.instances[0].start.mock.calls[0]).toEqual([h.track]);h.follower.dispose();
  });
  it('dispose em callback de reconexão não deixa timer novo depois do cleanup',()=>{
    const track=new Microphone();const follower=createSpeechFollower({track:track as unknown as MediaStreamTrack,onTranscript:vi.fn(),onStatus:status=>{if(status.reason?.startsWith('Reconectando'))follower.dispose();}});follower.start();Recognition.instances[0].onstart?.();Recognition.instances[0].onend?.();expect(vi.getTimerCount()).toBe(0);expect(track.stop).not.toHaveBeenCalled();
  });
});
