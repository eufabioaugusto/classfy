import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
import { createStudioSignatureDetector } from './signatureClient';
class WorkerStub {
 static instances:WorkerStub[]=[];onmessage:((event:MessageEvent)=>void)|null=null;onerror:(()=>void)|null=null;onmessageerror:(()=>void)|null=null;
 postMessage=vi.fn();terminate=vi.fn();constructor(){WorkerStub.instances.push(this);}
 answer(data:object){this.onmessage?.({data}as MessageEvent);}
}
beforeEach(()=>{WorkerStub.instances=[];vi.stubGlobal('Worker',WorkerStub);});
afterEach(()=>{vi.unstubAllGlobals();});
describe('protocolo da assinatura em worker',()=>{
 it('só cria worker ao preparar e reutiliza request IDs sem misturar respostas',async()=>{const detector=createStudioSignatureDetector();expect(WorkerStub.instances).toHaveLength(0);const first=detector.prepare(),worker=WorkerStub.instances[0];expect(worker.postMessage).toHaveBeenLastCalledWith({type:'prepare',id:1},[]);worker.answer({id:1});await first;const bitmap={close:vi.fn()}as unknown as ImageBitmap,work=detector.analyze(bitmap);expect(worker.postMessage).toHaveBeenLastCalledWith({type:'analyze',id:2,bitmap},[bitmap]);worker.answer({id:1,error:'Resposta antiga'});worker.answer({id:2,width:2,height:2,personAlpha:new Float32Array(4)});expect((await work).width).toBe(2);expect(bitmap.close).not.toHaveBeenCalled();detector.dispose();expect(worker.terminate).toHaveBeenCalledOnce();});
 it('fecha bitmap não transferido quando request já nasce abortado',async()=>{const detector=createStudioSignatureDetector(),controller=new AbortController(),bitmap={close:vi.fn()}as unknown as ImageBitmap;controller.abort();await expect(detector.analyze(bitmap,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(bitmap.close).toHaveBeenCalledOnce();expect(WorkerStub.instances).toHaveLength(0);detector.dispose();});
 it('não fecha bitmap transferido no cancelamento e ignora resposta tardia',async()=>{const detector=createStudioSignatureDetector(),controller=new AbortController(),bitmap={close:vi.fn()}as unknown as ImageBitmap,work=detector.analyze(bitmap,controller.signal),rejected=expect(work).rejects.toMatchObject({name:'AbortError'});controller.abort();await rejected;WorkerStub.instances[0].answer({id:1,width:1,height:1,personAlpha:new Float32Array([1])});expect(bitmap.close).not.toHaveBeenCalled();detector.dispose();});
 it('falha de modelo rejeita sem fabricar máscara; crash worker termina todas requests',async()=>{const detector=createStudioSignatureDetector(),work=detector.prepare(),rejected=expect(work).rejects.toThrow('modelo');WorkerStub.instances[0].answer({id:1,error:'modelo incompleto'});await rejected;const again=detector.prepare(),other=detector.prepare(),a=expect(again).rejects.toThrow('interrompido'),b=expect(other).rejects.toThrow('interrompido');WorkerStub.instances[0].onerror?.();await Promise.all([a,b]);expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce();detector.dispose();});
});
