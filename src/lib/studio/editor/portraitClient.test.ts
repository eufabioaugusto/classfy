import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStudioPortraitDetector } from './portraitClient';
class FakeWorker {
  static all: FakeWorker[]=[]; onmessage:any; onerror:any; onmessageerror:any; terminate=vi.fn(); postMessage=vi.fn();
  constructor(){FakeWorker.all.push(this);} reply(value:unknown){this.onmessage({data:value});}
}
const bitmap=()=>({close:vi.fn()} as unknown as ImageBitmap);
beforeEach(()=>{FakeWorker.all=[];vi.stubGlobal('Worker',FakeWorker);}); afterEach(()=>vi.unstubAllGlobals());
describe('worker local do retrato e lifecycle',()=>{
  it('sócriaworker quando prepare/detect são solicitados; warm e análises reutilizam modelo',async()=>{
    const client=createStudioPortraitDetector(); expect(FakeWorker.all).toHaveLength(0); const preparing=client.prepare(); const worker=FakeWorker.all[0]; expect(worker.postMessage).toHaveBeenCalledWith({type:'prepare',id:1},[]); worker.reply({id:1}); await preparing;
    const image=bitmap(), detected=client.detect(image); expect(FakeWorker.all).toHaveLength(1); expect(worker.postMessage).toHaveBeenLastCalledWith({type:'detect',id:2,bitmap:image},[image]); worker.reply({id:2,face:[{x:.3,y:.4}]}); expect(await detected).toEqual([{x:.3,y:.4}]); client.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('abort ignoraresultado tardio e não aplica máscara de outroquadro',async()=>{
    const client=createStudioPortraitDetector(), controller=new AbortController(), pending=client.detect(bitmap(),controller.signal), rejection=expect(pending).rejects.toMatchObject({name:'AbortError'}), worker=FakeWorker.all[0]; controller.abort(); worker.reply({id:1,face:[{x:.1,y:.1}]}); await rejection;
    const next=client.detect(bitmap()); worker.reply({id:2,face:[]}); expect(await next).toEqual([]); client.dispose();
  });
  it('falha real rejeita e dispose interrompe aguardas; não confirma retrato omitido',async()=>{
    const client=createStudioPortraitDetector(), pending=client.prepare(); FakeWorker.all[0].reply({id:1,error:'Modelo indisponível'}); await expect(pending).rejects.toThrow('Modelo indisponível');
    const late=client.detect(bitmap()), rejected=expect(late).rejects.toMatchObject({name:'AbortError'}); client.dispose(); await rejected; const own=bitmap(); await expect(client.detect(own)).rejects.toMatchObject({name:'AbortError'}); expect(own.close).toHaveBeenCalledOnce();
  });
  it('falha de mensagem fecha bitmap ainda não transferido e limpa requisição',async()=>{
    const client=createStudioPortraitDetector(), prepare=client.prepare(), worker=FakeWorker.all[0]; worker.reply({id:1}); await prepare; worker.postMessage.mockImplementation(()=>{throw new Error('Transferência negada');}); const image=bitmap(); await expect(client.detect(image)).rejects.toThrow('Transferência negada'); expect(image.close).toHaveBeenCalledOnce(); client.dispose();
  });
});
