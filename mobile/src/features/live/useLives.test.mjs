import test from 'node:test';
import assert from 'node:assert/strict';
import { liveHookHarness, liveFixture, messageFixture, defer, plain } from './liveTestHarness.mjs';

test('detail refresh/poll preserves mounted live and loading=false; network failure does not replace row with loading/error screen', async () => {
  let waiting, fail=false;
  const h=liveHookHarness('useLive',['owner','live'],{query(query){if(query.table==='lives' && waiting)return waiting.promise; if(query.table==='lives' && fail)return {data:null,error:{message:'temporarily offline'}};}});
  await h.flush(); assert.equal(h.output.loading,false); assert.equal(h.output.live.id,'live');
  waiting=defer(); const reload=h.output.reload(); await h.flush();
  assert.equal(h.output.loading,false); assert.equal(h.output.live.id,'live');
  waiting.resolve({data:liveFixture({viewer_count:8}),error:null}); await reload; waiting=null; await h.flush();
  assert.equal(h.output.live.viewer_count,8);
  fail=true; await h.fireTimers(5000);
  assert.equal(h.output.loading,false); assert.equal(h.output.live.viewer_count,8); assert.match(h.output.error,/temporarily offline/);
  h.unmount();
});
test('detail realtime terminal state invalidates older waiting fetch and counts remain current', async () => {
  const initial=defer(); const h=liveHookHarness('useLive',['owner','live'],{query:query=>query.table==='lives'?initial.promise:undefined});
  h.event({eventType:'UPDATE',new:liveFixture({status:'ended',viewer_count:0,peak_viewers:12})}); await h.flush();
  assert.equal(h.output.live.status,'ended');
  initial.resolve({data:liveFixture({status:'waiting'}),error:null}); await h.flush();
  assert.equal(h.output.live.status,'ended'); assert.equal(h.output.live.peak_viewers,12);
  h.unmount();
});
test('account render invalidates pending reads immediately and hides previous owner rows before effect response', async () => {
  const old=defer(); let next=false;
  const h=liveHookHarness('useStudioLives',[],{query(query){if(query.table==='lives')return next?{data:[liveFixture({id:'other-live',creator_id:'other'})],error:null}:old.promise;}});
  await h.flush(); next=true; h.switchOwner('other');
  assert.equal(h.output.lives.length,0); assert.equal(h.output.canCreate,false);
  old.resolve({data:[liveFixture()],error:null}); await h.flush();
  assert.deepEqual(h.output.lives.map(value=>value.id),['other-live']);
  assert.ok(h.channels[0].removed); h.unmount();
});
test('per-instance realtime topics are unique; unmount prevents pending result from entering hook state', async () => {
  const delayed=defer(); const h=liveHookHarness('useLive',['owner','live'],{query:query=>query.table==='lives'?delayed.promise:undefined});
  const other=liveHookHarness('useLive',['owner','live']); await other.flush();
  assert.notEqual(h.channels[0].topic,other.channels[0].topic);
  h.setArgs('owner','live-2'); assert.notEqual(h.channels[0].topic,h.channels[1].topic);
  h.unmount(); delayed.resolve({data:liveFixture(),error:null}); await h.flush();
  assert.equal(h.output.live,null); assert.ok(h.channels.every(channel=>channel.removed)); other.unmount();
});

test('viewer presence activates only after playback, leaves on background, and rejoins when foreground playback resumes', async () => {
  const h=liveHookHarness('useLiveViewerPresence',['owner','live',false],{live:{creator_id:'creator',status:'live'}}); await h.flush();
  const writes=()=>h.base.events.filter(value=>value.type==='query' && value.query.table==='live_viewers');
  assert.equal(writes().length,0); assert.equal(h.output.joined,false);
  h.setArgs('owner','live',true); await h.flush(); assert.equal(h.output.joined,true); assert.equal(writes()[0].query.operation,'upsert');
  h.appState('background'); await h.flush(); assert.equal(h.output.joined,false); assert.equal(writes()[1].query.operation,'update');
  h.appState('active'); await h.flush(); assert.equal(h.output.joined,true); assert.equal(writes()[2].query.operation,'upsert');
  h.unmount(); await h.flush(); assert.equal(writes()[3].query.operation,'update');
});
test('pending viewer join after unmount compensates once and cannot update UI; owner preview never counts', async () => {
  const joined=defer(); const h=liveHookHarness('useLiveViewerPresence',['owner','live',true],{live:{creator_id:'creator',status:'live'},query(query){if(query.table==='live_viewers' && query.operation==='upsert')return joined.promise;}});
  await h.flush(); h.unmount(); joined.resolve({data:{},error:null}); await h.flush();
  const writes=h.base.events.filter(value=>value.type==='query' && value.query.table==='live_viewers');
  assert.deepEqual(writes.map(value=>value.query.operation),['upsert','update']); assert.equal(h.output.joined,false);
  const owner=liveHookHarness('useLiveViewerPresence',['owner','live',true],{live:{status:'live'}}); await owner.flush();
  assert.equal(owner.output.joined,false); assert.equal(owner.base.events.some(value=>value.type==='query' && value.query.table==='live_viewers'),false); owner.unmount();
});

test('StrictMode cleanup/setup cancels the obsolete presence lease and keeps the fresh lease active without duplicate joins', async () => {
  const h=liveHookHarness('useLiveViewerPresence',['owner','live',true],{live:{creator_id:'creator',status:'live'}});
  h.replayEffects(); await h.flush();
  const writes=()=>h.base.events.filter(value=>value.type==='query' && value.query.table==='live_viewers');
  assert.equal(h.output.joined,true); assert.deepEqual(writes().map(value=>value.query.operation),['upsert']);
  h.unmount(); await h.flush(); assert.deepEqual(writes().map(value=>value.query.operation),['upsert','update']);
});
test('chat realtime arriving before initial history does not get overwritten by stale backfill; second fetch retains both', async () => {
  const initial=defer(); let fetches=0;
  const older=messageFixture({id:'older'}),newer=messageFixture({id:'newer',created_at:'2026-10-10T10:00:02Z'});
  const h=liveHookHarness('useLiveChat',['owner','live',true],{query(query){if(query.table==='live_messages' && query.operation==='select' && !query.singleRow){fetches++;return fetches===1?initial.promise:{data:[newer,older],error:null};}}});
  await h.flush(); h.event({eventType:'INSERT',new:newer}); await h.flush();
  initial.resolve({data:[older],error:null}); await h.flush();
  assert.deepEqual(h.output.messages.map(value=>value.id),['older','newer']); assert.equal(fetches,2); h.unmount();
});
test('send blur cancellation releases reservation for retry without exposing late ACK or duplicating realtime message', async () => {
  const reply=defer(); let calls=0,current=true;
  const h=liveHookHarness('useLiveChat',['owner','live',true],{query(query){if(query.table==='live_messages' && query.operation==='insert'){calls++; if(calls===1)return reply.promise;}}});
  await h.flush(); const pending=h.output.send('Primeira',{isCurrent:()=>current});
  const rejected=assert.rejects(pending,error=>h.base.model.isLiveCancellation(error)); await h.flush(); assert.equal(h.output.sending,true);
  current=false; reply.resolve({data:messageFixture({id:'late'}),error:null}); await rejected; await h.flush();
  assert.equal(h.output.sending,false); assert.equal(h.output.messages.some(value=>value.id==='late'),false);
  const sent=await h.output.send('Segunda'); await h.flush();
  h.event({eventType:'INSERT',new:sent}); await h.flush();
  assert.equal(h.output.messages.filter(value=>value.id===sent.id).length,1); h.unmount();
});
test('unknown authors hydrate once in a bounded batch without reloading the full conversation for each message', async () => {
  const h=liveHookHarness('useLiveChat',['owner','live',true]); await h.flush();
  for(const id of ['a','b','c'])h.event({eventType:'INSERT',new:messageFixture({id,user_id:'student',user:undefined})});
  await h.flush(); assert.equal(h.output.messages[0].user,undefined);
  await h.fireTimers(120); assert.ok(h.output.messages.every(value=>value.user.display_name==='Nome student'));
  h.event({eventType:'INSERT',new:messageFixture({id:'d',user_id:'student',user:undefined})}); await h.flush(); await h.fireTimers(120);
  const profiles=h.base.events.filter(value=>value.type==='query' && value.query.table==='profiles');
  assert.equal(profiles.length,1); assert.deepEqual(plain(profiles[0].query.filters.id),['student']);
  assert.equal(h.base.events.filter(value=>value.type==='query' && value.query.table==='live_messages').length,1);
  h.unmount();
});
test('owner list refresh preserves rendered cards and revoked creation access never blocks management data', async () => {
  const h=liveHookHarness('useStudioLives',[],{approved:false}); await h.flush();
  assert.equal(h.output.canCreate,false); assert.equal(h.output.lives.length,1);
  const refresh=h.output.refresh(); h.render(); assert.equal(h.output.loading,false); assert.equal(h.output.lives.length,1);
  await refresh; await h.flush(); h.unmount();
});

test('paid/Pro nonowner never opens a chat Realtime subscription or receives history; owner keeps chat', async () => {
  for (const visibility of ['paid', 'pro']) {
    const h = liveHookHarness('useLiveChat', ['owner', 'live', true], { live: { creator_id: 'creator', visibility } });
    await h.flush(); assert.equal(h.channels.length, 0); assert.equal(h.output.messages.length, 0); assert.equal(h.output.loading, false);
    assert.match(h.output.error, /formato de live/);
    assert.equal(h.base.events.some(value => value.type === 'query' && value.query.table === 'live_messages'), false); h.unmount();
    const owner = liveHookHarness('useLiveChat', ['owner', 'live', true], { live: { visibility }, messages: [messageFixture()] });
    await owner.flush(); assert.equal(owner.channels.length, 1); assert.equal(owner.output.messages.length, 1); owner.unmount();
  }
});
test('chat access confirmation after unmount cannot start subscription, history or hydration', async () => {
  const pending = defer();
  const h = liveHookHarness('useLiveChat', ['owner', 'live', true], { query: query => query.table === 'lives' ? pending.promise : undefined });
  await h.flush(); assert.equal(h.channels.length, 0); h.unmount(); pending.resolve({ data: liveFixture(), error: null }); await h.flush();
  assert.equal(h.channels.length, 0); assert.equal(h.base.events.some(value => value.type === 'query' && value.query.table === 'live_messages'), false);
});
test('delayed Realtime join ACK closes the history gap without missing messages arriving during initial read', async () => {
  const initial = defer(); let reads = 0;
  const old = messageFixture({ id: 'older' }), gap = messageFixture({ id: 'gap', created_at: '2026-10-10T10:00:02Z' });
  const h = liveHookHarness('useLiveChat', ['owner', 'live', true], { query(query) {
    if (query.table === 'live_messages') return ++reads === 1 ? initial.promise : { data: [gap, old], error: null };
  } });
  await h.flush(); h.channels[0].status('SUBSCRIBED'); await h.flush();
  initial.resolve({ data: [old], error: null }); await h.flush();
  assert.deepEqual(h.output.messages.map(value => value.id), ['older', 'gap']); assert.equal(reads, 2); h.unmount();
});
