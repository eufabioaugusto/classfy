import { decodeThumbnail, handleThumbnail, jpegDimensions, THUMBNAIL_BUCKET } from './thumbnails.ts';
import { CameraError, validateRequest } from './protocol.ts';

const assert = (value: unknown, message = 'assertion failed') => { if (!value) throw new Error(message); };
async function rejects(work: () => unknown, code: string) { try { await work(); } catch (error) { assert(error instanceof CameraError && error.code === code, String(error)); return; } throw new Error('expected rejection'); }
// A bounded JPEG header plus scan payload exercises the transport parser. The
// actual camera supplies a JPEG encoded from its real source frame.
const jpeg = (width = 160, height = 90) => new Uint8Array([0xff,0xd8,0xff,0xc0,0,11,8,height>>8,height&255,width>>8,width&255,1,1,0x11,0,0xff,0xda,0,8,1,1,0,0,63,0,1,0xff,0xd9]);
const wire = (bytes = jpeg(), width = 160, height = 90) => ({ version: 1, mime: 'image/jpeg', width, height, base64: btoa(String.fromCharCode(...bytes)) });
const id = '10000000-0000-4000-8000-000000000001';
const params = (thumbnail = wire()) => ({ sessionId: id, takeId: id, role: 'device', clientId: id, thumbnail });

Deno.test('JPEG side channel rejects forged types, oversized dimensions/base64 and mismatched headers', async () => {
  const decoded = await decodeThumbnail(wire()); assert(decoded.descriptor.bytes === jpeg().length); assert(/^[0-9a-f]{64}$/.test(decoded.descriptor.hash));
  assert(jpegDimensions(jpeg(320,320)).width === 320);
  for (const value of [{ ...wire(), mime: 'image/svg+xml' }, { ...wire(), width: 1 }, { ...wire(), base64: 'data:image/jpeg;base64,AA==' },
    { ...wire(), base64: 'AAAA'.repeat(6000) }, { ...wire(), base64: 'AB==' }, wire(jpeg(321,90),321,90), wire(new Uint8Array(28))])
    await rejects(() => decodeThumbnail(value), 'studio_camera_invalid_thumbnail');
  for (const bytes of [jpeg().slice(0,-1), new Uint8Array([...jpeg().slice(0,15),0,0,0,0,0xff,0xd9]), new Uint8Array([...jpeg().slice(0,2),0xff,0xe1,0xff,0xff,0xff,0xd9])])
    await rejects(() => jpegDimensions(bytes), 'studio_camera_invalid_thumbnail');
});

Deno.test('thumbnail boundary validates actor and strips client bucket/path/owner fields', () => {
  const request = validateRequest({ action: 'thumbnail_put', ...params(), ownerId: id, bucket: 'public', path: '../other', thumbnail: { ...wire(), hash: 'forged', url: 'https://public' } });
  assert(request.params.ownerId === undefined && request.params.bucket === undefined && request.params.path === undefined);
  assert((request.params.thumbnail as Record<string,unknown>).hash === undefined && (request.params.thumbnail as Record<string,unknown>).url === undefined);
  for (const action of ['thumbnail_put','thumbnail_get']) {
    let denied = false; try { validateRequest({ action, ...params(), role: action === 'thumbnail_put' ? 'controller' : 'device' }); } catch { denied = true; } assert(denied);
  }
});

function harness() {
  const calls: { action: string; params: Record<string,unknown> }[] = [], uploads: unknown[][] = [];
  let stored: Blob | null = null, committed: unknown = null, authorizationError: unknown = null, failCommit = false, collision: Blob | null = null;
  const client = {
    rpc(_name: string, values: Record<string,unknown>) {
      const p = values.p_params as Record<string,unknown>, action = String(values.p_action); calls.push({ action, params:p });
      if (authorizationError) return Promise.resolve({ data:null,error:authorizationError });
      if (failCommit && p.confirmed) return Promise.resolve({ data:null,error:new Error('commit unavailable') });
      if (p.confirmed) committed = p.thumbnail;
      return Promise.resolve({ data:{ thumbnail: p.thumbnail ?? committed, _objectPath:`${id}/${id}/${id}/v1.jpg` },error:null });
    },
    storage: { from(bucket: string) { assert(bucket === THUMBNAIL_BUCKET); return {
      upload(path: string, bytes: Uint8Array, options: unknown) { uploads.push([path,bytes,options]); if(stored || collision) return Promise.resolve({error:new Error('exists')}); stored = new Blob([new Uint8Array(bytes).buffer],{type:'image/jpeg'}); return Promise.resolve({error:null}); },
      download() { return Promise.resolve({data:collision??stored,error:null}); },
      createSignedUrl(_path: string, seconds: number) { assert(seconds===300); return Promise.resolve({data:{signedUrl:'https://private.example/signed'},error:null}); },
    }; } },
  };
  return { client,calls,uploads,setAuthorizationError(value: unknown){authorizationError=value;},setFailCommit(value:boolean){failCommit=value;},setCollision(value:Blob){collision=value;} };
}

Deno.test('JPEG uploads alone, commits after object, retries immutable bytes, then returns private read URL', async () => {
  const h=harness(), put=await handleThumbnail(h.client,id,'thumbnail_put',params());
  assert(!('_objectPath' in put) && !('session' in put) && !!put.thumbnail); assert(h.calls.length===2 && h.calls[0].params.confirmed===false && h.calls[1].params.confirmed===true);
  assert(h.uploads.length===1 && h.uploads[0][1] instanceof Uint8Array && (h.uploads[0][1] as Uint8Array).length<16384);
  assert(!(h.calls[0].params.thumbnail as Record<string,unknown>).base64);
  await handleThumbnail(h.client,id,'thumbnail_put',params());
  const get=await handleThumbnail(h.client,id,'thumbnail_get',{sessionId:id,takeId:id,role:'controller',clientId:id});
  assert((get.thumbnail as Record<string,unknown>).url==='https://private.example/signed'); assert(typeof get.serverAt==='string');
  assert(h.calls.every(call=>call.action==='thumbnail_put'||call.action==='thumbnail_get'));
});

Deno.test('authorization/storage/commit failures do not create original actions or erase a retry', async () => {
  const denied=harness(); denied.setAuthorizationError(new CameraError('studio_camera_not_found',404));
  await rejects(()=>handleThumbnail(denied.client,id,'thumbnail_put',params()),'studio_camera_not_found'); assert(denied.uploads.length===0);
  const collision=harness(); collision.setCollision(new Blob(['other'])); await rejects(()=>handleThumbnail(collision.client,id,'thumbnail_put',params()),'studio_camera_thumbnail_conflict'); assert(collision.calls.length===1);
  const retry=harness(); retry.setFailCommit(true); let failed=false; try{await handleThumbnail(retry.client,id,'thumbnail_put',params());}catch{failed=true;} assert(failed);
  retry.setFailCommit(false); await handleThumbnail(retry.client,id,'thumbnail_put',params()); assert(retry.calls.at(-1)?.params.confirmed===true);
});
