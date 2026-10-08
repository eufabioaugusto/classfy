import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as transport from './uploadTransport.ts';

function compile(path, modules = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
    return modules[name];
  }, Promise, Date, Error, Uint8Array, atob, btoa, setTimeout, ...globals });
  return module.exports;
}
const model = compile('./model.ts');
const hashTimeline = project => createHash('sha256').update(JSON.stringify([project.kind,
  project.takes.map(t => [t.id, t.duration, t.start, t.end])])).digest('hex');
function fixture(overrides = {}) {
  return { version: 1, id: 'project', ownerId: 'owner', kind: 'aula', title: 'Título', description: 'Descrição', objective: 'Objetivo',
    audience: 'Iniciantes', script: 'Roteiro', tags: ['Teste'], visibility: 'free', price: '',
    takes: [{ id: 'take', uri: 'file:///Documents/old-container/video.mp4', name: 'Vídeo', duration: 10, start: 0, end: 10 }],
    coverUrl: 'https://storage.test/cover.jpg', state: 'draft', progress: 0, revision: 1,
    createdAt: '2026-10-08T10:00:00.000Z', updatedAt: '2026-10-08T10:00:00.000Z', ...overrides };
}
function payload(project) {
  return { title: project.title, description: project.description, visibility: project.visibility,
    price: project.price, discount: '0', tags: project.tags, fileUrl: project.mediaAssetId ? `media:${project.mediaAssetId}` : '',
    thumbnailUrl: project.coverUrl || '', mediaAssetId: project.mediaAssetId || null, videoProvider: project.videoProvider || null,
    duration: 10, uploadState: 'preparing', _mobileStudio: { version: 1, projectId: project.id, objective: project.objective,
      audience: project.audience, script: project.script, timelineFingerprint: hashTimeline(project) } };
}
function remoteFor(project, overrides = {}) {
  return { id: 'remote', owner_id: 'owner', draft_key: 'aula:new:project', kind: project.kind, state: 'draft', updated_at: 'saved-1', payload: payload(project), ...overrides };
}
function harness(options = {}) {
  let project = fixture(options.project);
  let remote = options.remote ?? null;
  let sessionOwner = 'owner';
  let listener;
  let saves = 0;
  const events = [];
  class Query {
    constructor(kind, name, body) { this.kind = kind; this.name = name; this.body = body; this.filters = {}; this.headers = {}; }
    select() { return this; } eq(field, value) { this.filters[field] = value; return this; }
    in() { return this; } gte() { return this; } is() { return this; } order() { return this; } limit() { return this; }
    maybeSingle() { return this; } setHeader(name, value) { this.headers[name] = value; return this; }
    then(resolve, reject) { return Promise.resolve().then(() => dispatch(this)).then(resolve, reject); }
  }
  const dispatch = async query => {
    if (query.kind === 'rpc') {
      events.push({ rpc: query.name, body: query.body, headers: query.headers });
      if (query.name === 'save_publication_draft') {
        remote = remoteFor(project, { updated_at: `saved-${++saves + 1}`, payload: query.body.p_payload });
        await options.onSave?.({ query, mutate: values => { project = { ...project, ...values }; }, switchAccount: () => { sessionOwner = 'other'; listener?.('SIGNED_IN', { user: { id: 'other' } }); } });
        return options.saveResponseLost && saves === 1 ? { data: null, error: { message: 'network' } } : { data: remote, error: null };
      }
      if (query.name === 'submit_standalone_publication') {
        remote = { ...remote, state: 'submitted' };
        return options.submitResponseLost ? { data: null, error: { message: 'network' } } : { data: { submissionId: 'submission', contentId: 'content' }, error: null };
      }
      return { data: null, error: null };
    }
    if (query.name === 'user_roles') return { data: [{ role: options.role || 'creator' }], error: null };
    if (query.name === 'profiles') return { data: { creator_status: options.approved === false ? 'pending' : 'approved' }, error: null };
    if (query.name === 'publication_drafts') return { data: remote, error: null };
    if (query.name === 'publication_submissions') return { data: { id: 'submission', source_id: 'content' }, error: null };
    if (query.name === 'media_assets') return { data: options.asset || (query.filters.id ? { id: 'asset', status: 'ready', duration_seconds: 10 } : null), error: null };
    throw new Error(`Unexpected table ${query.name}`);
  };
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: options.authOwner || sessionOwner } }, error: null }),
      getSession: async () => ({ data: { session: { user: { id: sessionOwner }, access_token: 'unit-test-token' } } }),
      onAuthStateChange: callback => { listener = callback; return { data: { subscription: { unsubscribe() { listener = undefined; } } } }; },
    },
    from: name => new Query('table', name), rpc: (name, body) => new Query('rpc', name, body),
    functions: { invoke: async () => { events.push({ target: true }); return { data: { mediaAssetId: 'asset', provider: 'mux', method: 'PUT', uploadUrl: 'https://provider.test/upload' }, error: null }; } },
  };
  const backend = compile('./backend.ts', {
    'expo-file-system/legacy': {},
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'SHA256' }, randomUUID: () => 'random', digestStringAsync: async (_algorithm, value) => createHash('sha256').update(value).digest('hex') },
    '@/lib/supabase': { supabase }, './model': model,
    './media': { cancelStudioExport: async () => { events.push({ exportCancel: true }); }, exportStudioProject: async (active, progress, shouldContinue) => {
      events.push({ export: true }); progress?.(0.5);
      await options.exportPreflight?.();
      if (shouldContinue?.() === false) throw new transport.StudioUploadCancelledError();
      events.push({ nativeExport: true });
      return { uri: 'file:///Documents/export.mp4', duration: 10, mimeType: 'video/mp4', fileSize: 10 };
    } },
    './store': { getStudioProject: (owner, id) => owner === project.ownerId && id === project.id ? project : undefined,
      updateStudioProject: async (owner, id, values) => {
        assert.equal(owner, 'owner'); assert.equal(id, 'project');
        assert.notEqual(project.state, 'submitted');
        project = { ...project, ...values, revision: project.revision + 1 };
        return project;
      } },
    './uploadTransport': { ...transport, cancelStudioTransfer: async () => undefined, uploadStudioFile: async () => { events.push({ upload: true }); } },
  }, { ...(options.fastClock ? { Date: class extends Date { static ticks = 0; static now() { return this.ticks++ * 60_001; } } } : {}), setTimeout: callback => queueMicrotask(callback) });
  return { backend, events, project: () => project, remote: () => remote };
}

test('creator não aprovado é bloqueado antes de exportar ou escrever no servidor', async () => {
  const h = harness({ approved: false });
  await assert.rejects(h.backend.prepareStudioUpload(h.project()), /aprovada como creator/);
  assert.equal(h.events.length, 0);
  assert.equal(h.project().state, 'error');
});
test('troca de conta não pode enviar o projeto de outro proprietário', async () => {
  const h = harness({ authOwner: 'other' });
  await assert.rejects(h.backend.prepareStudioUpload(h.project()), /sessão mudou/);
  assert.equal(h.events.length, 0);
});
test('conflito entre dispositivos preserva o rascunho remoto sem sobrescrever', async () => {
  const project = fixture();
  const h = harness({ remote: remoteFor(project, { payload: { ...payload(project), title: 'Título alterado na web' } }) });
  await assert.rejects(h.backend.prepareStudioUpload(h.project()), /outro dispositivo/);
  assert.equal(h.events.length, 0);
  assert.equal(h.remote().payload.title, 'Título alterado na web');
});
test('RPC já enviado é recuperado sem reabrir rascunho ou submeter novamente', async () => {
  const project = fixture();
  const h = harness({ remote: remoteFor(project, { state: 'submitted' }) });
  const result = await h.backend.prepareStudioUpload(h.project());
  assert.equal(result.state, 'submitted');
  assert.equal(result.submissionId, 'submission');
  assert.equal(result.contentId, 'content');
  assert.equal(h.events.length, 0);
});
test('retomada de asset em processamento não cria outro upload nem finge conclusão', async () => {
  const project = fixture({ state: 'error', mediaAssetId: 'asset', videoProvider: 'mux', remoteDraftId: 'remote', remoteSavedAt: 'saved-1' });
  project.uploadSignature = model.timelineSignature(project);
  const h = harness({ project, remote: remoteFor(project), asset: { id: 'asset', status: 'processing', duration_seconds: 10 }, fastClock: true });
  const result = await h.backend.prepareStudioUpload(h.project());
  assert.equal(result.state, 'processing');
  assert.equal(h.events.filter(e => e.target || e.upload || e.export).length, 0);
});
test('submissão exige estado ready verificado no servidor', async () => {
  const project = fixture({ state: 'ready', mediaAssetId: 'asset', videoProvider: 'mux' });
  project.uploadSignature = model.timelineSignature(project);
  const h = harness({ project, asset: { id: 'asset', status: 'processing', duration_seconds: 10 } });
  await assert.rejects(h.backend.submitStudioProject(h.project()), /A mídia ainda/);
  assert.equal(h.events.length, 0);
});
test('envio confirma curadoria e não inclui URI ou destino assinado no payload', async () => {
  const project = fixture({ state: 'ready', mediaAssetId: 'asset', videoProvider: 'mux', visibility: 'paid', price: '19,90' });
  project.uploadSignature = model.timelineSignature(project);
  const h = harness({ project });
  const result = await h.backend.submitStudioProject(h.project());
  assert.equal(result.state, 'submitted');
  const save = h.events.find(e => e.rpc === 'save_publication_draft');
  assert.equal(save.body.p_payload.price, '19.90');
  assert.equal(save.body.p_payload.fileUrl, 'media:asset');
  assert.equal(JSON.stringify(save.body).includes('file://'), false);
  assert.equal(save.headers.Authorization, 'Bearer unit-test-token');
  assert.equal(h.events.filter(e => e.rpc === 'submit_standalone_publication').length, 1);
});
test('resultado de submit perdido é recuperado sem segunda submissão', async () => {
  const project = fixture({ state: 'ready', mediaAssetId: 'asset', videoProvider: 'mux' });
  project.uploadSignature = model.timelineSignature(project);
  const h = harness({ project, submitResponseLost: true });
  assert.equal((await h.backend.submitStudioProject(h.project())).state, 'submitted');
  assert.equal(h.events.filter(e => e.rpc === 'submit_standalone_publication').length, 1);
});
test('retoma timestamp perdido de RPC idêntico mesmo após mudar container iOS', async () => {
  const original = fixture({ mediaAssetId: 'asset', videoProvider: 'mux' });
  const updated = { ...original, takes: original.takes.map(t => ({ ...t, uri: 'file:///Documents/new-container/video.mp4' })) };
  updated.uploadSignature = model.timelineSignature(updated);
  const h = harness({ project: updated, remote: remoteFor(original) });
  const result = await h.backend.submitStudioProject(h.project());
  assert.equal(result.state, 'submitted');
  assert.equal(result.remoteDraftId, 'remote');
});
test('primeiro save confirmado no servidor mas sem resposta continua recuperável', async () => {
  const h = harness({ saveResponseLost: true });
  await assert.rejects(h.backend.prepareStudioUpload(h.project()), /salvar na sua conta/);
  assert.equal(h.project().remoteSavedAt, undefined);
  assert.equal(h.remote().state, 'draft');
  const progress = [];
  const result = await h.backend.prepareStudioUpload(h.project(), (percent, stage) => progress.push([percent, stage]));
  assert.equal(result.state, 'ready');
  assert.equal(h.events.filter(e => e.target).length, 1);
  assert.equal(h.events.filter(e => e.upload).length, 1);
  assert.ok(progress.some(([percent, stage]) => percent === 50 && stage === 'Preparando arquivo'));
});
test('troca de sessão durante save fixa owner no request e impede transferir arquivo', async () => {
  const h = harness({ onSave: ({ switchAccount }) => switchAccount() });
  await assert.rejects(h.backend.prepareStudioUpload(h.project()), /pausado/);
  assert.equal(h.events.filter(e => e.target || e.upload).length, 0);
  assert.equal(h.events.find(e => e.rpc === 'save_publication_draft').headers.Authorization, 'Bearer unit-test-token');
});
test('mudança de metadata durante sincronização impede submeter uma versão antiga', async () => {
  const project = fixture({ mediaAssetId: 'asset', videoProvider: 'mux' });
  project.uploadSignature = model.timelineSignature(project);
  const h = harness({ project, onSave: ({ mutate }) => mutate({ title: 'Novo título' }) });
  await assert.rejects(h.backend.submitStudioProject(h.project()), /detalhes mudaram/);
  assert.equal(h.project().title, 'Novo título');
  assert.equal(h.events.filter(e => e.rpc === 'submit_standalone_publication').length, 0);
});
test('limite de short também é validado ao atualizar mídia pronta', async () => {
  const project = fixture({ kind: 'short', mediaAssetId: 'asset', videoProvider: 'mux' });
  project.uploadSignature = model.timelineSignature(project);
  const h = harness({ project, asset: { id: 'asset', status: 'ready', duration_seconds: 180.01 } });
  const result = await h.backend.refreshStudioUpload(h.project());
  assert.equal(result.state, 'error');
  assert.match(result.error, /ultrapassa 3 minutos/);
});
test('cancel durante preflight aguarda o job sair e bloqueia editar ou iniciar outro', async () => {
  let release;
  let notifyStarted;
  const deferred = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const h = harness({ exportPreflight: async () => { notifyStarted(); await deferred; } });
  const preparation = h.backend.prepareStudioUpload(h.project());
  // Attach the rejection handler before cancelling; the operation must settle
  // only when preflight sees the cancellation flag, never start native export.
  const stopped = assert.rejects(preparation, /pausado/);
  await started;
  let cancellationComplete = false;
  const cancellation = h.backend.cancelStudioUpload(h.project()).then(() => { cancellationComplete = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancellationComplete, false);
  assert.equal(h.project().state, 'preparing');
  await assert.rejects(h.backend.prepareStudioUpload(h.project()), /operação em andamento/);
  assert.equal(h.events.filter(e => e.nativeExport || e.target || e.upload).length, 0);
  release();
  await stopped;
  await cancellation;
  assert.equal(cancellationComplete, true);
  assert.equal(h.project().state, 'draft');
  assert.equal(h.events.filter(e => e.nativeExport || e.target || e.upload).length, 0);
  const retry = await h.backend.prepareStudioUpload(h.project());
  assert.equal(retry.state, 'ready');
  assert.equal(h.events.filter(e => e.nativeExport).length, 1);
  assert.equal(h.events.filter(e => e.target).length, 1);
});
