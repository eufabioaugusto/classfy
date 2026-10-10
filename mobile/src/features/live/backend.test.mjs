import test from 'node:test';
import assert from 'node:assert/strict';
import { liveBackendHarness, liveFixture, messageFixture, defer, flush, plain } from './liveTestHarness.mjs';
const input = { title: ' Aula ao vivo ', description: ' Conteúdo ', coverUri: 'file:///qa/cover.jpg' };
const invoked = h => h.events.filter(value => value.type === 'invoke');
const failure = (status, error) => ({ data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status, clone: () => ({ json: async () => ({ error }) }) } } });

test('creation rejects pending creator before file processing/storage and permits admin without creator approval', async () => {
  const blocked = liveBackendHarness({ approved: false });
  await assert.rejects(blocked.backend.createStudioLive('owner', input), error => error.code === 'approved_creator_required');
  assert.equal(blocked.events.some(value => ['fileInfo','upload','invoke'].includes(value.type)), false);
  const admin = liveBackendHarness({ approved: false, role: 'admin' });
  assert.equal((await admin.backend.createStudioLive('owner',input)).creator_id, 'owner');
  assert.equal(invoked(admin)[0].body.action, 'create');
});
test('cover is JPEG 1920×1080, bounded bytes and canonical owner path; metadata matches Web endpoint', async () => {
  const h = liveBackendHarness(); const live = await h.backend.createStudioLive('owner',input);
  assert.deepEqual(plain(h.events.find(value => value.type === 'resize').size), { width: 1920, height: 1080 });
  assert.equal(h.events.find(value => value.type === 'saveJPEG').config.format, 'jpeg');
  const upload = h.events.find(value => value.type === 'upload');
  assert.match(upload.path,/^thumbnails\/owner\/lives\/[a-f0-9-]+\.jpg$/);
  assert.ok(upload.bytes instanceof Uint8Array); assert.equal(upload.bytes.byteLength,4);
  assert.equal(upload.config.contentType,'image/jpeg'); assert.equal(upload.config.upsert,false);
  assert.deepEqual(plain(invoked(h)[0].body), { action: 'create',title:'Aula ao vivo',description:'Conteúdo',thumbnailUrl:live.thumbnail_url });
  assert.ok(h.events.some(value=>value.type==='fileDelete' && value.uri==='file:///qa/generated-cover.jpg'));
  assert.equal(h.events.some(value=>value.type==='fileDelete' && value.uri===input.coverUri),false);
});
test('lost create response recovers the durable owner/cover record instead of deleting cover or repeating create', async () => {
  const h=liveBackendHarness({ invoke(body,state) { state.live=liveFixture({thumbnail_url:body.thumbnailUrl}); return {data:null,error:{message:'network disconnected'}}; } });
  const live=await h.backend.createStudioLive('owner',input);
  assert.equal(live.id,'live'); assert.equal(invoked(h).length,1);
  assert.equal(h.events.some(value=>value.type==='remove'),false);
});
test('ambiguous transport/server errors preserve uploaded cover; explicit rejection permits orphan cleanup', async () => {
  for (const response of [{data:null,error:{message:'network disconnected'}},failure(502,'Provider unavailable'),failure(408,'Timed out')]) {
    const h=liveBackendHarness({live:null,invoke:()=>response});
    await assert.rejects(h.backend.createStudioLive('owner',input),error=>error.code==='creation_unknown');
    assert.equal(h.events.some(value=>value.type==='remove'),false);
  }
  const definite=liveBackendHarness({live:null,invoke:()=>failure(409,'Another live is already open')});
  await assert.rejects(definite.backend.createStudioLive('owner',input),/Another live is already open/);
  assert.equal(definite.events.filter(value=>value.type==='remove').length,1);
});
test('cancel after cover upload prevents create and removes only the owner-scoped orphan', async () => {
  let current=true;
  const h=liveBackendHarness({live:null,onUpload:()=>{current=false;}});
  await assert.rejects(h.backend.createStudioLive('owner',input,{isCurrent:()=>current}),error=>h.model.isLiveCancellation(error));
  assert.equal(invoked(h).length,0); assert.equal(h.events.filter(value=>value.type==='remove').length,1);
  assert.equal(h.clients[0].global.headers.Authorization,'Bearer fixture-owner');
});
test('cancel/account change after durable create rejects UI result and preserves associated cover under captured account', async () => {
  const h=liveBackendHarness({invoke(body,state) { state.live=liveFixture({thumbnail_url:body.thumbnailUrl}); state.switchOwner('other'); return {data:{liveId:'live'},error:null}; }});
  await assert.rejects(h.backend.createStudioLive('owner',input),error=>h.model.isLiveCancellation(error));
  assert.equal(h.live.creator_id,'owner'); assert.equal(h.events.some(value=>value.type==='remove'),false);
  assert.ok(h.clients.every(value=>value.global.headers.Authorization==='Bearer fixture-owner'));
});
test('parallel create is rejected before duplicate cover/provider allocation', async () => {
  const barrier=defer(); const h=liveBackendHarness({onVerify:()=>barrier.promise});
  const first=h.backend.createStudioLive('owner',input);
  await assert.rejects(h.backend.createStudioLive('owner',input),error=>error.code==='operation_busy');
  barrier.resolve(); await first; assert.equal(invoked(h).length,1);
});
test('end queues behind sync and revalidates scope; a failed command does not poison the per-live FIFO', async () => {
  const barrier=defer(); const h=liveBackendHarness({invoke(body) { if(body.action==='sync') return barrier.promise; }});
  const sync=h.backend.syncLive('owner','live'); await flush();
  const end=h.backend.endLive('owner','live'); await flush();
  assert.deepEqual(invoked(h).map(value=>value.body.action),['sync']);
  barrier.resolve({data:{status:'waiting'},error:null}); await Promise.all([sync,end]);
  assert.deepEqual(invoked(h).map(value=>value.body.action),['sync','end']);
  const failing=liveBackendHarness({invoke(body) { if(body.action==='set-chat') return failure(409,'Chat cannot change now'); }});
  const bad=failing.backend.setLiveChat('owner','live',false); const good=failing.backend.endLive('owner','live');
  await assert.rejects(bad,/Chat cannot change now/); await good;
  assert.deepEqual(invoked(failing).map(value=>value.body.action),['set-chat','end']);
});
test('queued command cancelled while waiting never starts a remote mutation', async () => {
  let current=true; const barrier=defer();
  const h=liveBackendHarness({invoke(body) { if(body.action==='sync') return barrier.promise; }});
  const sync=h.backend.syncLive('owner','live'); await flush();
  const end=h.backend.endLive('owner','live',{isCurrent:()=>current}); const rejected=assert.rejects(end,error=>h.model.isLiveCancellation(error));
  current=false; barrier.resolve({data:{status:'waiting'},error:null}); await sync; await rejected;
  assert.deepEqual(invoked(h).map(value=>value.body.action),['sync']);
});
test('owner management validates creator identity; getLive can read an authorized viewer row without remote getUser polling', async () => {
  const viewer=liveBackendHarness({live:{creator_id:'another',status:'live'}});
  assert.equal((await viewer.backend.getLive('owner','live')).creator_id,'another');
  assert.equal(viewer.events.some(value=>value.type==='verify'),false);
  await assert.rejects(viewer.backend.endLive('owner','live'),error=>error.code==='owner_required');
  await assert.rejects(viewer.backend.connectHost('owner','live'),error=>error.code==='owner_required');
  assert.equal(invoked(viewer).length,0);
});
test('remote error preserves actionable body/status while redacting credentials/URLs', async () => {
  const h=liveBackendHarness({invoke:()=>failure(409,'Cannot end yet https://private.test/key Bearer fixture-secret')});
  await assert.rejects(h.backend.endLive('owner','live'),error=>error.status===409 && error.message.includes('Cannot end yet') && !error.message.includes('private.test') && !error.message.includes('fixture-secret'));
});
test('chat sends only text using captured user, rejects closed chat and disallows deleting another author as viewer', async () => {
  const h=liveBackendHarness(); const sent=await h.backend.sendLiveMessage('owner','live',' Olá ');
  assert.equal(sent.content,'Olá');
  assert.deepEqual(plain(h.events.find(value=>value.type==='query' && value.query.operation==='insert').query.body),{live_id:'live',user_id:'owner',content:'Olá',type:'text',is_pinned:false});
  const closed=liveBackendHarness({live:{chat_enabled:false}});
  await assert.rejects(closed.backend.sendLiveMessage('owner','live','Olá'),error=>error.code==='chat_closed');
  assert.equal(closed.events.some(value=>value.type==='query' && value.query.operation==='insert'),false);
  const viewer=liveBackendHarness({live:{creator_id:'another'},messages:[messageFixture({user_id:'another'})]});
  await assert.rejects(viewer.backend.deleteLiveMessage('owner','live','message'),error=>error.code==='forbidden');
  assert.equal(viewer.events.some(value=>value.type==='query' && value.query.operation==='delete'),false);
});
test('creator deletes with live/id scope and latest 200 messages reopen in display order', async () => {
  const rows=Array.from({length:205},(_,i)=>messageFixture({id:`m${i}`,created_at:`2026-10-10T10:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}Z`,user_id:'student'}));
  const h=liveBackendHarness({messages:rows}); const messages=await h.backend.listLiveMessages('owner','live');
  assert.equal(messages.length,200); assert.equal(messages[0].id,'m5'); assert.equal(messages.at(-1).id,'m204');
  await h.backend.deleteLiveMessage('owner','live','m204');
  const deletion=h.events.find(value=>value.type==='query' && value.query.operation==='delete');
  assert.deepEqual(plain(deletion.query.filters),{id:'m204',live_id:'live'});
});
test('chat profile hydration deduplicates and bounds one participant batch under authenticated live access', async () => {
  const h=liveBackendHarness(); const profiles=await h.backend.getLiveChatProfiles('owner','live',['student','student','creator']);
  assert.equal(profiles.student.display_name,'Nome student');
  const query=h.events.find(value=>value.type==='query' && value.query.table==='profiles').query;
  assert.deepEqual(plain(query.filters.id),['student','creator']);
});
test('host/replay/notice commands map exact deployed contract and revocation only blocks creation', async () => {
  const h=liveBackendHarness({approved:false,live:{status:'ended',recording_ready_at:'ready'}});
  const replay=await h.backend.publishStudioLiveReplay('owner','live');
  assert.equal(replay.submittedForReview,true); assert.equal(replay.contentId,'replay-content');
  assert.equal((await h.backend.notifyLiveFollowers('owner','live')).notifiedCount,3);
  await h.backend.discardStudioLive('owner','live');
  assert.deepEqual(invoked(h).map(value=>value.body.action),['publish','notify-followers','discard']);
});

test('viewer cannot receive paid/Pro playback/RTC token; owner can preview the same ready replay', async () => {
  for(const visibility of ['paid','premium','pro']) {
    const h=liveBackendHarness({live:{creator_id:'creator',status:'live',visibility}});
    await assert.rejects(h.backend.getLivePlayback('owner','live'),error=>error.code==='live_access_unsupported');
    await assert.rejects(h.backend.getViewerConnection('owner','live'),error=>error.code==='live_access_unsupported');
    assert.equal(invoked(h).length,0);
  }
  const owner=liveBackendHarness({live:{status:'ended',visibility:'paid',recording_ready_at:'ready'}});
  assert.equal((await owner.backend.getLivePlayback('owner','live')).type,'hls');
});
test('two local presence leases share one entry and only the final release leaves the audience', async () => {
  const h=liveBackendHarness({live:{creator_id:'creator',status:'live'}});
  const one=h.backend.acquireLiveViewerPresence('owner','live'),two=h.backend.acquireLiveViewerPresence('owner','live');
  assert.deepEqual(await Promise.all([one.ready,two.ready]),[true,true]);
  const writes=()=>h.events.filter(value=>value.type==='query' && value.query.table==='live_viewers');
  assert.equal(writes().length,1); assert.equal(writes()[0].query.upsertConfig.onConflict,'live_id,user_id');
  await one.release(); assert.equal(writes().length,1);
  await two.release(); await two.release(); assert.equal(writes().length,2);
  assert.deepEqual(plain(writes()[1].query.filters),{live_id:'live',user_id:'owner',is_active:true});
});
test('join response arriving after last lease cancellation performs captured-account compensation even after account switch', async () => {
  let current=true; const joined=defer();
  const h=liveBackendHarness({live:{creator_id:'creator',status:'live'},query(query){if(query.table==='live_viewers' && query.operation==='upsert')return joined.promise;}});
  const lease=h.backend.acquireLiveViewerPresence('owner','live',{isCurrent:()=>current});
  const rejected=assert.rejects(lease.ready,error=>h.model.isLiveCancellation(error)); await flush();
  current=false; const release=lease.release(); h.switchOwner('other'); joined.resolve({data:{},error:null});
  await rejected; await release;
  const writes=h.events.filter(value=>value.type==='query' && value.query.table==='live_viewers');
  assert.deepEqual(writes.map(value=>value.query.operation),['upsert','update']);
  assert.ok(h.clients.every(value=>value.global.headers.Authorization==='Bearer fixture-owner'));
  assert.equal(writes[1].query.filters.user_id,'owner');
});
test('presence re-acquisition during final leave serializes leave before new join, and expired original JWT cannot authorize cleanup', async () => {
  const leaving=defer(); let leaves=0;
  const h=liveBackendHarness({live:{creator_id:'creator',status:'live'},query(query){if(query.table==='live_viewers' && query.operation==='update' && ++leaves===1)return leaving.promise;}});
  const one=h.backend.acquireLiveViewerPresence('owner','live'); await one.ready;
  const release=one.release(); await flush();
  const two=h.backend.acquireLiveViewerPresence('owner','live'); await flush();
  const writes=()=>h.events.filter(value=>value.type==='query' && value.query.table==='live_viewers');
  assert.deepEqual(writes().map(value=>value.query.operation),['upsert','update']);
  leaving.resolve({data:{},error:null}); await release; await two.ready;
  assert.deepEqual(writes().map(value=>value.query.operation),['upsert','update','upsert']); await two.release();
  const expiredOptions={live:{creator_id:'creator',status:'live'}};
  const expired=liveBackendHarness(expiredOptions);
  const invalid=expired.backend.acquireLiveViewerPresence('owner','live'); await invalid.ready; expiredOptions.expiredToken=true; await invalid.release();
  assert.equal(expired.events.some(value=>value.type==='query' && value.query.operation==='update'),false);
});

test('host end between presence read and late upsert is reconciled without leaving an ended live active', async () => {
  const h=liveBackendHarness({live:{creator_id:'creator',status:'live'},query(query,state){if(query.table==='live_viewers' && query.operation==='upsert')state.live={...state.live,status:'ended'};}});
  const lease=h.backend.acquireLiveViewerPresence('owner','live'); assert.equal(await lease.ready,false); await lease.release();
  assert.deepEqual(h.events.filter(value=>value.type==='query' && value.query.table==='live_viewers').map(value=>value.query.operation),['upsert','update']);
});

test('same-account token refresh during host connection does not invalidate owner scope', async () => {
  const h=liveBackendHarness({query(query,state){if(query.table==='lives')state.refreshToken();}});
  assert.equal((await h.backend.connectHost('owner','live')).url,'wss://rtc.test');
});

function deadlineClock() {
  let next = 0; const timers = new Map();
  return { timers, globals: { setTimeout(callback, ms) { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); } },
    async expire() { for (const [id, timer] of [...timers]) if (timer.ms === 25_000) { timers.delete(id); timer.callback(); } await flush(); } };
}
test('session refresh and remote user verification that never resolve fail in 25 s without starting a domain mutation', async () => {
  for (const boundary of ['session', 'verification']) {
    const clock = deadlineClock();
    const h = liveBackendHarness({ globals: clock.globals, ...(boundary === 'session'
      ? { getSession: () => new Promise(() => {}) } : { onVerify: () => new Promise(() => {}) }) });
    const pending = h.backend.createStudioLive('owner', input);
    const rejected = assert.rejects(pending, error => error.code === 'request_timeout');
    await flush(); assert.ok(clock.timers.size); await clock.expire(); await rejected;
    assert.equal(h.events.some(value => ['upload', 'invoke', 'query'].includes(value.type)), false, boundary);
    assert.equal(clock.timers.size, 0);
  }
});
test('never-resolving fetch releases owner FIFO after deadline so queued end proceeds once', async () => {
  const clock = deadlineClock(); let transportSignal;
  const h = liveBackendHarness({ globals: { ...clock.globals, fetch(_url, init) { transportSignal = init.signal; return new Promise(() => {}); } },
    async invoke(body, state) { if (body.action === 'sync') return state.clients[0].global.fetch('https://fixture.invalid/live'); } });
  const sync = h.backend.syncLive('owner', 'live'), failed = assert.rejects(sync, error => error.code === 'request_timeout');
  await flush(); const end = h.backend.endLive('owner', 'live'); await flush();
  assert.deepEqual(invoked(h).map(value => value.body.action), ['sync']);
  await clock.expire(); await failed; await end;
  assert.equal(transportSignal.aborted, true); assert.equal(clock.timers.size, 0);
  assert.deepEqual(invoked(h).map(value => value.body.action), ['sync', 'end']);
});
test('query body/parsing stall is also bounded and late read cannot publish to the caller', async () => {
  const clock = deadlineClock(), delayed = defer(); let published = false;
  const h = liveBackendHarness({ globals: clock.globals, query: query => query.table === 'lives' ? delayed.promise : undefined });
  const pending = h.backend.getLive('owner', 'live').then(value => { published = true; return value; });
  const failed = assert.rejects(pending, error => error.code === 'request_timeout');
  await flush(); const query = h.events.find(value => value.type === 'query').query;
  await clock.expire(); await failed; assert.equal(query.signal.aborted, true);
  delayed.resolve({ data: liveFixture(), error: null }); await flush(); assert.equal(published, false);
});
test('create deadline recovers confirmed server row or preserves cover on unknown outcome; never resends create', async () => {
  for (const created of [false, true]) {
    const clock = deadlineClock();
    const h = liveBackendHarness({ live: null, globals: clock.globals, invoke(body, state) {
      if (created) state.live = liveFixture({ thumbnail_url: body.thumbnailUrl });
      return new Promise(() => {});
    } });
    const pending = h.backend.createStudioLive('owner', input);
    const result = created ? pending : assert.rejects(pending, error => error.code === 'creation_unknown');
    await flush(); assert.equal(invoked(h).length, 1); await clock.expire();
    const recovered = await result; if (created) assert.equal(recovered.id, 'live');
    assert.equal(invoked(h).length, 1); assert.equal(h.events.some(value => value.type === 'remove'), false);
    assert.equal(clock.timers.size, 0);
  }
});
test('presence compensation verification deadline releases local lease and permits a new join', async () => {
  const clock = deadlineClock(); let hang = true;
  const h = liveBackendHarness({ live: { creator_id: 'creator', status: 'live' }, globals: clock.globals,
    onVerify: () => hang ? new Promise(() => {}) : undefined });
  const first = h.backend.acquireLiveViewerPresence('owner', 'live'); await first.ready;
  const stopped = first.release(), failed = assert.rejects(stopped, error => error.code === 'request_timeout');
  await flush(); await clock.expire(); await failed; hang = false;
  const second = h.backend.acquireLiveViewerPresence('owner', 'live'); assert.equal(await second.ready, true); await second.release();
  assert.deepEqual(h.events.filter(value => value.type === 'query' && value.query.table === 'live_viewers')
    .map(value => value.query.operation), ['upsert', 'upsert', 'update']);
  assert.equal(clock.timers.size, 0);
});
test('paid/Pro chat gate blocks history, profile hydration and send before those queries; owner access remains available', async () => {
  for (const visibility of ['paid', 'pro']) {
    const h = liveBackendHarness({ live: { creator_id: 'creator', visibility, status: 'live' } });
    for (const run of [() => h.backend.assertLiveChatAccess('owner', 'live'), () => h.backend.listLiveMessages('owner', 'live'),
      () => h.backend.getLiveChatProfiles('owner', 'live', ['student']), () => h.backend.sendLiveMessage('owner', 'live', 'Olá')]) {
      await assert.rejects(run(), error => error.code === 'live_access_unsupported');
    }
    assert.equal(h.events.some(value => value.type === 'query' && ['live_messages', 'profiles'].includes(value.query.table)), false);
    const owner = liveBackendHarness({ live: { visibility, status: 'live' }, messages: [messageFixture()] });
    await owner.backend.assertLiveChatAccess('owner', 'live');
    assert.equal((await owner.backend.listLiveMessages('owner', 'live')).length, 1);
    assert.equal((await owner.backend.getLiveChatProfiles('owner', 'live', ['student'])).student.display_name, 'Nome student');
    assert.equal((await owner.backend.sendLiveMessage('owner', 'live', 'Creator')).content, 'Creator');
  }
});
