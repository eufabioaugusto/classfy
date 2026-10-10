import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export function compileLive(name, modules = {}, globals = {}) {
  const code = ts.transpileModule(readFileSync(new URL(name, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, Promise, Error, Date, Uint8Array, atob, AbortController, Response, Headers, fetch, setTimeout, clearTimeout, setInterval, clearInterval, process: { env: {} }, ...globals });
  return module.exports;
}
export const plain = value => JSON.parse(JSON.stringify(value));
export const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
export const flush = async () => { for (let index = 0; index < 120; index++) await Promise.resolve(); };
let hookUUID = 0;
export const liveFixture = (patch = {}) => ({ id: 'live', creator_id: 'owner', title: 'Aula ao vivo', description: '', status: 'waiting',
  visibility: 'free', price: 0, thumbnail_url: null, chat_enabled: true, gifts_enabled: false, viewer_count: 0, peak_viewers: 0,
  mux_live_stream_id: 'stream', livekit_egress_id: null, scheduled_for: null, started_at: null, ended_at: null,
  recording_ready_at: null, replay_content_id: null, replay_published_at: null, followers_notified_at: null,
  created_at: '2026-10-10T10:00:00Z', updated_at: '2026-10-10T10:00:00Z', ...patch });
export const messageFixture = (patch = {}) => ({ id: 'message', live_id: 'live', user_id: 'owner', content: 'Olá', type: 'text', is_pinned: false,
  created_at: '2026-10-10T10:00:01Z', user: { display_name: 'Creator de teste', avatar_url: null }, ...patch });

export function liveBackendHarness(options = {}) {
  let owner = 'owner', uuid = 0, live = options.live === null ? null : liveFixture(options.live), rows = options.messages || [];
  const listeners = new Set(), events = [], clients = [];
  const model = compileLive('./model.ts');
  const request = compileLive('./request.ts', { './model': model }, options.globals);
  const state = { events, clients, model, get live() { return live; }, set live(value) { live = value; },
    switchOwner(value) { owner = value; for (const callback of listeners) callback('SIGNED_IN', value ? { user: { id: value } } : null); },
    refreshToken() { for (const callback of listeners) callback('TOKEN_REFRESHED', { user: { id: owner } }); },
  };
  class Query {
    constructor(table) { this.table = table; this.filters = {}; this.operation = 'select'; }
    select(columns) { this.columns = columns; return this; }
    eq(key, value) { this.filters[key] = value; return this; }
    in(key, value) { this.filters[key] = value; return this; }
    order(key, options) { this.sort = { key, ...options }; return this; }
    limit(value) { this.count = value; return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    maybeSingle() { this.singleRow = true; return this; }
    single() { this.singleRow = true; return this; }
    insert(body) { this.operation = 'insert'; this.body = body; return this; }
    upsert(body, config) { this.operation = 'upsert'; this.body = body; this.upsertConfig = config; return this; }
    update(body) { this.operation = 'update'; this.body = body; return this; }
    delete() { this.operation = 'delete'; return this; }
    then(resolve, reject) { return Promise.resolve().then(async () => {
      events.push({ type: 'query', query: this });
      const overridden = await options.query?.(this, state); if (overridden !== undefined) return overridden;
      if (this.table === 'user_roles') return { data: [{ role: options.role || 'creator' }], error: null };
      if (this.table === 'profiles') return { data: this.singleRow ? { creator_status: options.approved === false ? 'pending' : 'approved' }
        : this.filters.id.map(id => ({ id, display_name: `Nome ${id}`, avatar_url: null })), error: null };
      if (this.table === 'lives') {
        const match = live && Object.entries(this.filters).every(([key, value]) => live[key] === value);
        return { data: this.singleRow ? match ? live : null : match ? [live] : [], error: null };
      }
      if (this.table === 'live_messages') {
        if (this.operation === 'insert') { const row = messageFixture({ ...this.body, id: `message-${++uuid}` }); rows.push(row); return { data: row, error: null }; }
        const selected = rows.filter(row => Object.entries(this.filters).every(([key, value]) => row[key] === value));
        if (this.operation === 'delete') { rows = rows.filter(row => !selected.includes(row)); return { data: selected.map(row => ({ id: row.id })), error: null }; }
        const sorted = selected.sort((a, b) => this.sort?.ascending === false ? b.created_at.localeCompare(a.created_at) : a.created_at.localeCompare(b.created_at));
        return { data: this.singleRow ? sorted[0] || null : sorted.slice(0, this.count || Infinity), error: null };
      }
      if (this.table === 'live_viewers') return { data: {}, error: null };
      throw new Error(`Unexpected table ${this.table}`);
    }).then(resolve, reject); }
  }
  const auth = { getSession: async () => { const override = await options.getSession?.(state); return override ?? { data: { session: owner ? { user: { id: owner }, access_token: `fixture-${owner}` } : null }, error: null }; },
    getUser: async token => { events.push({ type: 'verify' }); await options.onVerify?.(state);
      const verified = token?.startsWith('fixture-') ? token.slice('fixture-'.length) : owner;
      return { data: { user: verified ? { id: verified } : null }, error: options.expiredToken ? {message:'expired'} : null }; },
    onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
  };
  const bucket = { getPublicUrl: path => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/contents/${path}` } }),
    async upload(path, bytes, config) { events.push({ type: 'upload', path, bytes, config }); await options.onUpload?.(state); return { data: {}, error: null }; },
    async remove(paths) { events.push({ type: 'remove', paths }); return { error: null }; },
  };
  const client = { from: table => new Query(table), storage: { from: name => { if (name !== 'contents') throw new Error('wrong bucket'); return bucket; } },
    functions: { async invoke(name, input) {
      events.push({ type: 'invoke', name, ...input });
      const override = await options.invoke?.(input.body, state); if (override !== undefined) return override;
      if (input.body.action === 'create') { live = liveFixture({ thumbnail_url: input.body.thumbnailUrl }); return { data: { liveId: 'live', token: 'unused-create-response' }, error: null }; }
      const responses = { connect: { url: 'wss://rtc.test', token: 'fixture-room' }, 'viewer-connect': { url: 'wss://rtc.test', token: 'fixture-viewer' },
        playback: { type: 'hls', url: 'https://video.test/playlist.m3u8', duration: 3600 }, start: { waitingForMux: true, egressId: 'egress' },
        restart: { waitingForMux: true, egressId: 'egress-restart' }, sync: { status: live?.status }, end: { ending: true },
        'set-chat': { chatEnabled: input.body.enabled }, 'notify-followers': { alreadyNotified: false, notifiedCount: 3 },
        publish: { contentId: 'replay-content', submittedForReview: true }, discard: { discarded: true } };
      return { data: responses[input.body.action], error: null };
    } },
  };
  const fs = { EncodingType: { Base64: 'base64' }, async getInfoAsync(uri) { events.push({ type: 'fileInfo', uri }); return { exists: true, isDirectory: false, size: 4 }; },
    async readAsStringAsync(uri, options) { events.push({ type: 'fileRead', uri, options }); return 'AQIDBA=='; },
    async deleteAsync(uri) { events.push({ type: 'fileDelete', uri }); },
  };
  const image = { ImageManipulator: { manipulate(uri) {
    let resized = false;
    return { crop(rect) { events.push({ type: 'crop', rect }); return this; }, resize(size) { resized = true; events.push({ type: 'resize', size }); return this; },
      async renderAsync() { return { width: resized ? 1920 : options.coverWidth || 1200, height: resized ? 1080 : options.coverHeight || 1600,
        async saveAsync(config) { events.push({ type: 'saveJPEG', config }); return { uri: 'file:///qa/generated-cover.jpg' }; }, release() {} }; }, release() {} };
  } }, SaveFormat: { JPEG: 'jpeg' } };
  state.supabase = { ...client, auth };
  state.request = request;
  state.backend = compileLive('./backend.ts', { './model': model, './request': request, '@/lib/supabase': { supabase: state.supabase },
    '@supabase/supabase-js': { createClient(url, key, config) { clients.push(config); return { ...client, auth }; } },
    'expo-file-system/legacy': fs, 'expo-crypto': { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}` }, 'expo-image-manipulator': image }, options.globals);
  return state;
}

// React/OS boundaries only: the actual production hooks, model and backend run
// unchanged. Effects use cleanup/setup order and asynchronous I/O is controlled.
export function liveHookHarness(name, args = [], options = {}) {
  const base = liveBackendHarness(options), slots = [], channels = [], appListeners = new Set(), timers = new Map();
  let cursor = 0, pendingEffects = [], dirty = true, owner = 'owner', timerId = 0, currentArgs = args, mounted = true, output;
  const same = (a, b) => a && b && a.length === b.length && a.every((value,index)=>Object.is(value,b[index]));
  const react = {
    useRef(initial) { const index=cursor++; return (slots[index] ||= { ref: { current: initial } }).ref; },
    useState(initial) {
      const index=cursor++; const slot=slots[index] ||= { value: typeof initial==='function' ? initial() : initial };
      return [slot.value, value=> { slot.value=typeof value==='function' ? value(slot.value) : value; dirty=true; }];
    },
    useCallback(fn,deps) { const index=cursor++; const slot=slots[index]; if(!slot || !same(slot.deps,deps)) slots[index]={value:fn,deps}; return slots[index].value; },
    useEffect(effect,deps) {
      const index=cursor++; const previous=slots[index];
      if(!previous || !same(previous.deps,deps)) { const next={deps,effect,cleanup:previous?.cleanup}; slots[index]=next; pendingEffects.push(()=>{next.cleanup?.(); next.cleanup=effect();}); }
    },
  };
  const AppState={currentState:'active', addEventListener(event,callback) { appListeners.add(callback); return {remove:()=>appListeners.delete(callback)}; }};
  const supabase={...base.supabase, channel(topic) {
    const channel={topic,removed:false, on(event,filter,callback){this.filter=filter; this.callback=callback; return this;},subscribe(callback){this.status=callback; callback?.('SUBSCRIBED'); return this;}};
    channels.push(channel); return channel;
  }, async removeChannel(channel){channel.removed=true;} };
  const timer=(callback,ms,repeat=false)=>{const id=++timerId; timers.set(id,{callback,ms,repeat}); return id;};
  const hooks=compileLive('./useLives.ts',{'react':react,'react-native':{AppState},'expo-crypto':{randomUUID:()=>`hook-${++hookUUID}`},
    '@/features/auth/authContext':{useAuth:()=>({user:owner?{id:owner}:null})},'@/lib/supabase':{supabase},'./model':base.model,'./backend':{...base.backend,...options.backend}},
    {setTimeout:(callback,ms)=>timer(callback,ms),clearTimeout:id=>timers.delete(id),setInterval:(callback,ms)=>timer(callback,ms,true),clearInterval:id=>timers.delete(id)});
  const render=()=>{if(!mounted)return; cursor=0; dirty=false; output=hooks[name](...currentArgs); const effects=pendingEffects; pendingEffects=[]; effects.forEach(fn=>fn());};
  const h={base,channels,AppState,get output(){return output;},render,
    async flush(){for(let index=0;index<12;index++){await flush(); if(dirty)render(); else {await flush(); if(!dirty)break;}}},
    setArgs(...values){currentArgs=values;render();},
    switchOwner(value){owner=value;base.switchOwner(value);render();},
    event(payload,channel=channels.findLast(value=>!value.removed)){channel.callback(payload);},
    appState(value){AppState.currentState=value;for(const callback of appListeners)callback(value);},
    async fireTimers(ms){for(const[id,item]of [...timers])if(item.ms===ms){if(!item.repeat)timers.delete(id);item.callback();} await this.flush();},
    replayEffects(){for(const slot of slots)slot?.cleanup?.(); for(const slot of slots)if(slot?.effect)slot.cleanup=slot.effect();},
    unmount(){mounted=false;for(const slot of slots)slot?.cleanup?.();},
  };
  render(); return h;
}
