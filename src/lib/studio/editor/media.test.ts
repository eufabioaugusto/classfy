import { beforeEach, expect, it, vi } from 'vitest';
import { inspectStudioMedia } from './media';
const mocks=vi.hoisted(()=>({dispose:vi.fn(),duration:vi.fn(),canDecode:vi.fn(),metrics:vi.fn(),color:vi.fn()}));
vi.mock('mediabunny',()=>({ALL_FORMATS:[],BlobSource:class{},Input:class{
  computeDuration=mocks.duration;dispose=mocks.dispose;getPrimaryAudioTrack=async()=>({canDecode:mocks.canDecode});
  getPrimaryVideoTrack=async()=>({canDecode:mocks.canDecode,getDisplayWidth:async()=>1920,getDisplayHeight:async()=>1080,computeFrameRateMetrics:mocks.metrics,getColorSpace:mocks.color});
},CanvasSink:class{getCanvas=async()=>null;}}));
beforeEach(()=>{vi.clearAllMocks();mocks.duration.mockResolvedValue(9);mocks.canDecode.mockResolvedValue(true);mocks.metrics.mockResolvedValue({underlyingFrameRate:30000/1001,bestGuessFrameRate:30});mocks.color.mockResolvedValue({primaries:'bt709',transfer:'bt709',matrix:'bt709'});});
it('lê duração final real e cadência fracional sem depender da extensão/metadata WebM',async()=>{
  const result=await inspectStudioMedia(new Blob(['encoded'],{type:'video/webm'}));expect(result.duration).toBe(9);expect(result.frameRate).toBe(30000/1001);expect(result.hasAudio).toBe(true);expect(mocks.duration).toHaveBeenCalledOnce();expect(mocks.metrics).toHaveBeenCalledWith({targetPacketCount:100});expect(mocks.dispose).toHaveBeenCalledOnce();
});
it('codec indisponível rejeita em vez de devolver preview falsa; input sempre fecha',async()=>{mocks.canDecode.mockResolvedValue(false);await expect(inspectStudioMedia(new Blob(['encoded']))).rejects.toThrow('decodificar');expect(mocks.dispose).toHaveBeenCalledOnce();});
it('abort durante bitmap fecha imagem mesmo antes da miniatura',async()=>{
  const controller=new AbortController(),close=vi.fn();vi.stubGlobal('createImageBitmap',async()=>{controller.abort();return{width:100,height:100,close};});await expect(inspectStudioMedia(new Blob(['image'],{type:'image/png'}),{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(close).toHaveBeenCalledOnce();vi.unstubAllGlobals();
});
it('HDR runtime gera aviso SDR e mantém metadata original, sem inventar HDR export',async()=>{mocks.color.mockResolvedValue({primaries:'bt2020',transfer:'pq',matrix:'bt2020-ncl'});const value=await inspectStudioMedia(new Blob(['encoded']));expect(value.colorSpace).toBe('bt2020/pq/bt2020-ncl');expect(value.warnings).toContain('O original HDR será composto em SDR no navegador.');});
