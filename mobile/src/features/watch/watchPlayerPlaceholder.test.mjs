import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Render the real component across the RN boundary. These tests check visible
// state and available actions, without duplicating its style implementation.
const jsx = (type, props) => ({ type, props });
const dependencies = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'fragment' },
  'react-native': {
    ActivityIndicator: 'ActivityIndicator', Image: 'Image', Text: 'Text', View: 'View',
    StyleSheet: { create: value => value, absoluteFillObject: {} },
  },
  '@expo/vector-icons': { Ionicons: 'Ionicons' },
  '@/theme/colors': { colors: {} }, '@/theme/radius': { radius: {} },
  '@/theme/spacing': { spacing: {} }, '@/theme/typography': { typography: {} },
};
const source = readFileSync(new URL('../../components/WatchPlayerPlaceholder.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(name => {
  assert.ok(name in dependencies, `Unexpected component dependency: ${name}`);
  return dependencies[name];
}, module, module.exports);
const render = module.exports.WatchPlayerPlaceholder;

function nodes(tree, predicate = () => true) {
  const result = [];
  const visit = value => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') {
      if (predicate(value)) result.push(value);
      visit(value.props?.children);
    }
  };
  visit(tree); return result;
}
const byType = (tree, type) => nodes(tree, node => node.type === type);
const byRole = (tree, role) => nodes(tree, node => node.props?.accessibilityRole === role);
const text = tree => byType(tree, 'Text').map(node => node.props.children);
function noFalsePlayer(tree) {
  assert.equal(nodes(tree, node => typeof node.props?.onPress === 'function' || node.props?.accessibilityRole === 'button').length, 0,
    'A cover without a playable source must not offer a playback action');
  assert.equal(byType(tree, 'Ionicons').filter(node => /play|pause|volume|seek/i.test(node.props.name)).length, 0,
    'No fake player control may imply that this source is ready');
}

test('loading preserves the cover and format while announcing progress without a fake Play', () => {
  const poster = 'https://private.example/classfy-cover.jpg';
  const tree = render({ poster, format: 'Aula', locked: false, loading: true });
  assert.deepEqual(byType(tree, 'Image').map(node => node.props.source), [{ uri: poster }]);
  assert.deepEqual(text(tree), ['Carregando…', 'Aula']);
  assert.equal(byRole(tree, 'progressbar').length, 1);
  assert.equal(byRole(tree, 'progressbar')[0].props.accessibilityLabel, 'Carregando conteúdo');
  assert.equal(byType(tree, 'ActivityIndicator').length, 1);
  assert.equal(byRole(tree, 'alert').length, 0);
  noFalsePlayer(tree);
});

test('loading without a poster still has accessible progress and its actual format', () => {
  const tree = render({ poster: null, format: 'Podcast', locked: false, loading: true });
  assert.equal(byType(tree, 'Image').length, 0);
  assert.equal(byRole(tree, 'progressbar').length, 1);
  assert.deepEqual(text(tree), ['Carregando…', 'Podcast']);
  noFalsePlayer(tree);
});

for (const error of ['Não foi possível carregar este conteúdo.', 'A conexão foi interrompida.\nTente novamente quando a rede voltar.']) {
  test(`a readable error replaces loading status and spinner: ${error.split('\n')[0]}`, () => {
    const tree = render({ poster: 'cover.jpg', format: 'Short', locked: false, loading: true, error });
    assert.equal(byRole(tree, 'alert').length, 1);
    assert.equal(byRole(tree, 'alert')[0].props.accessibilityLabel, error);
    assert.deepEqual(text(tree), [error, 'Short']);
    assert.equal(byType(tree, 'Image')[0].props.source.uri, 'cover.jpg');
    assert.equal(byType(tree, 'ActivityIndicator').length, 0);
    assert.equal(byRole(tree, 'progressbar').length, 0);
    noFalsePlayer(tree);
  });
}

for (const state of [{ loading: false }, { loading: true }, { loading: true, error: 'Private playback failure' }]) {
  test(`locked content keeps the lock and suppresses playback loading/error payload: ${JSON.stringify(state)}`, () => {
    const tree = render({ poster: 'premium-cover.jpg', format: 'Aula', locked: true, ...state });
    assert.equal(nodes(tree, node => node.props?.accessibilityLabel === 'Conteúdo bloqueado').length, 1);
    assert.deepEqual(byType(tree, 'Ionicons').map(node => node.props.name), ['lock-closed']);
    assert.deepEqual(text(tree), ['Aula']);
    assert.equal(byType(tree, 'Image')[0].props.source.uri, 'premium-cover.jpg');
    assert.equal(byType(tree, 'ActivityIndicator').length, 0);
    assert.equal(byRole(tree, 'progressbar').length, 0);
    assert.equal(byRole(tree, 'alert').length, 0);
    noFalsePlayer(tree);
  });
}

test('an idle cover without a playable source does not invent a player or loading state', () => {
  const tree = render({ poster: 'idle-cover.jpg', format: 'Live', locked: false, loading: false });
  assert.deepEqual(text(tree), ['Live']);
  assert.equal(byType(tree, 'Image')[0].props.source.uri, 'idle-cover.jpg');
  assert.equal(byType(tree, 'ActivityIndicator').length, 0);
  assert.equal(byType(tree, 'Ionicons').length, 0);
  assert.equal(byRole(tree, 'progressbar').length + byRole(tree, 'alert').length, 0);
  noFalsePlayer(tree);
});

test('an idle missing cover leaves only its format rather than a broken image or fake control', () => {
  const tree = render({ format: 'Podcast', locked: false, loading: false });
  assert.deepEqual(text(tree), ['Podcast']);
  assert.equal(byType(tree, 'Image').length, 0);
  assert.equal(byType(tree, 'ActivityIndicator').length, 0);
  noFalsePlayer(tree);
});
