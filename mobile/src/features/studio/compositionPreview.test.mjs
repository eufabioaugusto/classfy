import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

const take = id => ({ id, uri: `file:///${id}.mp4`, name: id, duration: 10, start: 2, end: 8, width: 1920, height: 1080 });
function project() {
  const editing = model.reconcileStudioTakes({ kind: 'aula', editing: model.emptyStudioEditing('aula') }, [take('a'), take('b')]);
  return model.withStudioTakes({ id: 'project', ownerId: 'owner', kind: 'aula', revision: 1, version: 1,
    state: 'draft', title: '', objective: '', audience: '', script: '', editing });
}
function graded(value) {
  return model.withStudioTakes({ ...value, revision: value.revision + 1,
    editing: { ...value.editing, main: value.editing.main.map((clip, index) => index ? clip : { ...clip, grade: model.studioGrade('studio') }) } });
}

// Execute the production wrapper and NativePreview hooks, imperative handle,
// native event handlers and promise continuations. AVPlayer's async command
// completion is stubbed independently from periodic events and React renders.
function harness({ available = true, initialProject = project() } = {}) {
  const slots = []; let cursor = 0, dirty = true, effects = [], tree, nativeProps;
  const published = [], selected = [], calls = [];
  const ref = { current: null };
  const equals = (a, b) => !!a && !!b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  const hooks = {
    forwardRef: callback => callback,
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useState: initial => {
      const index = cursor++;
      slots[index] ||= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, next => {
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useMemo: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) slots[index] = { value: callback(), dependencies };
      return slots[index].value;
    },
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) effects.push({ index, callback, dependencies });
    },
    useImperativeHandle: (target, callback, dependencies) => {
      const index = cursor++;
      if (!slots[index] || !equals(slots[index].dependencies, dependencies)) {
        slots[index] = { dependencies }; target.current = callback();
      }
    },
  };
  const jsx = (type, props) => {
    if (typeof type === 'function') return type(props, props.ref);
    if (type === 'native-canvas') { nativeProps = props; props.ref.current = { tag: 73 }; }
    return { type, props };
  };
  const command = (kind, args) => new Promise((resolve, reject) => { calls.push({ kind, args, resolve, reject }); });
  const dependencies = {
    react: hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'view', Text: 'text', findNodeHandle: value => value?.tag,
      StyleSheet: { create: styles => styles, absoluteFill: {}, absoluteFillObject: {} } },
    'expo-modules-core': { requireNativeViewManager: () => 'native-canvas' },
    '../../../modules/classfy-studio-media': { isStudioCompositionAvailable: () => available,
      seekStudioCompositionAsync: (...args) => command('seek', args),
      previewStudioCompositionSourceAsync: (...args) => command('source', args) },
    './model': model, './StudioPreview': { StudioPreview: 'legacy-preview' },
  };
  const code = ts.transpileModule(readFileSync(new URL('./StudioCompositionPreview.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected dependency: ${name}`);
  }, module, module.exports);
  const component = module.exports.StudioCompositionPreview;
  let props = { project: initialProject, activeTakeId: 'a', onPlaybackState: value => published.push(value), onActiveTakeChange: id => selected.push(id) };
  function render() {
    dirty = false; cursor = 0; effects = []; nativeProps = undefined;
    tree = component(props, ref);
    for (const effect of effects) {
      slots[effect.index]?.cleanup?.();
      slots[effect.index] = { dependencies: effect.dependencies, cleanup: effect.callback() };
    }
  }
  async function pump() {
    for (let pass = 0; pass < 20; pass++) {
      if (dirty) render();
      await new Promise(resolve => setImmediate(resolve));
      if (!dirty) return;
    }
    throw new Error('Composition preview did not settle');
  }
  const state = overrides => ({ positionSeconds: 3, sourcePositionSeconds: 5, clipId: 'a', playing: false,
    loading: false, revision: nativeProps.revision, token: calls.at(-1)?.args.at(-1) || 0, ...overrides });
  const nodes = value => !value ? [] : Array.isArray(value) ? value.flatMap(nodes)
    : typeof value === 'object' ? [value, ...nodes(value.props?.children)] : [value];
  return { ref, calls, published, selected, pump,
    update: patch => { props = { ...props, ...patch }; dirty = true; },
    project: () => props.project, canvas: () => nativeProps,
    state, emit: overrides => nativeProps.onPlaybackState({ nativeEvent: state(overrides) }),
    error: (message, overrides = {}) => nativeProps.onError({ nativeEvent: { revision: nativeProps.revision, token: calls.at(-1)?.args.at(-1) || 0, message, ...overrides } }),
    text: () => nodes(tree).filter(value => typeof value === 'string').join(' '),
    has: type => nodes(tree).some(value => value?.type === type),
  };
}

test('erro nativo permanece visível durante periodic publish; somente comando confirmado o limpa', async () => {
  const h = harness(); await h.pump();
  h.error('Não foi possível renderizar a edição.'); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/);
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/);
  h.ref.current.seek(4); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/, 'pending seek cannot hide a native failure');
  h.calls.at(-1).resolve(h.state({ positionSeconds: 4 })); await h.pump();
  assert.doesNotMatch(h.text(), /Não foi possível renderizar/);
});

test('retry confirmado de frame limpa erro do corte sem alterar a âncora de reprodução', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  const count = h.published.length;
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
  h.calls.at(-1).reject(new Error('Falha temporária ao ler o quadro.')); await h.pump();
  assert.match(h.text(), /Falha temporária/);
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 8.5 });
  const retry = h.calls.at(-1);
  h.emit({ clipId: 'b', sourcePositionSeconds: 8.5 }); await h.pump();
  assert.match(h.text(), /Falha temporária/, 'periodic event is not proof of frame rendering');
  retry.resolve(h.state({ clipId: 'b', sourcePositionSeconds: 8.5 })); await h.pump();
  assert.doesNotMatch(h.text(), /Falha temporária/);
  assert.equal(h.published.length, count);
  assert.equal(h.published.at(-1).position, 4);
});

test('reprodução confirmada recupera erro de áudio; periodic playing não esconde falha de composição', async () => {
  const h = harness(); await h.pump();
  h.error('Não foi possível renderizar.', { code: 'E_STUDIO_COMPOSITION' }); await h.pump();
  h.emit({ playing: true }); await h.pump();
  assert.match(h.text(), /Não foi possível renderizar/);
  h.error('Não foi possível ativar o som.', { code: 'E_STUDIO_AUDIO_SESSION' }); await h.pump();
  h.emit({ playing: false, loading: true }); await h.pump();
  assert.match(h.text(), /Não foi possível ativar o som/);
  h.ref.current.togglePlayback(); await h.pump();
  assert.match(h.text(), /Não foi possível ativar o som/, 'tentar play não confirma ativação');
  h.emit({ playing: true, loading: false }); await h.pump();
  assert.doesNotMatch(h.text(), /Não foi possível ativar o som/);
});

test('rejeição de seek da receita anterior não aparece depois de alterar o tratamento', async () => {
  const h = harness(); await h.pump();
  h.ref.current.seek(3); const old = h.calls.at(-1); const revision = h.canvas().revision;
  h.update({ project: graded(h.project()) }); await h.pump();
  assert.notEqual(h.canvas().revision, revision);
  old.reject(new Error('Preparação cancelada da receita anterior.')); await h.pump();
  assert.doesNotMatch(h.text(), /receita anterior/);
  assert.equal(h.calls.length, 1);
});

test('rejeição e evento de frame antigo respeitam tanto a revisão quanto o token', async () => {
  const h = harness(); await h.pump();
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
  const old = h.calls.at(-1); const oldRevision = h.canvas().revision;
  h.update({ before: true }); await h.pump();
  old.reject(new Error('Frame da receita anterior falhou.'));
  h.error('Erro nativo anterior.', { revision: oldRevision, token: old.args.at(-1) }); await h.pump();
  assert.doesNotMatch(h.text(), /anterior/);
  h.ref.current.seek(2);
  h.error('Erro de token antigo.', { token: old.args.at(-1) }); await h.pump();
  assert.doesNotMatch(h.text(), /token antigo/);
});

test('selecionar outro take, pausar e alterar tratamento não envia seek nem muda o cursor', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  h.ref.current.pause(); h.update({ activeTakeId: 'b' }); await h.pump();
  h.update({ project: graded(h.project()) }); await h.pump();
  assert.equal(h.calls.length, 0);
  assert.equal(h.published.at(-1).position, 4);
  const recipe = JSON.parse(h.canvas().recipeJSON);
  assert.equal(recipe.clips.find(clip => clip.id === 'a').grade.preset, 'studio');
});

test('pausa publica o relógio parado imediatamente e vence playing antigo até um novo Play', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6, playing: true }); await h.pump();
  const count = h.published.length;
  h.ref.current.pause();
  assert.equal(h.published.length, count + 1, 'pause must freeze before React or a native acknowledgement');
  assert.deepEqual(h.published.at(-1), { position: 4, sourcePosition: 6, takeId: 'a', playing: false, loading: false });
  h.emit({ positionSeconds: 4.1, sourcePositionSeconds: 6.1, playing: true });
  await h.pump();
  h.emit({ positionSeconds: 4.2, sourcePositionSeconds: 6.2, playing: true }); await h.pump();
  assert.equal(h.published.length, count + 1, 'queued playing events cannot move or resume the paused clock');
  assert.equal(h.canvas().paused, true);
  assert.equal(h.calls.length, 0, 'pausing cannot seek or rebuild the player');
  h.emit({ positionSeconds: 4.15, sourcePositionSeconds: 6.15, playing: false }); await h.pump();
  assert.equal(h.published.at(-1).position, 4.15, 'the native pause acknowledgement remains authoritative');
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4.15, sourcePositionSeconds: 6.15, playing: false, loading: true }); await h.pump();
  assert.equal(h.canvas().paused, false, 'loading must preserve the renewed Play intention');
  h.emit({ positionSeconds: 4.3, sourcePositionSeconds: 6.3, playing: true }); await h.pump();
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.published.at(-1).position, 4.3);
});

test('toggle para pausa e EOF impedem que um evento enfileirado reative a reprodução', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true }); await h.pump();
  h.ref.current.togglePlayback();
  assert.equal(h.published.at(-1).playing, false);
  const pausedCount = h.published.length;
  h.emit({ playing: true }); await h.pump();
  assert.equal(h.published.length, pausedCount);
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ playing: true }); await h.pump();
  h.emit({ positionSeconds: 12, clipId: 'b', playing: false }); await h.pump();
  const eofCount = h.published.length;
  h.emit({ positionSeconds: 11.9, clipId: 'b', playing: true }); await h.pump();
  assert.equal(h.published.length, eofCount, 'automatic EOF pause also owns the pause intention');
  assert.equal(h.published.at(-1).position, 12);
  assert.equal(h.canvas().paused, true);
  assert.equal(h.calls.length, 0);
});

test('seek e inspeção congelam o relógio antes da operação nativa sem publicar frames temporários', async () => {
  const h = harness(); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6, playing: true }); await h.pump();
  h.ref.current.seek(7);
  assert.deepEqual(h.published.at(-1), { position: 4, sourcePosition: 6, takeId: 'a', playing: false, loading: false });
  const seek = h.calls.at(-1), count = h.published.length;
  h.emit({ positionSeconds: 4.1, playing: true, token: seek.args.at(-1) }); await h.pump();
  assert.equal(h.published.length, count, 'even a current-token playing event cannot defeat seek pause');
  seek.resolve(h.state({ positionSeconds: 7, sourcePositionSeconds: 3, clipId: 'b' })); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: 7.1, sourcePositionSeconds: 3.1, clipId: 'b', playing: true }); await h.pump();
  h.ref.current.previewSourceFrame({ takeId: 'a', uri: 'file:///a.mp4', seconds: 1 });
  const frame = h.calls.at(-1), frozen = h.published.length;
  assert.equal(h.published.at(-1).playing, false);
  assert.equal(h.published.at(-1).position, 7.1);
  assert.equal(frame.kind, 'source');
  assert.equal(frame.args[3], 7.1, 'frame inspection keeps the playback anchor');
  h.emit({ positionSeconds: 7.2, clipId: 'a', sourcePositionSeconds: 1, playing: true });
  frame.resolve(h.state({ clipId: 'a', sourcePositionSeconds: 1 })); await h.pump();
  assert.equal(h.published.length, frozen, 'source frames never become playback samples');
  assert.equal(h.canvas().paused, true);
});

test('replay no EOF mantém intenção de reproduzir durante seek; seek posterior cancela eventos antigos', async () => {
  const h = harness(); await h.pump();
  const end = model.studioSeconds(model.compileStudioRecipe(h.project()).durationTicks);
  h.emit({ positionSeconds: end, sourcePositionSeconds: 8, clipId: 'b' }); await h.pump();
  assert.equal(h.canvas().paused, true);
  h.ref.current.togglePlayback(); await h.pump();
  assert.equal(h.canvas().paused, false);
  // AVPlayer has stopped at EOF and its asynchronous replay seek is pending.
  // This native contract must not let the periodic event undo the user's Play.
  h.emit({ positionSeconds: end, playing: false, loading: true }); await h.pump();
  assert.equal(h.canvas().paused, false);
  assert.equal(h.published.at(-1).loading, true);
  h.emit({ positionSeconds: 0, sourcePositionSeconds: 2, clipId: 'a', playing: true }); await h.pump();
  assert.equal(h.canvas().paused, false);
  assert.equal(h.published.at(-1).playing, true);
  assert.equal(h.published.at(-1).position, 0);

  h.emit({ positionSeconds: end, playing: false }); await h.pump();
  h.ref.current.togglePlayback(); await h.pump();
  h.emit({ positionSeconds: end, playing: false, loading: true }); await h.pump();
  h.ref.current.seek(4); const cancel = h.calls.at(-1); await h.pump();
  const count = h.published.length;
  h.emit({ positionSeconds: 0, playing: true, token: 0 }); await h.pump();
  assert.equal(h.canvas().paused, true, 'new seek cancels the pending replay intention');
  assert.equal(h.published.length, count, 'old replay cannot move the newer cursor');
  cancel.resolve(h.state({ positionSeconds: 4, sourcePositionSeconds: 6, clipId: 'a' })); await h.pump();
  assert.equal(h.published.at(-1).position, 4);
  assert.equal(h.canvas().paused, true);
});

test('antes e depois mantêm fontes e tempos da montagem e removem apenas o grade do original', async () => {
  const h = harness({ initialProject: graded(project()) }); await h.pump();
  const after = JSON.parse(h.canvas().recipeJSON); const revision = h.canvas().revision;
  h.update({ before: true }); await h.pump();
  const before = JSON.parse(h.canvas().recipeJSON);
  assert.notEqual(h.canvas().revision, revision);
  assert.deepEqual(before.assets, after.assets);
  assert.deepEqual(before.clips.map(clip => [clip.id, clip.startTicks, clip.sourceStartTicks, clip.sourceEndTicks]),
    after.clips.map(clip => [clip.id, clip.startTicks, clip.sourceStartTicks, clip.sourceEndTicks]));
  assert.equal(before.clips[0].grade.intensity, 0);
  assert.equal(h.calls.length, 0);
});

test('seek mais novo vence conclusão e periodic event antigos sem trocar a seleção manual', async () => {
  const h = harness(); await h.pump();
  h.ref.current.seek(2); const first = h.calls.at(-1);
  h.ref.current.seek(7); const second = h.calls.at(-1);
  assert.ok(second.args.at(-1) > first.args.at(-1));
  second.resolve(h.state({ positionSeconds: 7, sourcePositionSeconds: 3, clipId: 'b' })); await h.pump();
  const count = h.published.length;
  first.resolve(h.state({ positionSeconds: 2, token: first.args.at(-1) }));
  h.emit({ positionSeconds: 2, token: first.args.at(-1) }); await h.pump();
  assert.equal(h.published.length, count);
  assert.equal(h.published.at(-1).position, 7);
  assert.deepEqual(h.selected, ['b']);
});

test('trim inspeciona o original com tokens crescentes e restaura âncora sem publicar o frame temporário', async () => {
  const h = harness(); await h.pump();
  h.emit({ positionSeconds: 4, sourcePositionSeconds: 6 }); await h.pump();
  const count = h.published.length;
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 1 });
  const first = h.calls.at(-1);
  assert.deepEqual(first.args.slice(0, -1), [73, 'b', 1, 4]);
  h.ref.current.previewSourceFrame({ takeId: 'b', uri: 'file:///b.mp4', seconds: 9 });
  const latest = h.calls.at(-1);
  assert.ok(latest.args.at(-1) > first.args.at(-1));
  h.emit({ clipId: 'b', sourcePositionSeconds: 9, token: latest.args.at(-1) }); await h.pump();
  assert.equal(h.published.length, count);
  assert.equal(h.published.at(-1).position, 4);
  assert.equal(h.calls.filter(call => call.kind === 'seek').length, 0);
  h.ref.current.seek(4); const restore = h.calls.at(-1);
  assert.ok(restore.args.at(-1) > latest.args.at(-1));
  h.emit({ clipId: 'b', sourcePositionSeconds: 9, token: latest.args.at(-1) });
  restore.resolve(h.state({ positionSeconds: 4, sourcePositionSeconds: 6, clipId: 'a' })); await h.pump();
  assert.equal(h.published.at(-1).position, 4);
  assert.equal(h.published.at(-1).takeId, 'a');
});

test('binário antigo bloqueia montagem com grade e só permite fallback simples sem efeitos', async () => {
  const plain = harness({ available: false }); await plain.pump();
  assert.ok(plain.has('legacy-preview'));
  const enhanced = harness({ available: false, initialProject: graded(project()) }); await enhanced.pump();
  assert.ok(!enhanced.has('legacy-preview'));
  assert.match(enhanced.text(), /Atualize o Classfy Dev/);
  enhanced.ref.current.seek(3); enhanced.ref.current.togglePlayback();
  assert.equal(enhanced.calls.length, 0);
});
