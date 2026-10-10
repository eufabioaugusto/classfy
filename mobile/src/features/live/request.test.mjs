import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { compileLive, defer, flush } from './liveTestHarness.mjs';

export function liveClock() {
  let next = 0;
  const timers = new Map();
  return { timers, globals: { setTimeout(callback, ms) { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); } },
    async expire(ms = 25_000) { for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.callback(); } await flush(); } };
}
function harness(fetch = async () => new Response('{}')) {
  const clock = liveClock(), model = compileLive('./model.ts');
  const request = compileLive('./request.ts', { './model': model }, { ...clock.globals, fetch });
  return { ...clock, model, request };
}

test('25 s default deadline rejects and aborts even when transport ignores abort forever', async () => {
  let received;
  const h = harness((_url, init) => { received = init.signal; return new Promise(() => {}); });
  const promise = h.request.createLiveFetch()('https://fixture.invalid/live');
  const failed = assert.rejects(promise, error => error.code === 'request_timeout' && !error.message.includes('fixture.invalid'));
  await flush(); assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].ms, 25_000);
  await h.expire(); await failed; assert.equal(received.aborted, true); assert.equal(h.timers.size, 0);
});
test('caller and scope abort both cancel the captured transport and release all listeners/timers', async () => {
  for (const source of ['init', 'scope']) {
    let received, added = 0, removed = 0;
    const controller = new AbortController(), signal = controller.signal;
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args) => { added++; return add(...args); };
    signal.removeEventListener = (...args) => { removed++; return remove(...args); };
    const h = harness((_url, init) => { received = init.signal; return new Promise(() => {}); });
    const promise = h.request.createLiveFetch(undefined, source === 'scope' ? signal : undefined)('https://fixture.invalid',
      source === 'init' ? { signal } : undefined);
    const failed = assert.rejects(promise, error => h.model.isLiveCancellation(error));
    await flush(); controller.abort(); await failed;
    assert.equal(received.aborted, true); assert.equal(h.timers.size, 0); assert.equal(removed, added);
  }
});
test('already-aborted or cancelled scope never calls fetch, including cancellation before queued execution', async () => {
  let calls = 0, current = true;
  const h = harness(async () => { calls++; return new Response('{}'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(h.request.createLiveFetch(undefined, controller.signal)('https://fixture.invalid'), error => h.model.isLiveCancellation(error));
  current = false;
  await assert.rejects(h.request.createLiveFetch(() => { if (!current) throw new h.model.LiveCancelledError(); })('https://fixture.invalid'));
  assert.equal(calls, 0); assert.equal(h.timers.size, 0);
  const next = new AbortController(), promise = h.request.withLiveDeadline(async () => { calls++; }, next.signal);
  const rejected = assert.rejects(promise, error => h.model.isLiveCancellation(error)); next.abort(); await rejected;
  assert.equal(calls, 0); assert.equal(h.timers.size, 0);
});
test('success preserves HTTP errors for SDK parsing and synchronous failure clears deadline', async () => {
  const response = new Response(JSON.stringify({ error: 'O chat está encerrado.' }), { status: 409 });
  const h = harness(async () => response);
  assert.equal(await h.request.createLiveFetch()('https://fixture.invalid'), response);
  assert.equal(h.timers.size, 0);
  await assert.rejects(h.request.withLiveDeadline(() => { throw new Error('boundary failure'); }), /boundary failure/);
  assert.equal(h.timers.size, 0);
});
test('late result after deadline or scope cancellation cannot be published or produce an unhandled rejection', async () => {
  const delayed = defer(); let current = true, published = false;
  const h = harness(() => delayed.promise);
  const promise = h.request.createLiveFetch(() => { if (!current) throw new h.model.LiveCancelledError(); })('https://fixture.invalid')
    .then(() => { published = true; });
  const rejected = assert.rejects(promise, error => error.code === 'request_timeout');
  await flush(); await h.expire(); await rejected; delayed.reject(new Error('late native transport failure')); await flush();
  assert.equal(published, false);
  const cancelled = defer(), second = harness(() => cancelled.promise);
  const stopped = second.request.createLiveFetch(() => { if (!current) throw new second.model.LiveCancelledError(); })('https://fixture.invalid');
  const failed = assert.rejects(stopped, error => second.model.isLiveCancellation(error));
  await flush(); current = false; cancelled.resolve(new Response('{}')); await failed;
  assert.equal(second.timers.size, 0);
});
test('installed Supabase Functions/PostgREST/Auth wrappers preserve recognizable timeout with bounded client fetch', async () => {
  for (const kind of ['function', 'query', 'auth']) {
    const h = harness(() => new Promise(() => {}));
    const client = createClient('https://fixture.invalid', 'fixture-key', { auth: { persistSession: false, autoRefreshToken: false,
      detectSessionInUrl: false }, global: { fetch: h.request.createLiveFetch() } });
    const promise = kind === 'function' ? client.functions.invoke('live-control', { body: { action: 'start' } })
      // Isolate the SDK error envelope; production also bounds the whole query
      // and aborts its signal, so automatic GET retries cannot extend 25 s.
      : kind === 'query' ? Promise.resolve(client.from('lives').select('id').retry(false)) : client.auth.getUser('fixture-token');
    await flush(); assert.ok(h.timers.size >= 1); await h.expire();
    const result = await promise;
    assert.equal(h.request.liveRequestFailure(result.error)?.code, 'request_timeout', kind);
    assert.equal(h.timers.size, 0, kind);
  }
});
