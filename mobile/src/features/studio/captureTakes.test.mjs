import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as model from './model.ts';

const code = ts.transpileModule(readFileSync(new URL('./StudioCaptureTakes.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function harness(initial = {}) {
  const slots = [], scrollCalls = [], continued = [];
  let cursor = 0, effects = [], tree;
  let props = { takes: [], disabled: false, onContinue: () => continued.push('first'), ...initial };
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    react: {
      useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
      useEffect: (callback, deps) => { const index = cursor++; if (!slots[index] || !same(slots[index].deps, deps)) effects.push({ index, callback, deps }); },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'button', ScrollView: 'scroll', Text: 'text', View: 'view', StyleSheet: { create: value => value, absoluteFillObject: {} } },
    'lucide-react-native': { ChevronRight: 'chevron', Mic: 'mic', Video: 'video' },
    '@/components/LoadingImage': { LoadingImage: 'thumbnail' }, '@/theme/colors': { colors: {} }, './model': model,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name]; }, module, module.exports);
  const all = predicate => {
    const result = [];
    const walk = node => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') { if (predicate(node)) result.push(node); walk(node.props?.children); }
    };
    walk(tree); return result;
  };
  const render = () => {
    cursor = 0; effects = []; tree = module.exports.StudioCaptureTakes(props);
    const scroll = all(node => node.type === 'scroll')[0];
    if (scroll) scroll.props.ref.current = { scrollToEnd: value => scrollCalls.push(value) };
    for (const effect of effects) { slots[effect.index]?.cleanup?.(); slots[effect.index] = { deps: effect.deps, cleanup: effect.callback() }; }
  };
  render();
  return {
    all, scrollCalls, continued, tree: () => tree,
    button: () => all(node => node.type === 'button')[0]?.props,
    scroll: () => all(node => node.type === 'scroll')[0]?.props,
    update: patch => { props = { ...props, ...patch }; render(); },
    dispose: () => { slots.forEach(slot => slot?.cleanup?.()); },
  };
}
const take = (id, patch = {}) => ({ id, uri: `file:///owned/${id}.mp4`, name: `Take ${id}`, duration: 8, start: 0, end: 8, kind: 'video', ...patch });

test('captura vazia não oferece avanço nem gera mídia', () => {
  const h = harness(); assert.equal(h.tree(), null); assert.equal(h.button(), undefined); assert.deepEqual(h.scrollCalls, []);
  h.dispose();
});
test('take salvo usa thumbnail persistida, numeração e duração real de corte e velocidade', () => {
  const originals = [take('a', { thumbnailUri: 'file:///owned/a.jpg', start: 2, end: 8, playbackRate: 2 }), take('b', { kind: 'audio', end: 4 }), take('c')];
  const before = JSON.stringify(originals), h = harness({ takes: originals });
  assert.deepEqual(h.all(node => node.props?.accessible === true).map(node => node.props.accessibilityLabel), ['Take 1, 0:03', 'Take 2, 0:04', 'Take 3, 0:08']);
  assert.deepEqual(h.all(node => node.type === 'thumbnail').map(node => node.props.source), [{ uri: 'file:///owned/a.jpg' }]);
  assert.equal(h.all(node => node.type === 'mic').length, 1); assert.equal(h.all(node => node.type === 'video').length, 2);
  assert.equal(h.button().accessibilityLabel, 'Avançar para editar 3 takes'); assert.equal(JSON.stringify(originals), before);
  h.dispose();
});
test('append revela último take após medida sem recentralizar a faixa em outros renders', () => {
  const original = take('a'), h = harness({ takes: [original] });
  h.scroll().onContentSizeChange(52, 62); assert.deepEqual(h.scrollCalls, [{ animated: false }]);
  h.update({ disabled: true, compact: true }); h.scroll().onContentSizeChange(52, 62); assert.equal(h.scrollCalls.length, 1);
  h.update({ takes: [original, take('b')] }); assert.equal(h.scrollCalls.length, 1, 'aguarda medida do conteúdo novo');
  h.scroll().onContentSizeChange(111, 62); assert.deepEqual(h.scrollCalls.at(-1), { animated: true });
  assert.deepEqual(h.all(node => node.props?.accessible === true).map(node => node.props.accessibilityLabel), ['Take 1, 0:08', 'Take 2, 0:08']);
  h.scroll().onContentSizeChange(111, 62); assert.equal(h.scrollCalls.length, 2); h.dispose();
});
test('ação usa props atuais e rejeita callback antigo depois de disabled, takes vazios ou unmount', () => {
  const h = harness({ takes: [take('a')] }), oldPress = h.button().onPress;
  assert.equal(h.button().accessibilityLabel, 'Avançar para editar 1 take');
  oldPress(); assert.deepEqual(h.continued, ['first']);
  h.update({ disabled: true }); assert.equal(h.button().disabled, true); oldPress(); assert.equal(h.continued.length, 1);
  h.update({ disabled: false, onContinue: () => h.continued.push('latest') }); oldPress(); assert.deepEqual(h.continued, ['first', 'latest']);
  h.update({ takes: [] }); oldPress(); assert.equal(h.continued.length, 2);
  h.update({ takes: [take('b')] }); const lateContent = h.scroll().onContentSizeChange;
  h.dispose(); oldPress(); lateContent(52, 62); assert.equal(h.continued.length, 2); assert.deepEqual(h.scrollCalls, []);
});
