import { beforeEach,afterEach,describe,it,expect,vi } from 'vitest';
const sdk=vi.hoisted(()=>({face:vi.fn(),segment:vi.fn(),files:vi.fn(),simd:vi.fn(async()=>true)}));
vi.mock('@mediapipe/tasks-vision',()=>({FaceLandmarker:{createFromOptions:sdk.face},ImageSegmenter:{createFromOptions:sdk.segment},FilesetResolver:{forVisionTasks:sdk.files,isSimdSupported:sdk.simd}}));
let scope:{location:{origin:string};postMessage:ReturnType<typeof vi.fn>;onmessage:((event:MessageEvent)=>void)|null};
const deferred=()=>{let resolve!:(value:unknown)=>void,reject!:(error:unknown)=>void;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return{promise,resolve,reject};};
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();scope={location:{origin:'https://local.classfy.test'},postMessage:vi.fn(),onmessage:null};vi.stubGlobal('self',scope);vi.stubGlobal('OffscreenCanvas',class{});vi.stubGlobal('fetch',vi.fn(async(url:string)=>{const bytes=url.includes('face-landmarker')?3758596:16371837;return{ok:true,clone:()=>({arrayBuffer:async()=>new ArrayBuffer(bytes)})};}));vi.stubGlobal('caches',undefined);sdk.files.mockResolvedValue({wasmLoaderPath:'https://local.classfy.test/studio/portrait/mediapipe-1.1.0/vision_wasm_module_internal.js',wasmBinaryPath:'https://local.classfy.test/studio/portrait/mediapipe-1.1.0/vision_wasm_module_internal.wasm'});});
afterEach(()=>{vi.unstubAllGlobals();});
describe('inicialização serial das tasks MediaPipe',()=>{
 it('serializa rosto e multiclass, reaproveita fileset e separa os URLs ESM após a factory ser consumida',async()=>{
  const first=deferred(),second=deferred();sdk.face.mockReturnValueOnce(first.promise);sdk.segment.mockReturnValueOnce(second.promise);await import('./signature.worker');scope.onmessage!({data:{type:'prepare',id:1}}as MessageEvent);
  await vi.waitFor(()=>expect(sdk.face).toHaveBeenCalledOnce());expect(sdk.segment).not.toHaveBeenCalled();first.resolve({});await vi.waitFor(()=>expect(sdk.segment).toHaveBeenCalledTimes(1));second.resolve({});await vi.waitFor(()=>expect(scope.postMessage).toHaveBeenCalledWith({id:1}));
  expect(sdk.files).toHaveBeenCalledOnce();const paths=[sdk.face.mock.calls[0][0],...sdk.segment.mock.calls.map(call=>call[0])];expect(new Set(paths.map(files=>files.wasmLoaderPath)).size).toBe(2);expect(new Set(paths.map(files=>files.wasmBinaryPath)).size).toBe(1);
  scope.onmessage!({data:{type:'prepare',id:2}}as MessageEvent);await vi.waitFor(()=>expect(scope.postMessage).toHaveBeenCalledWith({id:2}));expect(sdk.face).toHaveBeenCalledOnce();expect(sdk.segment).toHaveBeenCalledTimes(1);
 });
 it('recupera criação interrompida sem travar a fila nem reutilizar factory ESM já consumida',async()=>{
  sdk.face.mockRejectedValueOnce(new Error('ModuleFactory not set.')).mockResolvedValueOnce({});sdk.segment.mockResolvedValue({});await import('./signature.worker');scope.onmessage!({data:{type:'prepare',id:1}}as MessageEvent);await vi.waitFor(()=>expect(scope.postMessage).toHaveBeenCalledWith({id:1,error:'ModuleFactory not set.'}));
  scope.onmessage!({data:{type:'prepare',id:2}}as MessageEvent);await vi.waitFor(()=>expect(scope.postMessage).toHaveBeenCalledWith({id:2}));expect(sdk.face).toHaveBeenCalledTimes(2);const [failed,retry]=sdk.face.mock.calls.map(call=>call[0]);expect(failed.wasmLoaderPath).not.toBe(retry.wasmLoaderPath);expect(failed.wasmBinaryPath).toBe(retry.wasmBinaryPath);expect(sdk.files).toHaveBeenCalledOnce();
 });
});
