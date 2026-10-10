import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createJourneyRuntime, loadJourneyModule } from './editorJourneyHarness.mjs';

const source = readFileSync(new URL('../../../app/studio/review.tsx', import.meta.url), 'utf8') + '\nexport { PublicationReview };';
function compile(sourceText, dependencies) {
  const code = ts.transpileModule(sourceText, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unconfigured review boundary: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Projects and metadata persistence are production code, including the schema 2
// non-enumerable adapter. Native decoding and backend/network work are explicit
// boundaries; this suite never publishes, uploads or claims pixel acceptance.
async function reviewHarness(kind = 'aula', options = {}) {
  const runtime = createJourneyRuntime();
  const { store, model, media } = runtime;
  const original = runtime.fixture(kind === 'podcast' ? 'lesson.m4a' : 'lesson.mp4', kind === 'podcast' ? { hasVideo: false, width: 0, height: 0 } : {});
  const created = await store.createStudioProject(runtime.owner(), kind);
  runtime.queuePicker(original);
  await media.importStudioMedia(created);
  let project = store.getStudioProject(runtime.owner(), created.id);
  const text = model.createStudioTextItem({ id: 'review-caption', content: 'Aprendizado', durationTicks: model.studioTicks(3) });
  const editing = kind === 'podcast' ? project.editing : model.addStudioLayerItem(project.editing, text, `layer:item:${text.id}`);
  project = await store.updateStudioProject(runtime.owner(), project.id, {
    editing, title: 'Aula com qualidade', description: 'Um aprendizado completo.', coverUri: runtime.fixture('cover.jpg'), tags: ['estudo'], ...options.initial,
  });
  const slots = [], alerts = [], navigation = [], appListeners = new Set();
  const calls = { prepare: [], submit: [], refresh: [], cancel: [], export: [], cancelExport: [], share: [] };
  let cursor = 0, dirty = true, tree, effects = [], removal, mounted = true;
  const same = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const hooks = {
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useMemo(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) slots[index] = { value: callback(), dependencies };
      return slots[index].value;
    },
    useCallback(callback, dependencies) { return hooks.useMemo(() => callback, dependencies); },
    useEffect(callback, dependencies) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies });
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  const native = {
    ActivityIndicator: 'spinner', AppState: { addEventListener: (_, callback) => { appListeners.add(callback); return { remove: () => appListeners.delete(callback) }; } },
    Alert: { alert: (...args) => alerts.push(args) }, KeyboardAvoidingView: 'keyboard', Platform: { OS: 'ios' },
    Pressable: 'button', ScrollView: 'scroll', Share: { share: async (...args) => { calls.share.push(args); return { action: 'dismissedAction' }; } }, StatusBar: { setHidden() {}, setBarStyle() {} },
    Text: 'text', TextInput: 'input', View: 'view', StyleSheet: { create: value => value, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  const router = { replace: destination => navigation.push(destination) };
  const navigationBoundary = { useNavigation: () => ({ dispatch: action => navigation.push(action) }), usePreventRemove: (enabled, callback) => { removal = { enabled, callback }; } };
  const auth = { useAuth: () => ({ user: { id: runtime.owner() }, profile: { creator_status: 'approved' } }) };
  const ui = loadJourneyModule('./StudioUI.tsx', {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useRouter: () => router }, '@react-navigation/native': navigationBoundary,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 34 }) },
    'lucide-react-native': { Check: 'check', Cloud: 'cloud', LockKeyhole: 'lock' },
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' },
    '@/components/LoadingPlaceholder': { SkeletonBlock: 'skeleton', SkeletonGroup: 'skeletons' },
    '@/features/auth/authContext': auth, '@/contexts/PrimaryActionContext': { usePrimaryAction: () => ({ canPublish: true }) },
    '@/theme/colors': { colors: {} }, '@/theme/controls': { controls: {} },
    '../../../modules/classfy-studio-media': { isStudioMediaAvailable: () => true },
  });
  const update = async (id, patch) => store.updateStudioProject(runtime.owner(), id, patch);
  const backend = {
    prepareStudioUpload: async (value, progress) => {
      calls.prepare.push({ project: value, progress });
      if (options.prepare) return options.prepare(value, progress, runtime);
      progress(100, 'Preparando sua montagem');
      return update(value.id, { state: 'ready', progress: 100 });
    },
    submitStudioProject: async value => { calls.submit.push(value); return value; },
    refreshStudioUpload: async value => { calls.refresh.push(value); return value; },
    cancelStudioUpload: async value => { calls.cancel.push(value); return value; },
  };
  const screen = compile(source, {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': native,
    'expo-router': { useLocalSearchParams: () => ({ id: created.id }), useRouter: () => router, useFocusEffect: callback => hooks.useEffect(callback, []) },
    'lucide-react-native': Object.fromEntries('Check CheckCircle2 ChevronRight Circle Download ImagePlus RefreshCw Send'.split(' ').map(name => [name, name])),
    '@/components/AppScreen': { AppScreen: 'screen' }, '@/components/NavigationHeader': { NavigationHeader: 'header' },
    '@/components/LoadingImage': { LoadingImage: 'image' }, '@/components/PlanCrown': { PlanCrown: 'crown' },
    '@/theme/colors': { colors: {} }, '@/features/auth/authContext': auth,
    '@/features/studio/useStudioProjects': { useStudioProject: () => ({ project: current(), loading: false, update }) },
    '@/features/studio/useStudioOrientation': { useStudioOrientation() {} },
    '@/features/studio/media': {
      importStudioCover: async () => null,
      exportStudioProject: async (value, progress, shouldContinue) => {
        calls.export.push({ project: value, progress, shouldContinue });
        if (options.export) return options.export(value, progress, shouldContinue, runtime);
        assert.equal(shouldContinue(), true);
        progress(0.5);
        const uri = runtime.fixture(`export-${calls.export.length}.mp4`);
        await update(value.id, { exportedUri: uri, exportedSignature: model.timelineSignature(value) });
        return { uri, duration: 8, mimeType: 'video/mp4', fileSize: 8192 };
      },
      cancelStudioExport: async value => { calls.cancelExport.push(value); },
    }, '@/features/studio/backend': backend,
    '@/features/studio/model': model,
    '@/features/studio/StudioUI': { ...ui, StudioAccess: 'access', StudioButton: 'studio-button', StudioField: 'field', StudioFooter: 'footer', StudioLoading: 'loading', StudioSaveStatus: 'save-status' },
    '@/features/studio/StudioCompositionPreview': { StudioCompositionPreview: 'composition-preview' },
  });
  const current = () => store.getStudioProject(runtime.owner(), created.id);
  const unsubscribe = store.subscribeStudio(() => { dirty = true; });
  function render() {
    cursor = 0; dirty = false; effects = [];
    tree = screen.PublicationReview({ project: current(), update });
    for (const effect of effects) {
      slots[effect.index]?.cleanup?.();
      slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
    }
  }
  async function pump() {
    for (let count = 0; count < 30; count++) {
      if (dirty && mounted) render();
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return tree;
    }
    assert.fail('Review render did not settle');
  }
  const all = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children), ...all(node.props?.header)];
  const nodes = () => all(tree);
  const find = predicate => { const value = nodes().find(predicate); assert.ok(value, 'Missing review control'); return value; };
  const control = label => find(node => node.props?.label === label || node.props?.accessibilityLabel === label);
  await pump();
  return {
    runtime, calls, alerts, navigation, current, nodes, control, pump,
    press: label => control(label).props.onPress(),
    change: (label, value) => control(label).props.onChangeText(value),
    patch: patch => update(created.id, patch),
    removal: () => removal,
    text: () => nodes().filter(node => node.type === 'text').map(node => [node.props.children].flat().filter(value => typeof value === 'string' || typeof value === 'number').join('')).join(' '),
    progress: () => nodes().find(node => node.props?.accessibilityRole === 'progressbar'),
    preview: () => nodes().find(node => node.type === 'composition-preview'),
    dispose: async () => { mounted = false; unsubscribe(); for (const slot of slots) slot?.cleanup?.(); await new Promise(resolve => setImmediate(resolve)); },
  };
}

for (const kind of ['aula', 'short', 'podcast']) test(`${kind}: editor/store schema 2 opens publication review without losing its non-enumerable takes`, async t => {
  const view = await reviewHarness(kind); t.after(view.dispose);
  const project = view.current();
  assert.equal(Object.getOwnPropertyDescriptor(project, 'takes').enumerable, false);
  assert.equal({ ...project }.takes, undefined, 'The fixture must reproduce the actual adapter, not a plain legacy object');
  assert.equal(project.takes.length, 1);
  assert.deepEqual(view.runtime.model.publicationIssues(project), []);
  assert.equal(view.control('Preparar envio').props.disabled, false);
  assert.ok(view.text().includes('Conteúdo gravado e montagem válida'));
  assert.equal(view.calls.prepare.length, 0);
  assert.equal(view.runtime.exports.length, 0);
});

test('review drains real metadata persistence before preparation and reserves synchronous double taps', async t => {
  const view = await reviewHarness(); t.after(view.dispose);
  const before = view.current(), gate = view.runtime.deferWrite();
  view.change('Título', 'Título revisado'); view.change('Tags (opcional)', 'aula, aula, edição');
  await view.pump();
  const callback = view.control('Preparar envio').props.onPress;
  callback(); callback();
  await gate.entered; await view.pump();
  assert.equal(view.calls.prepare.length, 0, 'Preparation cannot outrun pending metadata');
  assert.equal(view.progress().props.accessibilityValue.now, 0);
  assert.equal(view.preview().props.paused, true);
  assert.equal(view.preview().props.project.editing, before.editing);
  assert.ok(view.text().includes('Mantenha o aplicativo aberto'));
  gate.resolve(); await view.pump();
  assert.equal(view.calls.prepare.length, 1);
  assert.equal(view.calls.prepare[0].project.title, 'Título revisado');
  assert.deepEqual(view.calls.prepare[0].project.tags, ['aula', 'edição']);
  assert.deepEqual(view.calls.prepare[0].project.takes, before.takes);
  assert.deepEqual(view.current().editing, before.editing);
  assert.equal(view.current().state, 'ready');
  assert.equal(view.runtime.exports.length, 0);
});

test('preparation percentages describe each stage; server processing does not invent a percentage', async t => {
  const complete = deferred();
  const view = await reviewHarness('aula', { prepare: (_, __) => complete.promise }); t.after(view.dispose);
  view.press('Preparar envio'); await view.pump();
  const report = view.calls.prepare[0].progress;
  report(100, 'Exportando sua montagem'); await view.pump();
  assert.equal(view.progress().props.accessibilityLabel, 'Exportando sua montagem');
  assert.equal(view.progress().props.accessibilityValue.now, 100);
  await view.patch({ state: 'uploading', progress: 0 });
  report(18, 'Enviando conteúdo'); await view.pump();
  assert.equal(view.progress().props.accessibilityLabel, 'Enviando conteúdo');
  assert.equal(view.progress().props.accessibilityValue.now, 18);
  assert.ok(view.text().includes('18% da etapa'));
  await view.patch({ state: 'processing', progress: 100 }); await view.pump();
  assert.equal(view.progress(), undefined);
  assert.ok(view.text().includes('Você pode sair desta tela'));
  complete.resolve(view.current()); await view.pump();
  assert.equal(view.calls.submit.length, 0);
});

test('cancel during metadata flush preserves metadata and never starts preparation afterwards', async t => {
  const view = await reviewHarness(); t.after(view.dispose);
  const before = view.current(), gate = view.runtime.deferWrite();
  view.change('Título', 'Texto preservado ao interromper'); await view.pump();
  view.press('Preparar envio'); await gate.entered; await view.pump();
  view.press('Interromper envio');
  const confirmation = view.alerts.find(([title]) => title === 'Interromper o envio?');
  assert.ok(confirmation); confirmation[2].find(option => option.text === 'Interromper').onPress();
  gate.resolve(); await view.pump();
  assert.equal(view.calls.cancel.length, 1);
  assert.equal(view.calls.prepare.length, 0);
  assert.equal(view.current().title, 'Texto preservado ao interromper');
  assert.deepEqual(view.current().editing, before.editing);
  assert.deepEqual(view.current().takes, before.takes);
  assert.equal(view.preview(), undefined);
  assert.equal(view.control('Preparar envio').props.loading, false);
});

test('failed save keeps the review draft and original montage, retries once, and ignores completed progress callbacks', async t => {
  const view = await reviewHarness(); t.after(view.dispose);
  const original = view.current(), gate = view.runtime.deferWrite();
  view.change('Título', 'Rascunho ainda visível'); await view.pump();
  view.press('Preparar envio'); await gate.entered;
  gate.reject(new Error('Local save unavailable')); await view.pump();
  assert.equal(view.calls.prepare.length, 0);
  assert.equal(view.current().title, original.title);
  assert.equal(view.control('Título').props.value, 'Rascunho ainda visível');
  assert.deepEqual(view.current().editing, original.editing);
  assert.ok(view.text().includes('Seu projeto continua salvo'));
  view.press('Preparar envio'); await view.pump();
  assert.equal(view.calls.prepare.length, 1);
  assert.equal(view.current().title, 'Rascunho ainda visível');
  const late = view.calls.prepare[0].progress;
  late(15, 'Progresso antigo'); await view.pump();
  assert.equal(view.progress().props.accessibilityLabel, 'Pronto para enviar');
  assert.equal(view.progress().props.accessibilityValue.now, 100);
  assert.ok(!view.text().includes('Progresso antigo'));
});

test('review back navigation awaits real metadata save and preserves source clips and overlays', async t => {
  const view = await reviewHarness(); t.after(view.dispose);
  const before = view.current(), gate = view.runtime.deferWrite();
  view.change('Tags (opcional)', 'retorno, aprendizado'); await view.pump();
  assert.equal(view.removal().enabled, true);
  const action = { type: 'GO_BACK' };
  view.removal().callback({ data: { action } }); await gate.entered; await view.pump();
  assert.deepEqual(view.navigation, []);
  gate.resolve(); await view.pump();
  assert.deepEqual(view.navigation, [action]);
  assert.deepEqual(view.current().tags, ['retorno', 'aprendizado']);
  assert.deepEqual(view.current().editing, before.editing);
  assert.deepEqual(view.current().takes, before.takes);
  assert.equal(view.calls.prepare.length, 0);
});

test('pending originals remain real publication blockers', async t => {
  const view = await reviewHarness('aula', { initial: { pendingTakes: [{ id: 'pending', uri: 'file:///pending.mp4', name: 'Take pendente' }] } }); t.after(view.dispose);
  assert.equal(view.control('Preparar envio').props.disabled, true);
  view.press('Preparar envio'); await view.pump();
  assert.equal(view.calls.prepare.length, 0);
  assert.ok(view.text().includes('Recupere ou retire os arquivos pendentes'));
  assert.equal(view.current().takes.length, 1);
});

test('local export is available without publication metadata and never calls the publishing backend', async t => {
  const view = await reviewHarness('aula', { initial: { title: '', description: '', coverUri: undefined } }); t.after(view.dispose);
  const before = view.current();
  assert.equal(view.control('Preparar envio').props.disabled, true);
  assert.equal(view.control('Exportar arquivo').props.disabled, false);
  const callback = view.control('Exportar arquivo').props.onPress;
  callback(); callback(); await view.pump();
  assert.equal(view.calls.export.length, 1);
  assert.equal(view.current().state, 'draft');
  assert.deepEqual(view.current().editing, before.editing);
  assert.deepEqual(view.current().takes, before.takes);
  assert.ok(view.current().exportedUri);
  assert.ok(view.text().includes('Arquivo preparado'));
  assert.equal(view.progress().props.accessibilityValue.now, 100);
  assert.equal(view.preview().props.paused, true);
  assert.equal(view.calls.prepare.length + view.calls.submit.length + view.calls.cancel.length, 0);
  assert.equal(view.calls.share.length, 0, 'Export must not open a share sheet automatically');
  view.press('Salvar/compartilhar'); await view.pump();
  assert.equal(view.calls.export.length, 2, 'Revalidate the local file before exposing it to the share sheet');
  assert.deepEqual(view.calls.share[0][0], { url: view.current().exportedUri });
  assert.equal(view.current().state, 'draft', 'Dismissing the share sheet must not submit the project');
  assert.equal(view.calls.prepare.length + view.calls.submit.length, 0);
});

test('local export reports native progress and cancellation targets encoding, preserving originals', async t => {
  const complete = deferred();
  const view = await reviewHarness('aula', { export: (_, __, shouldContinue) => complete.promise.then(result => {
    if (!shouldContinue()) throw new Error('Preparação interrompida.');
    return result;
  }) }); t.after(view.dispose);
  const before = view.current();
  view.press('Exportar arquivo'); await view.pump();
  const operation = view.calls.export[0];
  operation.progress(0.37); await view.pump();
  assert.equal(view.progress().props.accessibilityLabel, 'Exportando arquivo');
  assert.equal(view.progress().props.accessibilityValue.now, 37);
  assert.ok(view.text().includes('Mantenha o aplicativo aberto até o arquivo ficar pronto'));
  view.press('Interromper exportação');
  view.alerts.find(([title]) => title === 'Interromper a exportação?')[2].find(option => option.text === 'Interromper').onPress();
  assert.equal(operation.shouldContinue(), false);
  complete.resolve({ uri: 'file:///cancelled.mp4', duration: 8, mimeType: 'video/mp4', fileSize: 1 }); await view.pump();
  assert.equal(view.calls.cancelExport.length, 1);
  assert.equal(view.calls.cancel.length + view.calls.prepare.length + view.calls.submit.length, 0);
  assert.deepEqual(view.current().editing, before.editing);
  assert.deepEqual(view.current().takes, before.takes);
  assert.equal(view.current().exportedUri, undefined);
  assert.equal(view.current().state, 'draft');
  assert.equal(view.progress(), undefined);
  operation.progress(1); await view.pump();
  assert.equal(view.progress(), undefined, 'Cancelled progress must not revive the ready-file card');
  assert.equal(view.calls.share.length, 0);
});

test('export waits for metadata and cancellation before encoding never starts it afterwards', async t => {
  const view = await reviewHarness(); t.after(view.dispose);
  const gate = view.runtime.deferWrite();
  view.change('Título', 'Metadados antes do arquivo'); await view.pump();
  view.press('Exportar arquivo'); await gate.entered; await view.pump();
  assert.equal(view.calls.export.length, 0);
  view.press('Interromper exportação');
  view.alerts.find(([title]) => title === 'Interromper a exportação?')[2].find(option => option.text === 'Interromper').onPress();
  gate.resolve(); await view.pump();
  assert.equal(view.calls.export.length, 0);
  assert.equal(view.current().title, 'Metadados antes do arquivo');
  assert.equal(view.calls.cancelExport.length, 1);
  assert.equal(view.calls.prepare.length + view.calls.submit.length, 0);
});

test('leaving review during file revalidation cannot open a late share sheet', async t => {
  const complete = deferred(); let awaitingShare = false;
  const view = await reviewHarness('aula', { export: async (project, progress, shouldContinue, runtime) => {
    if (awaitingShare) await complete.promise;
    if (!shouldContinue()) throw new Error('Preparação interrompida.');
    progress(1);
    const uri = runtime.fixture('prepared.mp4');
    await runtime.store.updateStudioProject(runtime.owner(), project.id, { exportedUri: uri, exportedSignature: runtime.model.timelineSignature(project) });
    return { uri, duration: 8, mimeType: 'video/mp4', fileSize: 8192 };
  } });
  view.press('Exportar arquivo'); await view.pump();
  assert.ok(view.current().exportedUri);
  awaitingShare = true;
  view.press('Salvar/compartilhar'); await view.pump();
  const operation = view.calls.export.at(-1);
  assert.equal(operation.shouldContinue(), true);
  await view.dispose();
  assert.equal(operation.shouldContinue(), false);
  complete.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.calls.share.length, 0);
  assert.equal(view.calls.prepare.length + view.calls.submit.length, 0);
  assert.equal(view.current().state, 'draft');
});

test('an export completed behind its confirmation cannot cancel a later operation or call upload cancellation', async t => {
  const complete = deferred();
  const view = await reviewHarness('aula', { export: async (project, _, shouldContinue, runtime) => {
    await complete.promise;
    assert.equal(shouldContinue(), true);
    const uri = runtime.fixture('complete-before-alert.mp4');
    await runtime.store.updateStudioProject(runtime.owner(), project.id, { exportedUri: uri, exportedSignature: runtime.model.timelineSignature(project) });
    return { uri, duration: 8, mimeType: 'video/mp4', fileSize: 8192 };
  } }); t.after(view.dispose);
  view.press('Exportar arquivo'); await view.pump();
  view.press('Interromper exportação');
  const staleConfirm = view.alerts.at(-1)[2].find(option => option.text === 'Interromper').onPress;
  complete.resolve(); await view.pump();
  assert.ok(view.text().includes('Arquivo preparado'));
  staleConfirm(); await view.pump();
  assert.equal(view.calls.cancelExport.length + view.calls.cancel.length, 0);
  assert.equal(view.current().state, 'draft');
  assert.ok(view.current().exportedUri);
});
